import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './database';
import { FinanceRepository } from '../src/features/finance/repository';
import {
  available,
  money,
  normalizeDescription,
  parseMoney,
  projectGoal,
} from '../src/features/finance/domain';
import { decodeOfxBytes, parseOfx } from '../src/features/finance/ofx';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
function setup() {
  const db = database();
  return { ...db, repo: new FinanceRepository(db.connection) };
}

describe('Finanças — centavos e projeções', () => {
  it('interpreta e soma valores pt-BR sem float monetário', () => {
    expect(['0,01', '0,10', '19,90', '1.234,56', '40.000,00'].map(parseMoney)).toEqual([
      1, 10, 1990, 123456, 4000000,
    ]);
    expect(parseMoney('0,01') + parseMoney('0,10') + parseMoney('19,90')).toBe(2001);
    expect(money(123456)).toContain('1.234,56');
    expect(() => parseMoney('1,234')).toThrow();
    expect(normalizeDescription('  ÍFood  *Restaurante ')).toBe('IFOOD *RESTAURANTE');
    expect(available(500000, 300000, 50000)).toBe(150000);
  });
  it('simula juros compostos com aporte no final do mês e centavos arredondados', () => {
    const zero = projectGoal(1000000, 4000000, 100000, 0, '2026-09');
    expect(zero.at(-1)).toEqual({ month: '2029-03', amount_cents: 4000000 });
    const five = projectGoal(1000000, 2000000, 100000, 5, '2026-09');
    const ten = projectGoal(1000000, 2000000, 100000, 10, '2026-09');
    expect(five[1].amount_cents).toBe(Math.round(1000000 * Math.pow(1.05, 1 / 12)) + 100000);
    expect(ten[1].amount_cents).toBeGreaterThan(five[1].amount_cents);
    expect(projectGoal(0, 100000, 0, 0, '2026-09')).toHaveLength(2);
    expect(() => projectGoal(0, 100000, 1, Infinity, '2026-09')).toThrow();
  });
});

describe('Finanças — ledger e persistência SQLite', () => {
  it('separa receita, despesa, transferência, cartão e saldo patrimonial', async () => {
    const { repo, sqlite } = setup();
    const bank = await repo.saveAccount({
      name: 'Conta principal',
      type: 'checking',
      opening_balance_cents: 500000,
    });
    const reserve = await repo.saveAccount({
      name: 'Reserva',
      type: 'savings',
      opening_balance_cents: 1000000,
    });
    const card = await repo.saveAccount({
      name: 'Cartão',
      type: 'credit_card',
      opening_balance_cents: -200000,
    });
    await repo.saveTransaction({
      account_id: bank,
      date: '2026-09-27',
      amount_cents: 500000,
      transaction_type: 'income',
      description: 'Salário',
    });
    await repo.saveTransaction({
      account_id: bank,
      date: '2026-09-27',
      amount_cents: 300000,
      transaction_type: 'expense',
      description: 'Despesas',
    });
    const transfer = await repo.saveTransaction({
      account_id: bank,
      destination_account_id: reserve,
      date: '2026-09-27',
      amount_cents: 50000,
      transaction_type: 'transfer',
      description: 'Reserva',
    });
    await repo.saveTransaction({
      account_id: card,
      date: '2026-09-27',
      amount_cents: 10000,
      transaction_type: 'expense',
      description: 'Restaurante',
    });
    await repo.saveTransaction({
      account_id: bank,
      destination_account_id: card,
      date: '2026-09-27',
      amount_cents: 10000,
      transaction_type: 'transfer',
      description: 'Pagamento do cartão',
    });
    const goal = await repo.saveGoal({
      name: 'Carro',
      target_amount_cents: 4000000,
      initial_amount_cents: 1000000,
      planned_monthly_contribution_cents: 100000,
      annual_return_rate: 0,
      target_date: null,
    });
    await repo.addContribution(goal, '2026-09-27', 50000, 'Transferência para reserva', transfer);
    const summary = await repo.monthSummary('2026-09');
    expect(summary).toMatchObject({
      income_cents: 500000,
      expense_cents: 310000,
      reserved_cents: 50000,
      available_cents: 140000,
    });
    expect((await repo.accounts()).map((a) => [a.name, a.balance_cents])).toEqual([
      ['Cartão', -200000],
      ['Conta principal', 640000],
      ['Reserva', 1050000],
    ]);
    expect((await repo.netWorth('2026-09-27')).net_cents).toBe(1490000);
    expect((await repo.goals())[0].contributed_cents).toBe(50000);
    sqlite.close();
  });
  it('plano mensal, categoria e patrimônio manual não mudam o ledger real', async () => {
    const { repo, sqlite } = setup();
    await repo.saveAccount({ name: 'Conta', type: 'checking', opening_balance_cents: 500000 });
    await repo.savePlan({
      month: '2026-09',
      income_cents: 500000,
      expense_cents: 300000,
      goal_cents: 50000,
      notes: '',
    });
    expect((await repo.monthSummary('2026-09')).planned_available_cents).toBe(150000);
    const asset = await repo.saveAsset({
      name: 'Carro',
      kind: 'asset',
      type: 'vehicle',
      notes: '',
    });
    const debt = await repo.saveAsset({
      name: 'Dívida',
      kind: 'liability',
      type: 'other',
      notes: '',
    });
    await repo.saveValuation(asset, '2026-09-27', 3000000);
    await repo.saveValuation(debt, '2026-09-27', 200000);
    expect((await repo.netWorth('2026-09-27')).net_cents).toBe(3300000);
    await repo.saveValuation(asset, '2026-10-01', 2900000);
    expect((await repo.netWorth('2026-09-27')).net_cents).toBe(3300000);
    expect((await repo.netWorth('2026-10-01')).net_cents).toBe(3200000);
    await repo.saveValuation(asset, '2026-01-01', 3100000);
    expect((await repo.netWorth('2026-01-01')).net_cents).toBe(3600000);
    sqlite.close();
  });
  it('realizar uma recorrência duas vezes mantém uma única transação e categoria coerente', async () => {
    const { repo, sqlite } = setup();
    const account = await repo.saveAccount({
      name: 'Conta',
      type: 'checking',
      opening_balance_cents: 0,
    });
    const recurring = await repo.saveRecurring({
      description: 'Internet',
      account_id: account,
      category_id: 'finance-home',
      transaction_type: 'expense',
      amount_cents: 10990,
      day_of_month: 10,
      subscription: 1,
    });
    const first = await repo.realizeRecurring(recurring, '2026-09-10');
    expect(await repo.realizeRecurring(recurring, '2026-09-10')).toBe(first);
    expect((await repo.monthSummary('2026-09')).expense_cents).toBe(10990);
    await expect(
      repo.saveRecurring({
        description: 'Erro',
        account_id: account,
        category_id: 'finance-income',
        transaction_type: 'expense',
        amount_cents: 100,
        day_of_month: 1,
        subscription: 0,
      }),
    ).rejects.toThrow();
    await expect(
      repo.saveTransaction({
        account_id: account,
        date: '2026-09-10',
        amount_cents: 100,
        transaction_type: 'income',
        description: 'Erro',
        category_id: 'finance-home',
      }),
    ).rejects.toThrow();
    sqlite.close();
  });
});

describe('Finanças — OFX local', () => {
  it('lê SGML e XML, preserva date-only e rejeita entidades externas', () => {
    const sgml = parseOfx(fixture('finance-bank.ofx'));
    expect(sgml.rows).toHaveLength(3);
    expect(sgml.rows[1]).toMatchObject({
      date: '2026-09-27',
      amount_cents: 4290,
      transaction_type: 'expense',
      external_id: 'IFOOD-001',
    });
    const xml = parseOfx(fixture('finance-xml.ofx'));
    expect(xml.rows[0]).toMatchObject({
      date: '2026-09-28',
      amount_cents: 1,
      description: 'Café & pão',
    });
    expect(() =>
      parseOfx(
        '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + fixture('finance-xml.ofx'),
      ),
    ).toThrow();
    expect(
      parseOfx(decodeOfxBytes(new TextEncoder().encode(fixture('finance-bank.ofx')))).rows[0]
        .description,
    ).toBe('Salário');
    const latin =
      'OFXHEADER:100\nENCODING:USASCII\nCHARSET:1252\n<OFX><STMTTRN><DTPOSTED>20260927<TRNAMT>1.00<NAME>Salário</STMTTRN></OFX>';
    expect(parseOfx(decodeOfxBytes(Buffer.from(latin, 'latin1'))).rows[0].description).toBe(
      'Salário',
    );
  });
  it('mostra prévia, categoriza, evita hash/FITID duplicado e sinaliza ambiguidade sem FITID', async () => {
    const { repo, sqlite } = setup();
    const account = await repo.saveAccount({
      name: 'Principal',
      type: 'checking',
      opening_balance_cents: 0,
    });
    const category = 'finance-food';
    await repo.saveRule({
      pattern: 'ifood',
      match_type: 'contains',
      category_id: category,
      priority: 10,
      active: 1,
    });
    const doc = parseOfx(fixture('finance-bank.ofx'));
    const preview = await repo.previewOfx(account, 'hash-a', doc);
    expect(preview.rows.map((r) => r.status)).toEqual(['new', 'new', 'new']);
    expect(preview.rows[1].category_id).toBe(category);
    expect(await repo.importOfx(account, 'synthetic.ofx', 'hash-a', doc)).toEqual({
      count: 3,
      duplicateFile: false,
    });
    expect(
      (await repo.previewOfx(account, 'hash-a', doc)).rows.every((r) => r.status === 'duplicate'),
    ).toBe(true);
    expect(await repo.importOfx(account, 'synthetic.ofx', 'hash-a', doc)).toEqual({
      count: 0,
      duplicateFile: true,
    });
    const altered = { ...doc, rows: doc.rows.map((r) => ({ ...r })) };
    expect((await repo.previewOfx(account, 'hash-b', altered)).rows.map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate',
      'possible',
    ]);
    expect(await repo.importOfx(account, 'synthetic-2.ofx', 'hash-b', altered)).toEqual({
      count: 0,
      duplicateFile: false,
    });
    expect(await repo.transactions({ month: '2026-09' })).toHaveLength(3);
    expect(
      sqlite
        .prepare("SELECT external_type FROM finance_transactions WHERE external_id='IFOOD-001'")
        .get(),
    ).toEqual({ external_type: 'DEBIT' });
    expect(
      sqlite
        .prepare(
          "SELECT source_account_ref,source_currency FROM finance_import_batches WHERE file_hash='hash-a'",
        )
        .get(),
    ).toEqual({ source_account_ref: 'CONTA-SINTETICA', source_currency: 'BRL' });
    expect(
      sqlite
        .prepare('SELECT payload_json FROM finance_import_batches WHERE file_hash=?')
        .get('hash-a'),
    ).toEqual({ payload_json: '[]' });
    sqlite.close();
  });
  it('reverte um lote inteiro se qualquer registro falhar no trigger', async () => {
    const { repo, sqlite, connection } = setup();
    const account = await repo.saveAccount({
      name: 'Principal',
      type: 'checking',
      opening_balance_cents: 0,
    });
    const base = {
      date: '2026-09-27',
      amount_cents: 100,
      transaction_type: 'expense',
      description: 'Teste',
      normalized_description: 'TESTE',
      category_id: null,
      notes: '',
      external_id: null,
      check_number: null,
    };
    await expect(
      connection.execute(
        'INSERT INTO finance_import_batches(id,account_id,file_name,file_hash,imported_at,transaction_count,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          'bad',
          account,
          'synthetic.ofx',
          'bad-hash',
          '2026-09-27T00:00:00Z',
          2,
          JSON.stringify([
            { ...base, id: 'ok' },
            { ...base, id: 'bad', amount_cents: -1 },
          ]),
        ],
      ),
    ).rejects.toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) count FROM finance_transactions').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) count FROM finance_import_batches').get()).toEqual({
      count: 0,
    });
    sqlite.close();
  });
  it('permite decidir explicitamente sobre possível duplicata sem FITID', async () => {
    const { repo, sqlite } = setup(),
      account = await repo.saveAccount({
        name: 'Conta',
        type: 'digital',
        opening_balance_cents: 0,
      });
    const original = parseOfx(fixture('finance-bank.ofx'));
    await repo.importOfx(account, 'a.ofx', 'hash-a', original);
    const extra = { ...original, rows: [original.rows[2]] };
    expect((await repo.previewOfx(account, 'hash-c', extra)).rows[0].status).toBe('possible');
    expect(await repo.importOfx(account, 'b.ofx', 'hash-c', extra, [0])).toEqual({
      count: 1,
      duplicateFile: false,
    });
    expect(await repo.transactions({ month: '2026-09' })).toHaveLength(4);
    sqlite.close();
  });
  it('reimportar arquivo sintético de 100 transações não cria nenhuma nova', async () => {
    const { repo, sqlite } = setup();
    const account = await repo.saveAccount({
      name: 'Conta',
      type: 'checking',
      opening_balance_cents: 0,
    });
    const template = parseOfx(fixture('finance-bank.ofx'));
    const document = {
      ...template,
      rows: Array.from({ length: 100 }, (_, index) => ({
        ...template.rows[1],
        external_id: `FIT-${index}`,
      })),
    };
    expect(await repo.importOfx(account, '100.ofx', 'hash-100', document)).toEqual({
      count: 100,
      duplicateFile: false,
    });
    expect(
      (await repo.previewOfx(account, 'hash-100', document)).rows.filter(
        (row) => row.status === 'duplicate',
      ),
    ).toHaveLength(100);
    expect(await repo.importOfx(account, '100.ofx', 'hash-100', document)).toEqual({
      count: 0,
      duplicateFile: true,
    });
    expect(sqlite.prepare('SELECT count(*) n FROM finance_transactions').get()).toEqual({ n: 100 });
    sqlite.close();
  });
});

it('upgrade Fase 4 → Fase 5 preserva todas as tabelas existentes e aplica 0006/0007 uma vez', () => {
  const folder = mkdtempSync(join(tmpdir(), 'rumo-finance-')),
    path = join(folder, 'upgrade.db');
  let db = database(path, 5);
  try {
    db.sqlite.exec(`
      INSERT INTO tasks(id,title,priority,created_at,updated_at) VALUES('old-task','Tarefa','normal','2026-09-27','2026-09-27');
      INSERT INTO inbox_items(id,content,created_at,updated_at) VALUES('old-inbox','Ideia','2026-09-27','2026-09-27');
      INSERT INTO projects(id,name,created_at,updated_at) VALUES('old-project','Projeto','2026-09-27','2026-09-27');
      INSERT INTO habits(id,name,frequency,kind,start_date,created_at,updated_at) VALUES('old-habit','Hábito','daily','boolean','2026-09-01','2026-09-27','2026-09-27');
      INSERT INTO routines(id,name,frequency,created_at,updated_at) VALUES('old-routine','Rotina','daily','2026-09-27','2026-09-27');
      INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES('old-thought','Pensamento','Texto','2026-09-27','2026-09-27');
      INSERT INTO workout_plans(id,name,created_at,updated_at) VALUES('old-plan','Upper','2026-09-27','2026-09-27');
      INSERT INTO meals(id,name,created_at,updated_at) VALUES('old-meal','Almoço','2026-09-27','2026-09-27');
      UPDATE settings SET value='Pessoa' WHERE key='name';
    `);
    const tables = [
      'tasks',
      'subtasks',
      'task_completions',
      'inbox_items',
      'settings',
      'projects',
      'habits',
      'routines',
      'thoughts',
      'exercises',
      'workout_plans',
      'foods',
      'food_nutrients',
      'meals',
      'diet_plans',
      'food_diary_entries',
      'body_weight_entries',
      'nutrition_goals',
    ];
    const before = Object.fromEntries(
      tables.map((table) => [
        table,
        db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
    db.sqlite.close();
    db = database(path, 7);
    for (const table of tables)
      expect(db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(
        before[table],
      );
    expect(db.sqlite.prepare('SELECT count(*) n FROM test_migrations').get()).toEqual({ n: 7 });
    db.sqlite.close();
    db = database(path, 7);
    expect(db.sqlite.prepare("SELECT count(*) n FROM foods WHERE source_id='taco'").get()).toEqual({
      n: 597,
    });
  } finally {
    db.sqlite.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it('upgrade 0006 → 0007 preserva ledger financeiro já existente', () => {
  const folder = mkdtempSync(join(tmpdir(), 'rumo-finance-followup-')),
    path = join(folder, 'upgrade.db');
  let db = database(path, 6);
  try {
    db.sqlite.exec(
      "INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES('a','Conta','checking','2026-09-27','2026-09-27');",
    );
    db.sqlite.exec(
      "INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at) VALUES('t','a','2026-09-27',1990,'expense','Mercado','MERCADO','2026-09-27','2026-09-27');",
    );
    const before = db.sqlite
      .prepare('SELECT id,account_id,amount_cents FROM finance_transactions')
      .all();
    db.sqlite.close();
    db = database(path, 7);
    expect(
      db.sqlite.prepare('SELECT id,account_id,amount_cents FROM finance_transactions').all(),
    ).toEqual(before);
    expect(db.sqlite.prepare('SELECT count(*) n FROM test_migrations').get()).toEqual({ n: 7 });
  } finally {
    db.sqlite.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
