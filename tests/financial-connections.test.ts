import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { database } from './database';
import { FinanceRepository } from '../src/features/finance/repository';
import {
  FakeFinancialConnectionProvider,
  type ExternalTransaction,
} from '../src/features/finance/connections/provider';
import {
  FinancialConnectionsRepository,
  recoverInterruptedSyncs,
} from '../src/features/finance/connections/repository';
import { portableJson } from '../src/features/data/json-export';
import type { SqlConnection } from '../src/lib/database/connection';

describe('Open Finance read-only boundary', () => {
  const opened: ReturnType<typeof database>[] = [];
  afterEach(() => {
    for (const db of opened.splice(0)) db.sqlite.close();
  });
  function setup() {
    const db = database();
    opened.push(db);
    const provider = new FakeFinancialConnectionProvider();
    provider.accounts.push(
      {
        id: 'checking',
        name: 'Conta Corrente',
        type: 'checking',
        currency: 'BRL',
        lastFour: '4821',
        balanceCents: 100_000,
      },
      {
        id: 'card',
        name: 'Cartão',
        type: 'credit_card',
        currency: 'BRL',
        lastFour: '1001',
        balanceCents: -20_000,
      },
    );
    return { db, provider, repo: new FinancialConnectionsRepository(db.connection) };
  }
  async function mapped() {
    const fixture = setup();
    const id = await fixture.repo.connect(fixture.provider);
    const accounts = await fixture.repo.discoverAccounts(id, fixture.provider);
    const finance = new FinanceRepository(fixture.db.connection);
    for (const account of accounts) {
      const local = await finance.saveAccount({
        name: account.name,
        type: account.type,
        opening_balance_cents: 0,
      });
      await fixture.repo.mapAccount(account.localId, local);
    }
    return { ...fixture, id };
  }
  const row = (id: string, accountId = 'checking'): ExternalTransaction => ({
    id,
    accountId,
    date: '2026-09-20',
    postedAt: '2026-09-20T12:00:00Z',
    description: `Compra ${id}`,
    amountCents: 1000,
    type: 'expense',
    status: 'posted',
  });

  it('migra schema 27 → 28 de forma aditiva e sem campos de credenciais', () => {
    const db = database(':memory:', 27);
    opened.push(db);
    db.sqlite
      .prepare('INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('old-account', 'Anterior', 'checking', '2026-09-01', '2026-09-01');
    db.sqlite.exec(
      readFileSync(resolve('src-tauri/migrations/0028_financial_connections.sql'), 'utf8'),
    );
    expect(
      db.sqlite.prepare('SELECT name FROM finance_accounts WHERE id=?').get('old-account'),
    ).toEqual({ name: 'Anterior' });
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    const columns = db.sqlite.prepare('PRAGMA table_info(financial_connections)').all() as {
      name: string;
    }[];
    expect(columns.map((item) => item.name).join(' ')).not.toMatch(
      /token|secret|password|authorization/i,
    );
  });

  it('mapeia contas explicitamente, importa 500 e reimporta sem duplicar', async () => {
    const { db, provider, repo, id } = await mapped();
    for (let index = 0; index < 500; index++)
      provider.transactions.push(row(`tx-${index}`, index % 2 ? 'card' : 'checking'));
    const first = await repo.sync(id, provider, '2026-09-01');
    expect(first).toEqual({ newCount: 500, updatedCount: 0, skippedCount: 0 });
    expect(
      (db.sqlite.prepare('SELECT count(*) n FROM finance_transactions').get() as { n: number }).n,
    ).toBe(500);
    const second = await repo.sync(id, provider, '2026-09-01');
    expect(second).toEqual({ newCount: 0, updatedCount: 0, skippedCount: 500 });
    expect(
      (db.sqlite.prepare('SELECT count(*) n FROM finance_transactions').get() as { n: number }).n,
    ).toBe(500);
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('impede dois syncs simultâneos da mesma conexão', async () => {
    const { provider, repo, id } = await mapped();
    const original = provider.listTransactions.bind(provider);
    let entered!: () => void;
    let release!: () => void;
    const arrived = new Promise<void>((resolve) => (entered = resolve));
    const blocked = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    provider.listTransactions = async (...args) => {
      calls++;
      if (calls === 1) {
        entered();
        await blocked;
      }
      return original(...args);
    };
    const first = repo.sync(id, provider, '2026-09-01');
    await arrived;
    await expect(repo.sync(id, provider, '2026-09-01')).rejects.toThrow(
      'Sincronização já em andamento.',
    );
    release();
    await first;
    expect(calls).toBe(2); // Uma consulta por conta; nenhuma da tentativa concorrente.
  });

  it('encerra sync abandonado após restart, preserva auditoria e permite retry', async () => {
    const { db, provider, repo, id } = await mapped();
    db.sqlite.prepare("UPDATE financial_connections SET status='syncing' WHERE id=?").run(id);
    db.sqlite
      .prepare(
        "INSERT INTO financial_sync_runs(id,connection_id,started_at,status,new_count) VALUES(?,?,'2000-01-01T00:00:00.000Z','running',3)",
      )
      .run('abandoned', id);
    await recoverInterruptedSyncs(db.connection);
    await recoverInterruptedSyncs(db.connection);
    expect((await repo.connections())[0].status).toBe('error');
    expect(
      db.sqlite
        .prepare(
          "SELECT status,error_code,new_count,finished_at FROM financial_sync_runs WHERE id='abandoned'",
        )
        .get(),
    ).toMatchObject({ status: 'error', error_code: 'interrupted', new_count: 3 });
    provider.transactions.push(row('after-restart'));
    expect(await repo.sync(id, provider, '2026-09-01')).toEqual({
      newCount: 1,
      updatedCount: 0,
      skippedCount: 0,
    });
    expect(
      db.sqlite
        .prepare("SELECT status,error_code,new_count FROM financial_sync_runs WHERE id='abandoned'")
        .get(),
    ).toEqual({ status: 'error', error_code: 'interrupted', new_count: 3 });
  });

  it('reclassifica uma compra de cartão já vinculada sem criar outra transação', async () => {
    const { db, provider, repo, id } = await mapped();
    provider.transactions.push({ ...row('card-purchase', 'card'), type: 'income' });
    expect(await repo.sync(id, provider, '2026-09-01')).toMatchObject({ newCount: 1 });
    provider.transactions[0] = { ...provider.transactions[0], type: 'card_purchase' };
    expect(await repo.sync(id, provider, '2026-09-01')).toEqual({
      newCount: 0,
      updatedCount: 1,
      skippedCount: 0,
    });
    expect(db.sqlite.prepare('SELECT transaction_type FROM finance_transactions').get()).toEqual({
      transaction_type: 'expense',
    });
    expect(
      (db.sqlite.prepare('SELECT count(*) n FROM finance_transactions').get() as { n: number }).n,
    ).toBe(1);
  });

  it('interrompe cursor cíclico antes de repetir páginas', async () => {
    const { provider, repo, id } = await mapped();
    provider.listTransactions = async (_connection, accountId, _from, cursor) => ({
      rows: [],
      nextCursor: accountId === 'checking' ? (cursor === 'A' ? 'B' : 'A') : null,
    });
    await expect(repo.preview(id, provider, '2026-09-01')).rejects.toThrow(
      'Cursor externo repetido.',
    );
  });

  it('faz sync incremental, pending → posted e atualização de descrição sem duplicação', async () => {
    const { db, provider, repo, id } = await mapped();
    provider.transactions.push({ ...row('pending'), status: 'pending', postedAt: null });
    await repo.sync(id, provider, '2026-09-01');
    provider.transactions.splice(0, 1, {
      ...row('posted'),
      previousId: 'pending',
      description: 'Compra corrigida',
    });
    provider.transactions.push(row('new-1'), row('new-2'), row('new-3'));
    expect(await repo.sync(id, provider)).toEqual({
      newCount: 3,
      updatedCount: 1,
      skippedCount: 0,
    });
    expect(provider.lastFromDate).toBe('2026-09-20');
    expect(
      (db.sqlite.prepare('SELECT count(*) n FROM finance_transactions').get() as { n: number }).n,
    ).toBe(4);
    expect(
      db.sqlite
        .prepare('SELECT description FROM finance_transactions WHERE description=?')
        .get('Compra corrigida'),
    ).toEqual({ description: 'Compra corrigida' });
    expect(await repo.sync(id, provider, '2026-09-01')).toEqual({
      newCount: 0,
      updatedCount: 0,
      skippedCount: 4,
    });
  });

  it('reconcilia ID alterado de pending → posted somente com assinatura única exata', async () => {
    const { db, provider, repo, id } = await mapped();
    provider.transactions.push({
      ...row('pending'),
      description: 'Mercado 27,50',
      amountCents: 2750,
      status: 'pending',
      postedAt: null,
    });
    await repo.sync(id, provider, '2026-09-01');
    provider.transactions.splice(0, 1, {
      ...row('posted'),
      description: 'Mercado 27,50',
      amountCents: 2750,
    });
    expect(await repo.sync(id, provider, '2026-09-01')).toEqual({
      newCount: 0,
      updatedCount: 1,
      skippedCount: 0,
    });
    expect(
      (db.sqlite.prepare('SELECT count(*) n FROM finance_transactions').get() as { n: number }).n,
    ).toBe(1);
    expect(
      (
        db.sqlite
          .prepare('SELECT external_transaction_id FROM financial_external_transaction_links')
          .get() as { external_transaction_id: string }
      ).external_transaction_id,
    ).toBe('posted');
  });

  it('não mescla duas compras postadas iguais em uma única pendência', async () => {
    const { db, provider, repo, id } = await mapped();
    const common = { description: 'Mercado', amountCents: 2750 };
    provider.transactions.push({ ...row('pending'), ...common, status: 'pending', postedAt: null });
    await repo.sync(id, provider, '2026-09-01');
    provider.transactions.splice(
      0,
      1,
      { ...row('posted-one'), ...common },
      { ...row('posted-two'), ...common },
    );
    expect(await repo.sync(id, provider, '2026-09-01')).toEqual({
      newCount: 1,
      updatedCount: 1,
      skippedCount: 0,
    });
    expect(
      (db.sqlite.prepare('SELECT count(*) n FROM finance_transactions').get() as { n: number }).n,
    ).toBe(2);
  });

  it('mantém possível duplicata OFX e pagamentos de cartão para revisão, sem mesclar silenciosamente', async () => {
    const { db, provider, repo, id } = await mapped();
    const account = (await repo.accounts(id)).find((item) => item.id === 'checking')!;
    db.sqlite
      .prepare(
        `INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,source,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'ofx-existing',
        account.linkedFinanceAccountId,
        '2026-09-20',
        1000,
        'expense',
        'Compra igual',
        'COMPRA IGUAL',
        'ofx',
        '2026-09-20',
        '2026-09-20',
      );
    provider.transactions.push(
      { ...row('external-same'), description: 'Compra igual' },
      { ...row('card-payment', 'card'), type: 'card_payment' },
    );
    expect(
      Object.fromEntries(
        (await repo.preview(id, provider, '2026-09-01')).map((item) => [
          item.transaction.id,
          item.status,
        ]),
      ),
    ).toEqual({ 'external-same': 'possible', 'card-payment': 'review' });
    expect(await repo.sync(id, provider, '2026-09-01')).toEqual({
      newCount: 0,
      updatedCount: 0,
      skippedCount: 2,
    });
    expect(
      (db.sqlite.prepare('SELECT count(*) n FROM finance_transactions').get() as { n: number }).n,
    ).toBe(1);
  });

  it('consentimento expirado interrompe sync e disconnect preserva dados locais', async () => {
    const { db, provider, repo, id } = await mapped();
    provider.transactions.push(row('kept'));
    await repo.sync(id, provider, '2026-09-01');
    provider.connection.status = 'consent_expired';
    await expect(repo.sync(id, provider, '2026-09-01')).rejects.toThrow('consent_expired');
    expect((await repo.connections())[0].status).toBe('consent_expired');
    await repo.disconnect(id, provider);
    expect((await repo.connections())[0].status).toBe('disconnected');
    expect(
      (db.sqlite.prepare('SELECT count(*) n FROM finance_transactions').get() as { n: number }).n,
    ).toBe(1);
  });
  it('falha externa não duplica dados e pode ser repetida após erro transitório', async () => {
    const { db, provider, repo, id } = await mapped();
    provider.transactions.push(row('first'));
    provider.failNext = 'rate_limited';
    await expect(repo.sync(id, provider, '2026-09-01')).rejects.toThrow('rate_limited');
    expect((await repo.connections())[0].status).toBe('error');
    expect(await repo.sync(id, provider, '2026-09-01')).toEqual({
      newCount: 1,
      updatedCount: 0,
      skippedCount: 0,
    });
    expect(
      (db.sqlite.prepare('SELECT count(*) n FROM finance_transactions').get() as { n: number }).n,
    ).toBe(1);
  });

  it('não remapeia conta com histórico importado e conserva saldo local', async () => {
    const { db, provider, repo, id } = await mapped();
    provider.transactions.push(row('kept'));
    await repo.sync(id, provider, '2026-09-01');
    const external = (await repo.accounts(id)).find((item) => item.id === 'checking')!;
    const other = await new FinanceRepository(db.connection).saveAccount({
      name: 'Outra',
      type: 'checking',
      opening_balance_cents: 555,
    });
    await expect(repo.mapAccount(external.localId, other)).rejects.toThrow('já possui transações');
    const account = db.sqlite
      .prepare('SELECT opening_balance_cents FROM finance_accounts WHERE id=?')
      .get(external.linkedFinanceAccountId) as { opening_balance_cents: number };
    expect(account.opening_balance_cents).toBe(0);
    expect((await repo.accounts(id)).find((item) => item.id === 'checking')?.balanceCents).toBe(
      100_000,
    );
  });

  it('mantém reembolso para revisão sem classificá-lo como renda nem duplicar pagamento do cartão', async () => {
    const { db, provider, repo, id } = await mapped();
    provider.transactions.push(
      { ...row('salary'), type: 'income', amountCents: 200_000 },
      { ...row('refund'), type: 'refund', amountCents: 500 },
      { ...row('transfer'), type: 'transfer', amountCents: 20_000 },
      { ...row('purchase', 'card'), type: 'card_purchase', amountCents: 800 },
      { ...row('payment', 'card'), type: 'card_payment', amountCents: 800 },
    );
    expect(
      (await repo.preview(id, provider, '2026-09-01')).find(
        (item) => item.transaction.id === 'refund',
      )?.status,
    ).toBe('review');
    expect(await repo.sync(id, provider, '2026-09-01')).toEqual({
      newCount: 2,
      updatedCount: 0,
      skippedCount: 3,
    });
    const totals = db.sqlite
      .prepare(
        'SELECT transaction_type kind,sum(amount_cents) cents FROM finance_transactions GROUP BY transaction_type',
      )
      .all();
    expect(totals).toEqual([
      { kind: 'expense', cents: 800 },
      { kind: 'income', cents: 200_000 },
    ]);
  });

  it('exportação portátil não consulta metadados internos de conexão nem credenciais', async () => {
    const queried: string[] = [];
    const db: SqlConnection = {
      async select<T>(query: string) {
        queried.push(query);
        return (query.includes('MAX(version)') ? [{ version: 28 }] : []) as T;
      },
      async execute() {
        return { rowsAffected: 0 };
      },
    };
    const exported = await portableJson(db);
    expect(
      queried.some((query) =>
        /financial_connections|financial_external_accounts|financial_external_transaction_links|financial_sync_runs/.test(
          query,
        ),
      ),
    ).toBe(false);
    expect(JSON.stringify(exported)).not.toMatch(/access_token|refresh_token|client_secret/i);
  });
});
