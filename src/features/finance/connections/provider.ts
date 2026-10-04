/** Provider-neutral, read-only boundary. No banking secret enters this contract. */
export interface ExternalConnection {
  id: string;
  institutionName: string;
  status: 'connected' | 'reconnect_required' | 'consent_expired';
  consentExpiresAt: string | null;
}
export interface ExternalAccount {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit_card' | 'other';
  currency: string;
  lastFour: string | null;
  balanceCents: number | null;
}
export interface ExternalTransaction {
  id: string;
  previousId?: string;
  accountId: string;
  date: string;
  postedAt: string | null;
  description: string;
  amountCents: number;
  type: 'income' | 'expense' | 'transfer' | 'card_purchase' | 'card_payment' | 'refund';
  status: 'pending' | 'posted';
  merchant?: string | null;
  rawCategory?: string | null;
}
export interface TransactionPage {
  rows: ExternalTransaction[];
  nextCursor: string | null;
}
export interface FinancialConnectionProvider {
  readonly id: string;
  connect(): Promise<ExternalConnection>;
  disconnect(connectionId: string): Promise<void>;
  refreshConsent(connectionId: string): Promise<ExternalConnection>;
  getConnectionStatus(connectionId: string): Promise<ExternalConnection['status']>;
  listAccounts(connectionId: string): Promise<ExternalAccount[]>;
  listTransactions(
    connectionId: string,
    accountId: string,
    fromDate: string,
    cursor: string | null,
  ): Promise<TransactionPage>;
}

/** In-memory fixture only; never presented to users as a live bank connection. */
export class FakeFinancialConnectionProvider implements FinancialConnectionProvider {
  readonly id = 'fake';
  readonly connection: ExternalConnection = {
    id: 'fake-connection',
    institutionName: 'Banco Teste',
    status: 'connected',
    consentExpiresAt: null,
  };
  readonly accounts: ExternalAccount[] = [];
  readonly transactions: ExternalTransaction[] = [];
  pageSize = 100;
  failNext: 'network_error' | 'rate_limited' | 'server_error' | null = null;
  lastFromDate = '';
  async connect() {
    this.connection.status = 'connected';
    return { ...this.connection };
  }
  async disconnect() {
    this.connection.status = 'reconnect_required';
  }
  async refreshConsent() {
    this.connection.status = 'connected';
    return { ...this.connection };
  }
  async getConnectionStatus() {
    return this.connection.status;
  }
  async listAccounts() {
    return this.accounts.map((account) => ({ ...account }));
  }
  async listTransactions(
    _connectionId: string,
    accountId: string,
    fromDate: string,
    cursor: string | null,
  ) {
    if (this.connection.status !== 'connected') throw Error('consent_expired');
    if (this.failNext) {
      const fault = this.failNext;
      this.failNext = null;
      throw Error(fault);
    }
    this.lastFromDate = fromDate;
    const rows = this.transactions.filter(
      (row) => row.accountId === accountId && row.date >= fromDate,
    );
    const start = cursor ? Number(cursor) : 0;
    const page = rows.slice(start, start + this.pageSize);
    return {
      rows: page.map((row) => ({ ...row })),
      nextCursor: start + page.length < rows.length ? String(start + page.length) : null,
    };
  }
}
