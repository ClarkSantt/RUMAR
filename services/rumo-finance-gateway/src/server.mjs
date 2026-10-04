import { GatewayStore } from './store.mjs';
import { PluggyClient } from './pluggy.mjs';
import { createGateway } from './app.mjs';
import { gatewayConfig } from './config.mjs';

const config = gatewayConfig();
const store = new GatewayStore(config.databasePath);
if (process.env.GATEWAY_BOOTSTRAP_PAIR_CODE) {
  store.installBootstrapCode(process.env.GATEWAY_BOOTSTRAP_PAIR_CODE);
  delete process.env.GATEWAY_BOOTSTRAP_PAIR_CODE;
}
const pluggy = new PluggyClient({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
});
const server = createGateway({
  store,
  pluggy,
  webhookSecret: config.webhookSecret,
  publicUrl: config.publicUrl,
  allowLive: config.allowLive,
  mode: config.mode,
  instanceId: process.env.GATEWAY_INSTANCE_ID || null,
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
// The gateway listens only on loopback; a production reverse proxy must terminate HTTPS.
server.listen(config.port, '127.0.0.1', () =>
  process.stdout.write(`Gateway listening on loopback port ${config.port}\n`),
);
process.on('SIGTERM', () => server.close(() => store.close()));
if (process.env.GATEWAY_PARENT_STDIN === '1') {
  process.stdin.resume();
  process.stdin.on('end', () => server.close(() => store.close()));
}
