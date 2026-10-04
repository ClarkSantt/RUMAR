import type {
  ExternalAccount,
  ExternalConnection,
  FinancialConnectionProvider,
  TransactionPage,
} from './provider';

/** The transport is implemented by the native host. Device credentials never enter JavaScript. */
export interface FinanceGatewayTransport {
  request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: object): Promise<T>;
}
export interface PluggyConnectFlow {
  /** Opens the official Pluggy Connect widget and returns its Item ID on success. */
  open(
    connectToken: string,
    connectorIds: number[],
    sandboxOnly: boolean,
    updateItem?: string,
  ): Promise<string>;
}
type TokenResponse = { connectToken: string; connectorIds: number[]; sandboxOnly: boolean };
type GatewayConnection = {
  id: string;
  institutionName: string;
  status: string;
  consentExpiresAt: string | null;
};
const connection = (row: GatewayConnection): ExternalConnection => ({
  id: row.id,
  institutionName: row.institutionName,
  status: ['UPDATED', 'UPDATING', 'OUTDATED', 'connected'].includes(row.status)
    ? 'connected'
    : row.status === 'consent_expired'
      ? 'consent_expired'
      : 'reconnect_required',
  consentExpiresAt: row.consentExpiresAt,
});
const pathFor = (id: string) => `/v1/open-finance/connections/${encodeURIComponent(id)}`;

/** Pluggy-specific orchestration stays outside FinanceRepository and its SQLite schema. */
export class PluggyFinancialConnectionProvider implements FinancialConnectionProvider {
  readonly id = 'pluggy';
  constructor(
    private readonly gateway: FinanceGatewayTransport,
    private readonly connectFlow: PluggyConnectFlow,
  ) {}

  async connect(): Promise<ExternalConnection> {
    const { connectToken, connectorIds, sandboxOnly } = await this.gateway.request<TokenResponse>(
      'POST',
      '/v1/open-finance/connect-token',
      {},
    );
    const itemId = await this.connectFlow.open(connectToken, connectorIds, sandboxOnly);
    const remote = await this.gateway.request<GatewayConnection>(
      'POST',
      '/v1/open-finance/connections',
      { itemId },
    );
    return connection(remote);
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.gateway.request('DELETE', pathFor(connectionId));
  }

  async refreshConsent(connectionId: string): Promise<ExternalConnection> {
    const { connectToken, connectorIds, sandboxOnly } = await this.gateway.request<TokenResponse>(
      'POST',
      '/v1/open-finance/connect-token',
      { itemId: connectionId },
    );
    const itemId = await this.connectFlow.open(
      connectToken,
      connectorIds,
      sandboxOnly,
      connectionId,
    );
    if (itemId !== connectionId) throw Error('A reconexão retornou outra instituição.');
    const remote = await this.gateway.request<GatewayConnection>(
      'POST',
      '/v1/open-finance/connections',
      { itemId },
    );
    return connection(remote);
  }

  async getConnectionStatus(connectionId: string): Promise<ExternalConnection['status']> {
    const remote = await this.gateway.request<GatewayConnection>(
      'GET',
      `${pathFor(connectionId)}/status`,
    );
    return connection(remote).status;
  }

  async listAccounts(connectionId: string): Promise<ExternalAccount[]> {
    const result = await this.gateway.request<{ accounts: ExternalAccount[] }>(
      'GET',
      `${pathFor(connectionId)}/accounts`,
    );
    return result.accounts;
  }

  async listTransactions(
    connectionId: string,
    accountId: string,
    fromDate: string,
    cursor: string | null,
  ): Promise<TransactionPage> {
    const query = new URLSearchParams({ accountId, from: fromDate });
    if (cursor) query.set('after', cursor);
    return this.gateway.request<TransactionPage>(
      'GET',
      `${pathFor(connectionId)}/transactions?${query}`,
    );
  }

  async acknowledgeSync(connectionId: string): Promise<void> {
    await this.gateway.request('POST', `${pathFor(connectionId)}/sync`, {});
  }
}
