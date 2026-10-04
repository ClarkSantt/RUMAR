import { GatewayStore } from './store.mjs';
import { PluggyClient } from './pluggy.mjs';
const path = process.env.GATEWAY_DATABASE_PATH;
if (!path) throw Error('Missing GATEWAY_DATABASE_PATH');
const store = new GatewayStore(path);
try {
  if (process.argv[2] === 'pair-code') process.stdout.write(`${store.createPairCode()}\n`);
  else if (process.argv[2] === 'revoke-device' && process.argv[3])
    process.stdout.write(`${store.revoke(process.argv[3]) ? 'Revoked' : 'Not found'}\n`);
  else if (process.argv[2] === 'register-webhook') {
    const base = process.env.GATEWAY_PUBLIC_URL;
    const secret = process.env.GATEWAY_WEBHOOK_SECRET;
    if (!base?.startsWith('https://') || !secret || secret.length < 32)
      throw Error('HTTPS public URL and webhook secret required');
    const pluggy = new PluggyClient({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    });
    const url = `${base}/v1/webhooks/pluggy`;
    const existing = await pluggy.webhooks();
    if (existing?.results?.some((entry) => entry.url === url && entry.event === 'all'))
      process.stdout.write(
        'Webhook already registered; verify configured header after any secret rotation.\n',
      );
    else {
      await pluggy.createWebhook(url, secret);
      process.stdout.write('Webhook registered.\n');
    }
  } else throw Error('Usage: pair-code | revoke-device <device-id> | register-webhook');
} finally {
  store.close();
}
