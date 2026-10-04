import { describe, expect, it } from 'vitest';
import {
  PluggyFinancialConnectionProvider,
  type FinanceGatewayTransport,
} from '../src/features/finance/connections/pluggy-provider';

describe('Pluggy provider boundary', () => {
  it('uses scoped Connect Token and Item ID, never server credentials', async () => {
    const calls: [string, string, object | undefined][] = [];
    const gateway: FinanceGatewayTransport = {
      async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: object): Promise<T> {
        calls.push([method, path, body]);
        if (path.endsWith('connect-token'))
          return { connectToken: 'ephemeral', connectorIds: [123], sandboxOnly: true } as T;
        if (method === 'POST')
          return {
            id: 'item-1',
            institutionName: 'Sandbox',
            status: 'UPDATED',
            consentExpiresAt: null,
          } as T;
        if (path.endsWith('/accounts'))
          return {
            accounts: [
              {
                id: 'account-1',
                name: 'Checking',
                type: 'checking',
                currency: 'BRL',
                lastFour: null,
                balanceCents: null,
              },
            ],
          } as T;
        if (path.includes('/transactions')) return { rows: [], nextCursor: null } as T;
        return {
          id: 'item-1',
          institutionName: 'Sandbox',
          status: 'UPDATED',
          consentExpiresAt: null,
        } as T;
      },
    };
    const provider = new PluggyFinancialConnectionProvider(gateway, {
      async open(token, connectorIds, sandboxOnly) {
        expect(token).toBe('ephemeral');
        expect(connectorIds).toEqual([123]);
        expect(sandboxOnly).toBe(true);
        return 'item-1';
      },
    });
    expect(await provider.connect()).toMatchObject({ id: 'item-1', status: 'connected' });
    expect(await provider.listAccounts('item-1')).toHaveLength(1);
    expect(await provider.listTransactions('item-1', 'account-1', '2026-09-01', null)).toEqual({
      rows: [],
      nextCursor: null,
    });
    await provider.disconnect('item-1');
    expect(calls).toContainEqual(['POST', '/v1/open-finance/connect-token', {}]);
    expect(calls).toContainEqual(['DELETE', '/v1/open-finance/connections/item-1', undefined]);
    expect(JSON.stringify(calls)).not.toContain('clientSecret');
  });
});
