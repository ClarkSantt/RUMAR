import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayStore } from '../src/store.mjs';
import { PluggyClient } from '../src/pluggy.mjs';
import { createGateway } from '../src/app.mjs';
import { normalizeAccount, normalizeTransaction } from '../src/normalize.mjs';

function fixture(mode = 'sandbox') {
  const store = new GatewayStore(':memory:');
  const itemId = '11111111-1111-4111-8111-111111111111';
  const accountId = '22222222-2222-4222-8222-222222222222';
  const eventId = '33333333-3333-4333-8333-333333333333';
  const calls = [];
  const pluggy = {
    async connectToken(deviceId) {
      calls.push(['token', deviceId]);
      return { accessToken: 'short-lived-widget-token' };
    },
    async item(id) {
      return {
        id,
        clientUserId: device.deviceId,
        connector:
          mode === 'personal'
            ? { id: 200, name: 'MeuPluggy', isSandbox: false }
            : { id: 123, name: 'Sandbox', isSandbox: true },
        status: 'UPDATED',
      };
    },
    async sandboxConnectors() {
      return {
        results: [
          { id: 123, isSandbox: true },
          { id: 601, isSandbox: false },
        ],
      };
    },
    async accounts() {
      return {
        results: [
          {
            id: accountId,
            name: 'Conta teste',
            type: 'BANK',
            subtype: 'CHECKING_ACCOUNT',
            currencyCode: 'BRL',
            itemId,
          },
        ],
      };
    },
    async account() {
      return { id: accountId, itemId, name: 'Conta teste', type: 'BANK', currencyCode: 'BRL' };
    },
    async transactions() {
      return {
        results: [
          {
            id: eventId,
            accountId,
            description: 'Compra',
            amount: -12.34,
            currencyCode: 'BRL',
            date: '2026-09-30T00:00:00Z',
            status: 'POSTED',
            type: 'DEBIT',
          },
        ],
        next: null,
      };
    },
    async deleteItem(id) {
      calls.push(['delete', id]);
    },
  };
  const code = store.createPairCode();
  const device = store.pair(code);
  const server = createGateway({
    store,
    pluggy,
    webhookSecret: 'x'.repeat(40),
    publicUrl: 'http://127.0.0.1:8787',
    ratePerMinute: 100,
    mode,
  });
  return { store, server, pluggy, itemId, accountId, eventId, device, code, calls };
}

test('personal mode permits only connector 200 and disconnect preserves Meu Pluggy Item', async () => {
  const f = fixture('personal');
  const base = await listen(f.server);
  try {
    const token = await request(base, '/v1/open-finance/connect-token', 'POST', auth(f.device), {});
    assert.equal(token.status, 200);
    assert.deepEqual(token.body.connectorIds, [200]);
    assert.equal(token.body.sandboxOnly, false);
    assert.equal(token.body.connectionMode, 'personal_meu_pluggy');
    assert.equal(
      (
        await request(base, '/v1/open-finance/connections', 'POST', auth(f.device), {
          itemId: f.itemId,
        })
      ).status,
      201,
    );
    assert.equal(
      (await request(base, `/v1/open-finance/connections/${f.itemId}`, 'DELETE', auth(f.device)))
        .status,
      200,
    );
    assert.equal(f.store.ownItem(f.device.deviceId, f.itemId), undefined);
    assert.deepEqual(
      f.calls.filter(([kind]) => kind === 'delete'),
      [],
    );
    f.pluggy.item = async (id) => ({
      id,
      clientUserId: f.device.deviceId,
      connector: { id: 601, isSandbox: false },
      status: 'UPDATED',
    });
    assert.equal(
      (
        await request(base, '/v1/open-finance/connections', 'POST', auth(f.device), {
          itemId: f.itemId,
        })
      ).status,
      403,
    );
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});
async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
const auth = (device) => ({ authorization: `Bearer ${device.deviceId}.${device.deviceSecret}` });
async function request(base, path, method = 'GET', headers = {}, data) {
  const result = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(data ? { 'content-type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: result.status, body: await result.json() };
}

test('one-time pairing, device revocation, authenticated endpoints and webhook idempotence', async () => {
  const f = fixture(),
    base = await listen(f.server);
  try {
    assert.equal(
      (await request(base, '/v1/device/pair', 'POST', {}, { code: f.code })).status,
      401,
    );
    assert.equal((await request(base, '/v1/open-finance/connect-token', 'POST')).status, 401);
    const token = await request(base, '/v1/open-finance/connect-token', 'POST', auth(f.device), {});
    assert.equal(token.body.connectToken, 'short-lived-widget-token');
    assert.deepEqual(token.body.connectorIds, [123]);
    assert.equal(
      (
        await request(base, '/v1/open-finance/connections', 'POST', auth(f.device), {
          itemId: f.itemId,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request(
          base,
          `/v1/open-finance/connections/${f.itemId}/accounts`,
          'GET',
          auth(f.device),
        )
      ).body.accounts[0].type,
      'checking',
    );
    const page = await request(
      base,
      `/v1/open-finance/connections/${f.itemId}/transactions?accountId=${f.accountId}&from=2026-09-01`,
      'GET',
      auth(f.device),
    );
    assert.equal(page.body.rows[0].amountCents, 1234);
    assert.equal(
      (
        await request(
          base,
          '/v1/webhooks/pluggy',
          'POST',
          {},
          { event: 'item/updated', eventId: f.eventId, itemId: f.itemId },
        )
      ).status,
      401,
    );
    const webhookHeaders = { 'x-rumo-webhook-secret': 'x'.repeat(40) };
    assert.equal(
      (
        await request(base, '/v1/webhooks/pluggy', 'POST', webhookHeaders, {
          event: 'item/updated',
          eventId: f.eventId,
          itemId: f.itemId,
        })
      ).body.accepted,
      true,
    );
    assert.equal(
      (
        await request(base, '/v1/webhooks/pluggy', 'POST', webhookHeaders, {
          event: 'item/updated',
          eventId: f.eventId,
          itemId: f.itemId,
        })
      ).body.accepted,
      false,
    );
    assert.equal(
      (
        await request(
          base,
          `/v1/open-finance/connections/${f.itemId}/status`,
          'GET',
          auth(f.device),
        )
      ).body.updatesAvailable,
      true,
    );
    assert.equal(
      (
        await request(
          base,
          `/v1/open-finance/connections/${f.itemId}/sync`,
          'POST',
          auth(f.device),
          { dirtyVersion: 1 },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          base,
          `/v1/open-finance/connections/${f.itemId}/status`,
          'GET',
          auth(f.device),
        )
      ).body.updatesAvailable,
      false,
    );
    f.store.revoke(f.device.deviceId);
    assert.equal(
      (await request(base, '/v1/open-finance/connections', 'GET', auth(f.device))).status,
      401,
    );
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('Pluggy API key is cached, concurrent calls share auth, and 401 renews once', async () => {
  let auths = 0,
    expireNext = false;
  const fakeFetch = async (url, options) => {
    if (url.endsWith('/auth')) {
      auths++;
      return Response.json({ apiKey: `key-${auths}` });
    }
    if (options.headers['x-api-key'] === 'key-1' && expireNext) {
      expireNext = false;
      return new Response('', { status: 401 });
    }
    return Response.json({ ok: true });
  };
  const client = new PluggyClient({ clientId: 'test', clientSecret: 'test', fetchImpl: fakeFetch });
  await Promise.all([client.call('/accounts'), client.call('/accounts')]);
  assert.equal(auths, 1);
  await client.call('/accounts');
  assert.equal(auths, 1);
  // Force one expired credential response.
  expireNext = true;
  await client.call('/accounts');
  assert.equal(auths, 2);
});

test('normalization preserves credit-card semantics and rejects non-BRL', () => {
  const account = normalizeAccount({
    id: 'a',
    name: 'Card',
    type: 'CREDIT',
    currencyCode: 'BRL',
    number: '1234',
    balance: 10.5,
  });
  assert.equal(account.type, 'credit_card');
  assert.equal(account.balanceCents, 1050);
  const row = {
    id: 't',
    accountId: 'a',
    description: 'Purchase',
    amount: -27.5,
    date: '2026-09-30T00:00:00Z',
    status: 'PENDING',
    currencyCode: 'BRL',
    type: 'DEBIT',
  };
  assert.equal(normalizeTransaction(row, account.type).type, 'card_purchase');
  assert.equal(
    normalizeTransaction({ ...row, type: 'CREDIT', category: 'Music streaming' }, account.type)
      .type,
    'card_purchase',
  );
  assert.equal(
    normalizeTransaction({ ...row, type: 'CREDIT', category: 'Card payment' }, account.type).type,
    'card_payment',
  );
  assert.equal(
    normalizeTransaction({ ...row, operationType: 'PAGAMENTO_FATURA' }, account.type).type,
    'card_payment',
  );
  assert.throws(
    () => normalizeTransaction({ ...row, currencyCode: 'USD' }, account.type),
    /unsupported_currency/,
  );
});

test('transient GET failures retry at most twice; POST is never blindly repeated', async () => {
  let calls = 0;
  const client = new PluggyClient({
    clientId: 'test',
    clientSecret: 'test',
    fetchImpl: async (url) => {
      if (url.endsWith('/auth')) return Response.json({ apiKey: 'key' });
      calls++;
      return calls < 3 ? new Response('', { status: 503 }) : Response.json({ results: [] });
    },
  });
  assert.deepEqual(await client.call('/accounts'), { results: [] });
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(client.call('/connect_token', { method: 'POST', body: {} }), /pluggy_503/);
  assert.equal(calls, 1);
});

test('a second paired device cannot claim or read the first device Item', async () => {
  const f = fixture(),
    base = await listen(f.server);
  try {
    const second = f.store.pair(f.store.createPairCode());
    assert.equal(
      (
        await request(base, '/v1/open-finance/connections', 'POST', auth(f.device), {
          itemId: f.itemId,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request(base, '/v1/open-finance/connections', 'POST', auth(second), {
          itemId: f.itemId,
        })
      ).status,
      403,
    );
    assert.deepEqual(
      (await request(base, '/v1/open-finance/connections', 'GET', auth(second))).body.connections,
      [],
    );
    assert.equal(
      (await request(base, `/v1/open-finance/connections/${f.itemId}/status`, 'GET', auth(second)))
        .status,
      404,
    );
    assert.equal(
      (
        await request(
          base,
          `/v1/open-finance/connections/${f.itemId}/accounts`,
          'GET',
          auth(second),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(base, `/v1/open-finance/connections/${f.itemId}/sync`, 'POST', auth(second), {
          dirtyVersion: 0,
        })
      ).status,
      404,
    );
    assert.equal(
      (await request(base, `/v1/open-finance/connections/${f.itemId}`, 'DELETE', auth(second)))
        .status,
      404,
    );
    assert.equal(
      f.calls.some(([operation]) => operation === 'delete'),
      false,
    );
    assert.equal(
      (
        await request(
          base,
          `/v1/open-finance/connections/${f.itemId}/transactions?accountId=${f.accountId}&from=2026-09-01`,
          'GET',
          auth(second),
        )
      ).status,
      404,
    );
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('cursor pagination accepts Pluggy query strings and rejects malformed or cross-account links', async () => {
  const f = fixture(),
    base = await listen(f.server);
  try {
    await request(base, '/v1/open-finance/connections', 'POST', auth(f.device), {
      itemId: f.itemId,
    });
    const path = `/v1/open-finance/connections/${f.itemId}/transactions?accountId=${f.accountId}&from=2026-09-01`;
    f.pluggy.transactions = async () => ({
      results: [],
      next: `?accountId=${f.accountId}&after=next-page`,
    });
    assert.equal((await request(base, path, 'GET', auth(f.device))).body.nextCursor, 'next-page');
    for (const next of ['not-a-query', '?accountId=other&after=x', `?accountId=${f.accountId}`]) {
      f.pluggy.transactions = async () => ({ results: [], next });
      const response = await request(base, path, 'GET', auth(f.device));
      assert.equal(response.status, 502);
      assert.equal(response.body.code, 'provider_unavailable');
    }
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('webhook requires JSON content type', async () => {
  const f = fixture(),
    base = await listen(f.server);
  try {
    const response = await fetch(`${base}/v1/webhooks/pluggy`, {
      method: 'POST',
      headers: { 'x-rumo-webhook-secret': 'x'.repeat(40), 'content-type': 'text/plain' },
      body: JSON.stringify({ event: 'item/updated', eventId: f.eventId, itemId: f.itemId }),
    });
    assert.equal(response.status, 415);
    assert.equal(f.store.ownItem(f.device.deviceId, f.itemId), undefined);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('webhook rejects invalid events and dirty acknowledgement cannot erase a newer event', async () => {
  const f = fixture(),
    base = await listen(f.server);
  try {
    await request(base, '/v1/open-finance/connections', 'POST', auth(f.device), {
      itemId: f.itemId,
    });
    const headers = { 'x-rumo-webhook-secret': 'x'.repeat(40) };
    assert.equal(
      (
        await request(base, '/v1/webhooks/pluggy', 'POST', headers, {
          event: 'payment_intent/created',
          eventId: f.eventId,
          itemId: f.itemId,
        })
      ).body.accepted,
      false,
    );
    await request(base, '/v1/webhooks/pluggy', 'POST', headers, {
      event: 'item/updated',
      eventId: f.eventId,
      itemId: f.itemId,
    });
    const newerEvent = '44444444-4444-4444-8444-444444444444';
    await request(base, '/v1/webhooks/pluggy', 'POST', headers, {
      event: 'transactions/created',
      eventId: newerEvent,
      itemId: f.itemId,
    });
    const ack = await request(
      base,
      `/v1/open-finance/connections/${f.itemId}/sync`,
      'POST',
      auth(f.device),
      { dirtyVersion: 1 },
    );
    assert.equal(ack.body.acknowledged, false);
    const status = await request(
      base,
      `/v1/open-finance/connections/${f.itemId}/status`,
      'GET',
      auth(f.device),
    );
    assert.equal(status.body.dirtyVersion, 2);
    assert.equal(status.body.updatesAvailable, true);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});
