const BASE = 'https://api.pluggy.ai';

export class PluggyClient {
  constructor({ clientId, clientSecret, fetchImpl = fetch }) {
    if (!clientId || !clientSecret) throw Error('Pluggy credentials missing');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
    this.key = null;
    this.keyUntil = 0;
    this.keyPending = null;
  }
  async request(path, { method = 'GET', body, key, retry = true } = {}) {
    let response;
    for (let attempt = 0; ; attempt++) {
      response = await this.fetch(`${BASE}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (method !== 'GET' || ![429, 500, 502, 503, 504].includes(response.status) || attempt >= 2)
        break;
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 60_000)
          : 200 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (response.status === 401 && key && retry) {
      this.key = null;
      this.keyUntil = 0;
      return this.request(path, { method, body, key: await this.apiKey(), retry: false });
    }
    if (!response.ok) {
      const error = new Error(`pluggy_${response.status}`);
      error.status = response.status;
      error.retryAfter = response.headers.get('retry-after');
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  async apiKey() {
    if (this.key && Date.now() < this.keyUntil) return this.key;
    if (this.keyPending) return this.keyPending;
    this.keyPending = (async () => {
      const result = await this.request('/auth', {
        method: 'POST',
        body: { clientId: this.clientId, clientSecret: this.clientSecret },
      });
      if (typeof result?.apiKey !== 'string') throw Error('pluggy_auth_invalid');
      this.key = result.apiKey;
      this.keyUntil = Date.now() + 115 * 60_000; // Official lifetime: 120 minutes; refresh early.
      return this.key;
    })();
    try {
      return await this.keyPending;
    } finally {
      this.keyPending = null;
    }
  }
  async call(path, options = {}) {
    return this.request(path, { ...options, key: await this.apiKey() });
  }
  connectToken(clientUserId, itemId) {
    return this.call('/connect_token', {
      method: 'POST',
      body: {
        ...(itemId ? { itemId } : {}),
        options: { clientUserId, avoidDuplicates: true },
      },
    });
  }
  item(id) {
    return this.call(`/items/${encodeURIComponent(id)}`);
  }
  accounts(itemId) {
    return this.call(`/accounts?itemId=${encodeURIComponent(itemId)}`);
  }
  account(id) {
    return this.call(`/accounts/${encodeURIComponent(id)}`);
  }
  sandboxConnectors() {
    return this.call('/connectors?sandbox=true');
  }
  transactions(accountId, dateFrom, after) {
    const query = new URLSearchParams({ accountId, dateFrom, ...(after ? { after } : {}) });
    return this.call(`/v2/transactions?${query}`);
  }
  deleteItem(id) {
    return this.call(`/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  webhooks() {
    return this.call('/webhooks');
  }
  createWebhook(url, secret) {
    return this.call('/webhooks', {
      method: 'POST',
      body: {
        url,
        event: 'all',
        headers: { 'X-Rumo-Webhook-Secret': secret },
      },
    });
  }
}
