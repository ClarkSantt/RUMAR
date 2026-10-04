import type { SqlConnection } from '../../../lib/database/connection';
import { addDays, localDate, validDate } from '../../../lib/dates';
import { normalizeDescription } from '../domain';
import { FinanceRepository } from '../repository';
import type { ExternalAccount, ExternalTransaction, FinancialConnectionProvider } from './provider';

const now = () => new Date().toISOString();
const activeSyncs = new Set<string>();
const processStartedAt = now();

/** Close runs abandoned by a previous process before attempting any new sync. */
export async function recoverInterruptedSyncs(db: SqlConnection): Promise<void> {
  const finishedAt = now();
  await db.execute(
    `UPDATE financial_connections SET status='error',updated_at=$1
     WHERE status='syncing' AND id IN
       (SELECT connection_id FROM financial_sync_runs WHERE status='running' AND started_at<$2)`,
    [finishedAt, processStartedAt],
  );
  await db.execute(
    `UPDATE financial_sync_runs SET status='error',finished_at=$1,error_code='interrupted'
     WHERE status='running' AND started_at<$2`,
    [finishedAt, processStartedAt],
  );
}
async function stableId(...parts: string[]) {
  const bytes = new TextEncoder().encode(parts.join('\u0000'));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
export interface StoredConnection {
  id: string;
  provider: string;
  external_connection_id: string;
  institution_name: string;
  status: string;
  consent_expires_at: string | null;
  last_synced_at: string | null;
}
export interface StoredExternalAccount extends ExternalAccount {
  localId: string;
  linkedFinanceAccountId: string | null;
}
export interface FinancialPreviewRow {
  account: StoredExternalAccount;
  transaction: ExternalTransaction;
  status: 'new' | 'update' | 'existing' | 'possible' | 'review' | 'unmapped';
  localTransactionId: string | null;
}
type Link = {
  external_transaction_id: string;
  transaction_id: string;
  status: 'pending' | 'posted';
  date: string | null;
  amount_cents: number | null;
  transaction_type: 'income' | 'expense' | null;
  description: string | null;
};

export class FinancialConnectionsRepository {
  constructor(private readonly db: SqlConnection) {}

  connections() {
    return this.db.select<StoredConnection[]>(
      'SELECT * FROM financial_connections ORDER BY institution_name,id',
    );
  }
  async connect(provider: FinancialConnectionProvider) {
    const remote = await provider.connect();
    const id = `of-${await stableId(provider.id, remote.id)}`;
    const stamp = now();
    await this.db.execute(
      `INSERT INTO financial_connections(id,provider,external_connection_id,institution_name,status,consent_expires_at,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT(provider,external_connection_id) DO UPDATE SET institution_name=excluded.institution_name,
       status=excluded.status,consent_expires_at=excluded.consent_expires_at,updated_at=excluded.updated_at`,
      [
        id,
        provider.id,
        remote.id,
        remote.institutionName,
        remote.status,
        remote.consentExpiresAt,
        stamp,
      ],
    );
    return id;
  }
  async disconnect(id: string, provider: FinancialConnectionProvider) {
    const connection = await this.requireConnection(id, provider);
    await provider.disconnect(connection.external_connection_id);
    await this.db.execute(
      "UPDATE financial_connections SET status='disconnected',updated_at=$2 WHERE id=$1",
      [id, now()],
    );
  }
  async refreshConsent(id: string, provider: FinancialConnectionProvider) {
    const connection = await this.requireConnection(id, provider);
    const remote = await provider.refreshConsent(connection.external_connection_id);
    await this.db.execute(
      'UPDATE financial_connections SET status=$2,consent_expires_at=$3,updated_at=$4 WHERE id=$1',
      [id, remote.status, remote.consentExpiresAt, now()],
    );
  }
  async discoverAccounts(id: string, provider: FinancialConnectionProvider) {
    const connection = await this.requireConnection(id, provider);
    const accounts = await provider.listAccounts(connection.external_connection_id);
    for (const account of accounts) {
      if (!account.id || !account.name || !account.currency) throw Error('Conta externa inválida.');
      const localId = `ofa-${await stableId(id, account.id)}`;
      const stamp = now();
      await this.db.execute(
        `INSERT INTO financial_external_accounts(id,connection_id,external_account_id,institution_name,account_name,account_type,currency,last_four,reported_balance_cents,reported_balance_at,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
         ON CONFLICT(connection_id,external_account_id) DO UPDATE SET account_name=excluded.account_name,
         account_type=excluded.account_type,currency=excluded.currency,last_four=excluded.last_four,
         reported_balance_cents=excluded.reported_balance_cents,reported_balance_at=excluded.reported_balance_at,updated_at=excluded.updated_at`,
        [
          localId,
          id,
          account.id,
          connection.institution_name,
          account.name,
          account.type,
          account.currency,
          account.lastFour,
          account.balanceCents,
          account.balanceCents === null ? null : stamp,
          stamp,
        ],
      );
    }
    return this.accounts(id);
  }
  async accounts(connectionId: string): Promise<StoredExternalAccount[]> {
    const rows = await this.db.select<
      {
        id: string;
        external_account_id: string;
        account_name: string;
        account_type: ExternalAccount['type'];
        currency: string;
        last_four: string | null;
        reported_balance_cents: number | null;
        linked_finance_account_id: string | null;
      }[]
    >('SELECT * FROM financial_external_accounts WHERE connection_id=$1 ORDER BY account_name,id', [
      connectionId,
    ]);
    return rows.map((row) => ({
      localId: row.id,
      id: row.external_account_id,
      name: row.account_name,
      type: row.account_type,
      currency: row.currency,
      lastFour: row.last_four,
      balanceCents: row.reported_balance_cents,
      linkedFinanceAccountId: row.linked_finance_account_id,
    }));
  }
  async mapAccount(externalAccountId: string, financeAccountId: string) {
    const linked = await this.db.select<{ n: number }[]>(
      `SELECT count(*) n FROM financial_external_transaction_links l
       JOIN financial_external_accounts a ON a.connection_id=l.connection_id
        AND a.external_account_id=l.external_account_id WHERE a.id=$1`,
      [externalAccountId],
    );
    const current = await this.db.select<{ linked_finance_account_id: string | null }[]>(
      'SELECT linked_finance_account_id FROM financial_external_accounts WHERE id=$1',
      [externalAccountId],
    );
    if (!current[0]) throw Error('Conta externa não encontrada.');
    if (linked[0]?.n && current[0].linked_finance_account_id !== financeAccountId)
      throw Error('Esta conta já possui transações importadas. O vínculo não pode ser alterado.');
    if (!financeAccountId) {
      await this.db.execute(
        'UPDATE financial_external_accounts SET linked_finance_account_id=NULL,updated_at=$2 WHERE id=$1',
        [externalAccountId, now()],
      );
      return;
    }
    const [external, finance] = await Promise.all([
      this.db.select<{ currency: string }[]>(
        'SELECT currency FROM financial_external_accounts WHERE id=$1',
        [externalAccountId],
      ),
      this.db.select<{ currency: string }[]>(
        'SELECT currency FROM finance_accounts WHERE id=$1 AND archived_at IS NULL',
        [financeAccountId],
      ),
    ]);
    if (!external[0] || !finance[0] || external[0].currency !== finance[0].currency)
      throw Error('Conta RUMAR inexistente ou moeda incompatível.');
    await this.db.execute(
      'UPDATE financial_external_accounts SET linked_finance_account_id=$2,updated_at=$3 WHERE id=$1',
      [externalAccountId, financeAccountId, now()],
    );
  }
  async createMappedAccount(externalAccountId: string) {
    const rows = await this.db.select<
      { account_name: string; account_type: ExternalAccount['type']; currency: string }[]
    >('SELECT account_name,account_type,currency FROM financial_external_accounts WHERE id=$1', [
      externalAccountId,
    ]);
    const account = rows[0];
    if (!account || account.currency !== 'BRL')
      throw Error('Somente contas em BRL são suportadas.');
    const financeId = await new FinanceRepository(this.db).saveAccount({
      name: account.account_name,
      type: account.account_type,
      opening_balance_cents: 0,
    });
    await this.mapAccount(externalAccountId, financeId);
    return financeId;
  }
  private async requireConnection(id: string, provider: FinancialConnectionProvider) {
    const row = (
      await this.db.select<StoredConnection[]>('SELECT * FROM financial_connections WHERE id=$1', [
        id,
      ])
    )[0];
    if (!row || row.provider !== provider.id) throw Error('Conexão não encontrada.');
    return row;
  }
  private async incrementalStart(connection: StoredConnection) {
    if (!connection.last_synced_at) return addDays(localDate(), -90);
    const recent = addDays(localDate(new Date(connection.last_synced_at)), -7);
    const pending = await this.db.select<{ first_date: string | null }[]>(
      `SELECT min(t.date) first_date FROM financial_external_transaction_links l
       JOIN finance_transactions t ON t.id=l.transaction_id
       WHERE l.connection_id=$1 AND l.status='pending'`,
      [connection.id],
    );
    return pending[0]?.first_date && pending[0].first_date < recent
      ? pending[0].first_date
      : recent;
  }
  async preview(id: string, provider: FinancialConnectionProvider, fromDate?: string) {
    const connection = await this.requireConnection(id, provider);
    fromDate ??= await this.incrementalStart(connection);
    if (!validDate(fromDate)) throw Error('Data inicial inválida.');
    if (connection.status !== 'connected' && connection.status !== 'error')
      throw Error('Reconecte a instituição antes de sincronizar.');
    const remoteStatus = await provider.getConnectionStatus(connection.external_connection_id);
    if (remoteStatus !== 'connected') {
      await this.db.execute(
        'UPDATE financial_connections SET status=$2,updated_at=$3 WHERE id=$1',
        [id, remoteStatus, now()],
      );
      throw Error(remoteStatus);
    }
    const accounts = await this.accounts(id);
    const result: FinancialPreviewRow[] = [];
    for (const account of accounts) {
      const links = new Map(
        (
          await this.db.select<Link[]>(
            `SELECT l.external_transaction_id,l.transaction_id,l.status,t.date,t.amount_cents,t.transaction_type,t.description
           FROM financial_external_transaction_links l LEFT JOIN finance_transactions t ON t.id=l.transaction_id
           WHERE l.connection_id=$1 AND l.external_account_id=$2`,
            [id, account.id],
          )
        ).map((link) => [link.external_transaction_id, link]),
      );
      const pendingBySignature = new Map<string, Link[]>();
      for (const link of links.values()) {
        if (
          link.status !== 'pending' ||
          !link.date ||
          link.amount_cents === null ||
          !link.description
        )
          continue;
        const signature = `${link.date}\u0000${link.amount_cents}\u0000${normalizeDescription(link.description)}`;
        pendingBySignature.set(signature, [...(pendingBySignature.get(signature) ?? []), link]);
      }
      const possibleOfx = new Set<string>();
      if (account.linkedFinanceAccountId) {
        const existingOfx = await this.db.select<
          {
            date: string;
            amount_cents: number;
            normalized_description: string;
          }[]
        >(
          `SELECT date,amount_cents,normalized_description FROM finance_transactions
           WHERE account_id=$1 AND source='ofx' AND date>=$2`,
          [account.linkedFinanceAccountId, fromDate],
        );
        for (const row of existingOfx)
          possibleOfx.add(
            `${row.date}\u0000${row.amount_cents}\u0000${row.normalized_description}`,
          );
      }
      const seen = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 100; page++) {
        const batch = await provider.listTransactions(
          connection.external_connection_id,
          account.id,
          fromDate,
          cursor,
        );
        for (const incoming of batch.rows) {
          let transaction = incoming;
          if (
            transaction.accountId !== account.id ||
            !transaction.id ||
            !Number.isSafeInteger(transaction.amountCents) ||
            transaction.amountCents <= 0 ||
            !validDate(transaction.date)
          )
            throw Error('Transação externa inválida.');
          if (seen.has(transaction.id)) throw Error('ID externo duplicado na resposta.');
          seen.add(transaction.id);
          if (
            transaction.status === 'posted' &&
            !transaction.previousId &&
            !links.has(transaction.id)
          ) {
            const signature = `${transaction.date}\u0000${transaction.amountCents}\u0000${normalizeDescription(transaction.description)}`;
            const candidates = pendingBySignature.get(signature) ?? [];
            if (candidates.length === 1) {
              transaction = { ...transaction, previousId: candidates[0].external_transaction_id };
              pendingBySignature.delete(signature);
            }
          }
          const previous = transaction.previousId ? links.get(transaction.previousId) : null;
          const current = links.get(transaction.id);
          let status: FinancialPreviewRow['status'] = account.linkedFinanceAccountId
            ? 'new'
            : 'unmapped';
          if (
            account.currency !== 'BRL' ||
            transaction.type === 'transfer' ||
            transaction.type === 'card_payment' ||
            transaction.type === 'refund'
          )
            status = 'review';
          else if (current || previous) {
            const link = current ?? previous!;
            status =
              previous ||
              link.status !== transaction.status ||
              link.date === null ||
              link.date !== transaction.date ||
              link.amount_cents !== transaction.amountCents ||
              link.transaction_type !==
                (transaction.type === 'card_purchase' ? 'expense' : transaction.type) ||
              link.description !== transaction.description
                ? 'update'
                : 'existing';
          } else if (account.linkedFinanceAccountId) {
            if (
              possibleOfx.has(
                `${transaction.date}\u0000${transaction.amountCents}\u0000${normalizeDescription(transaction.description)}`,
              )
            )
              status = 'possible';
          }
          result.push({
            account,
            transaction,
            status,
            localTransactionId: current?.transaction_id ?? previous?.transaction_id ?? null,
          });
        }
        if (!batch.nextCursor) break;
        if (seenCursors.has(batch.nextCursor)) throw Error('Cursor externo repetido.');
        seenCursors.add(batch.nextCursor);
        cursor = batch.nextCursor;
        if (page === 99) throw Error('Limite de páginas excedido.');
      }
    }
    return result;
  }
  async sync(id: string, provider: FinancialConnectionProvider, fromDate?: string) {
    if (activeSyncs.has(id)) throw Error('Sincronização já em andamento.');
    activeSyncs.add(id);
    try {
      return await this.syncUnlocked(id, provider, fromDate);
    } finally {
      activeSyncs.delete(id);
    }
  }
  private async syncUnlocked(id: string, provider: FinancialConnectionProvider, fromDate?: string) {
    await this.requireConnection(id, provider);
    const runId = crypto.randomUUID(),
      started = now();
    await this.db.execute(
      "INSERT INTO financial_sync_runs(id,connection_id,started_at,status) VALUES($1,$2,$3,'running')",
      [runId, id, started],
    );
    let created = 0,
      updated = 0,
      skipped = 0;
    try {
      const preview = await this.preview(id, provider, fromDate);
      await this.db.execute(
        "UPDATE financial_connections SET status='syncing',updated_at=$2 WHERE id=$1",
        [id, now()],
      );
      for (const item of preview) {
        if (item.status === 'unmapped' || item.status === 'review' || item.status === 'possible') {
          skipped++;
          continue;
        }
        const t = item.transaction,
          account = item.account;
        if (t.type === 'transfer' || t.type === 'card_payment' || t.type === 'refund') {
          skipped++;
          continue;
        }
        const kind: 'income' | 'expense' = t.type === 'card_purchase' ? 'expense' : t.type;
        const externalRef = `of:${await stableId(id, account.id, t.previousId ?? t.id)}`;
        const transactionId =
          item.localTransactionId ?? `oft-${await stableId(id, account.id, t.previousId ?? t.id)}`;
        const stamp = now();
        const category = await new FinanceRepository(this.db).matchCategory(t.description, kind);
        if (item.status === 'new') {
          await this.db.execute(
            `INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,category_id,source,external_id,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,$10,$10)
             ON CONFLICT(id) DO UPDATE SET date=excluded.date,amount_cents=excluded.amount_cents,
             transaction_type=excluded.transaction_type,description=excluded.description,
             normalized_description=excluded.normalized_description,updated_at=excluded.updated_at`,
            [
              transactionId,
              account.linkedFinanceAccountId,
              t.date,
              t.amountCents,
              kind,
              t.description,
              normalizeDescription(t.description),
              category,
              externalRef,
              stamp,
            ],
          );
          created++;
        } else if (item.status === 'update') {
          await this.db.execute(
            'UPDATE finance_transactions SET date=$2,amount_cents=$3,transaction_type=$4,description=$5,normalized_description=$6,updated_at=$7 WHERE id=$1',
            [
              transactionId,
              t.date,
              t.amountCents,
              kind,
              t.description,
              normalizeDescription(t.description),
              stamp,
            ],
          );
          updated++;
        } else {
          skipped++;
          continue;
        }
        if (t.previousId && t.previousId !== t.id && item.localTransactionId) {
          await this.db.execute(
            'UPDATE financial_external_transaction_links SET external_transaction_id=$4,status=$5,posted_at=$6,updated_at=$7 WHERE connection_id=$1 AND external_account_id=$2 AND external_transaction_id=$3',
            [id, account.id, t.previousId, t.id, t.status, t.postedAt, stamp],
          );
        } else {
          await this.db.execute(
            `INSERT INTO financial_external_transaction_links(connection_id,external_account_id,external_transaction_id,transaction_id,status,posted_at,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$7)
             ON CONFLICT(connection_id,external_account_id,external_transaction_id) DO UPDATE SET status=excluded.status,posted_at=excluded.posted_at,updated_at=excluded.updated_at`,
            [id, account.id, t.id, transactionId, t.status, t.postedAt, stamp],
          );
        }
      }
      const finished = now();
      await this.db.execute(
        "UPDATE financial_connections SET status='connected',last_synced_at=$2,updated_at=$2 WHERE id=$1",
        [id, finished],
      );
      await this.db.execute(
        "UPDATE financial_sync_runs SET status='completed',finished_at=$2,new_count=$3,updated_count=$4,skipped_count=$5 WHERE id=$1",
        [runId, finished, created, updated, skipped],
      );
      return { newCount: created, updatedCount: updated, skippedCount: skipped };
    } catch (error) {
      const code =
        error instanceof Error && ['consent_expired', 'reconnect_required'].includes(error.message)
          ? error.message
          : 'sync_error';
      await this.db.execute(
        'UPDATE financial_connections SET status=$2,updated_at=$3 WHERE id=$1',
        [id, code === 'sync_error' ? 'error' : code, now()],
      );
      await this.db.execute(
        "UPDATE financial_sync_runs SET status='error',finished_at=$2,error_code=$3 WHERE id=$1",
        [runId, now(), code],
      );
      throw error;
    }
  }
}
