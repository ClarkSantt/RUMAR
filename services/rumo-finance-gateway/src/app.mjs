import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { normalizeAccount, normalizeTransaction } from './normalize.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = /^\d{4}-\d{2}-\d{2}$/;
function nextCursor(next, accountId, from) {
  if (next == null) return null;
  if (typeof next !== 'string' || !next.startsWith('?') || next.length > 2048)
    throw Error('invalid_cursor');
  const query = new URLSearchParams(next.slice(1));
  if (
    query.get('accountId') !== accountId ||
    (query.has('dateFrom') && query.get('dateFrom') !== from) ||
    query.getAll('after').length !== 1 ||
    !query.get('after')
  )
    throw Error('invalid_cursor');
  return query.get('after');
}
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
};
const json = (res, status, data) => {
  const codes = {
    unauthorized: 'unauthorized_device',
    pair_code_invalid: 'pairing_expired',
    invalid_json: 'invalid_request',
    invalid_query: 'invalid_request',
    invalid_version: 'invalid_request',
    invalid_item: 'invalid_request',
    invalid_event: 'invalid_request',
    upstream_unavailable: 'provider_unavailable',
  };
  const payload = data.error
    ? {
        code: codes[data.error] || data.error,
        message:
          status >= 500 ? 'Serviço temporariamente indisponível.' : 'Solicitação não concluída.',
        ...data,
      }
    : data;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
};
async function body(req) {
  let size = 0,
    chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw Object.assign(Error('body_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(Error('invalid_json'), { status: 400 });
  }
}

export function createGateway({
  store,
  pluggy,
  webhookSecret,
  publicUrl,
  ratePerMinute = 60,
  allowLive = false,
  mode = allowLive ? 'live' : 'sandbox',
  instanceId = null,
}) {
  if (!['sandbox', 'personal', 'live'].includes(mode) || (mode === 'live') !== allowLive)
    throw Error('Invalid gateway connector policy');
  if (!webhookSecret || webhookSecret.length < 32)
    throw Error('GATEWAY_WEBHOOK_SECRET must be at least 32 characters');
  let origin;
  try {
    origin = new URL(publicUrl);
  } catch {
    throw Error('Invalid GATEWAY_PUBLIC_URL');
  }
  if (
    !publicUrl ||
    origin.origin !== publicUrl ||
    origin.username ||
    origin.password ||
    (origin.protocol !== 'https:' &&
      !(origin.protocol === 'http:' && origin.hostname === '127.0.0.1'))
  )
    throw Error('GATEWAY_PUBLIC_URL must use HTTPS outside local development');
  const buckets = new Map();
  const route = async (req, res) => {
    const url = new URL(req.url, publicUrl);
    const address = req.socket.remoteAddress || '';
    const minute = Math.floor(Date.now() / 60_000);
    const bucketKey = `${address}:${minute}`;
    const count = (buckets.get(bucketKey) || 0) + 1;
    buckets.set(bucketKey, count);
    if (buckets.size > 10_000) buckets.clear();
    if (count > ratePerMinute) return json(res, 429, { error: 'rate_limited' });
    if (req.method === 'GET' && url.pathname === '/health')
      return json(res, 200, {
        status: 'ok',
        version: '0.1.0',
        apiVersion: 'v1',
        environment: mode,
        ...(instanceId ? { instanceId } : {}),
      });
    try {
      if (req.method === 'POST' && url.pathname === '/v1/webhooks/pluggy') {
        if (!safeEqual(req.headers['x-rumo-webhook-secret'], webhookSecret))
          return json(res, 401, { error: 'unauthorized' });
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
          return json(res, 415, { error: 'unsupported_media_type' });
        const event = await body(req);
        if (!event || typeof event !== 'object' || Array.isArray(event))
          return json(res, 400, { error: 'invalid_event' });
        // The registered "all" webhook may include payment events; acknowledge but never process them.
        if (typeof event.event === 'string' && !/^(item|transactions)\//.test(event.event))
          return json(res, 200, { accepted: false });
        if (
          !uuid.test(event.eventId || '') ||
          !uuid.test(event.itemId || '') ||
          typeof event.event !== 'string'
        )
          return json(res, 400, { error: 'invalid_event' });
        return json(res, 200, { accepted: store.markDirty(event.itemId, event.eventId) });
      }
      if (req.method === 'POST' && url.pathname === '/v1/device/pair') {
        const input = await body(req);
        const device = store.pair(input.code);
        return device ? json(res, 201, device) : json(res, 401, { error: 'pair_code_invalid' });
      }
      const deviceId = store.authenticate(req.headers.authorization);
      if (!deviceId) return json(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/v1/open-finance/connections')
        return json(res, 200, { connections: store.items(deviceId) });
      if (req.method === 'POST' && url.pathname === '/v1/open-finance/connect-token') {
        const input = await body(req);
        const itemId = input.itemId;
        if (itemId && (!uuid.test(itemId) || !store.ownItem(deviceId, itemId)))
          return json(res, 404, { error: 'connection_not_found' });
        const token = await pluggy.connectToken(deviceId, itemId);
        if (typeof token?.accessToken !== 'string' || token.accessToken.length < 8)
          throw Error('pluggy_token_invalid');
        const connectors = mode === 'sandbox' ? await pluggy.sandboxConnectors() : null;
        const connectorIds =
          mode === 'personal'
            ? [200]
            : connectors?.results
                ?.filter((row) => row.isSandbox === true)
                .map((row) => row.id)
                .filter(Number.isInteger) || [];
        if (mode === 'sandbox' && connectorIds.length === 0)
          return json(res, 503, { error: 'sandbox_unavailable' });
        return json(res, 200, {
          connectToken: token.accessToken,
          sandboxOnly: mode === 'sandbox',
          connectorIds,
          connectionMode: mode === 'personal' ? 'personal_meu_pluggy' : mode,
        });
      }
      if (req.method === 'POST' && url.pathname === '/v1/open-finance/connections') {
        const input = await body(req);
        if (!uuid.test(input.itemId || '')) return json(res, 400, { error: 'invalid_item' });
        const item = await pluggy.item(input.itemId);
        if (item.clientUserId !== deviceId) return json(res, 403, { error: 'item_owner_mismatch' });
        if (mode === 'sandbox' && item.connector?.isSandbox !== true)
          return json(res, 403, { error: 'sandbox_only' });
        if (mode === 'personal' && item.connector?.id !== 200)
          return json(res, 403, { error: 'personal_connector_only' });
        if (!store.saveItem(deviceId, item.id, item.connector?.name || 'Instituição'))
          return json(res, 409, { error: 'item_owned_elsewhere' });
        return json(res, 201, {
          id: item.id,
          institutionName: item.connector?.name || 'Instituição',
          status: item.status,
          consentExpiresAt: item.consentExpiresAt || null,
        });
      }
      const match =
        /^\/v1\/open-finance\/connections\/([0-9a-f-]{36})(?:\/(status|accounts|transactions|sync))?$/.exec(
          url.pathname,
        );
      if (!match || !uuid.test(match[1])) return json(res, 404, { error: 'not_found' });
      const itemId = match[1],
        action = match[2];
      if (!store.ownItem(deviceId, itemId))
        return json(res, 404, { error: 'connection_not_found' });
      if (req.method === 'DELETE' && !action) {
        // The Meu Pluggy consent belongs to the user. Disconnect only this local mapping.
        if (mode !== 'personal') await pluggy.deleteItem(itemId);
        store.deleteItem(deviceId, itemId);
        return json(res, 200, { disconnected: true });
      }
      if (req.method === 'GET' && action === 'status') {
        const item = await pluggy.item(itemId);
        const state = store.ownItem(deviceId, itemId);
        return json(res, 200, {
          id: item.id,
          institutionName: item.connector?.name || 'Instituição',
          status: item.status,
          consentExpiresAt: item.consentExpiresAt || null,
          updatesAvailable: Boolean(state.dirty),
          dirtyVersion: state.dirty_version,
        });
      }
      if (req.method === 'GET' && action === 'accounts') {
        const result = await pluggy.accounts(itemId);
        return json(res, 200, { accounts: result.results.map(normalizeAccount) });
      }
      if (req.method === 'GET' && action === 'transactions') {
        const accountId = url.searchParams.get('accountId'),
          from = url.searchParams.get('from'),
          after = url.searchParams.get('after');
        if (!uuid.test(accountId || '') || !day.test(from || '') || (after && after.length > 2048))
          return json(res, 400, { error: 'invalid_query' });
        const account = await pluggy.account(accountId);
        if (account.itemId !== itemId) return json(res, 403, { error: 'account_owner_mismatch' });
        const page = await pluggy.transactions(accountId, from, after);
        const next = nextCursor(page.next, accountId, from);
        return json(res, 200, {
          rows: page.results.map((row) =>
            normalizeTransaction(row, normalizeAccount(account).type),
          ),
          nextCursor: next,
        });
      }
      if (req.method === 'POST' && action === 'sync') {
        const input = await body(req);
        if (!Number.isSafeInteger(input.dirtyVersion) || input.dirtyVersion < 0)
          return json(res, 400, { error: 'invalid_version' });
        return json(res, 200, {
          acknowledged: store.clearDirty(deviceId, itemId, input.dirtyVersion),
        });
      }
      return json(res, 405, { error: 'method_not_allowed' });
    } catch (error) {
      // Do not return provider payloads, credentials, stack traces, or financial data.
      const status =
        error.status === 413
          ? 413
          : error.status === 429
            ? 503
            : error.status === 404
              ? 502
              : error.status === 400
                ? 400
                : 502;
      return json(res, status, {
        error:
          error.message === 'body_too_large'
            ? 'body_too_large'
            : error.message === 'invalid_json'
              ? 'invalid_json'
              : error.status === 429
                ? 'provider_rate_limited'
                : 'provider_unavailable',
      });
    }
  };
  return createServer(route);
}
