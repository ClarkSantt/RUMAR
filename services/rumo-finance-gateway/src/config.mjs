import { isAbsolute, resolve, sep } from 'node:path';

const required = (env, key) => {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) throw Error(`Missing ${key}`);
  return value.trim();
};

export function gatewayConfig(env = process.env) {
  const mode = required(env, 'GATEWAY_MODE');
  const deployment = required(env, 'GATEWAY_DEPLOYMENT');
  if (!['sandbox', 'personal', 'live'].includes(mode)) throw Error('Invalid GATEWAY_MODE');
  if (!['local', 'production'].includes(deployment)) throw Error('Invalid GATEWAY_DEPLOYMENT');
  if (mode === 'live') {
    if (
      deployment !== 'production' ||
      env.GATEWAY_ALLOW_LIVE !== 'true' ||
      env.GATEWAY_LIVE_PILOT_APPROVED !== 'true'
    )
      throw Error('Live mode requires explicit production pilot approval');
  } else if (env.GATEWAY_ALLOW_LIVE === 'true' || env.GATEWAY_LIVE_PILOT_APPROVED === 'true') {
    throw Error('Live flags are forbidden outside commercial Live mode');
  }
  if (mode === 'personal' && deployment !== 'local')
    throw Error('Personal mode requires local deployment');

  const port = Number(env.GATEWAY_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid GATEWAY_PORT');
  const publicUrl = required(env, 'GATEWAY_PUBLIC_URL');
  let origin;
  try {
    origin = new URL(publicUrl);
  } catch {
    throw Error('Invalid GATEWAY_PUBLIC_URL');
  }
  if (
    origin.origin !== publicUrl ||
    origin.username ||
    origin.password ||
    (deployment === 'production' &&
      (origin.protocol !== 'https:' ||
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) ||
    (deployment === 'local' && publicUrl !== `http://127.0.0.1:${port}`)
  )
    throw Error('Gateway URL does not match deployment mode');

  const databasePath = required(env, 'GATEWAY_DATABASE_PATH');
  if (!isAbsolute(databasePath)) throw Error('GATEWAY_DATABASE_PATH must be absolute');
  const projectRoot = resolve(import.meta.dirname, '..');
  if (
    deployment === 'production' &&
    (resolve(databasePath) === projectRoot || resolve(databasePath).startsWith(projectRoot + sep))
  )
    throw Error('Production gateway database must be outside the source checkout');

  const webhookSecret = required(env, 'GATEWAY_WEBHOOK_SECRET');
  if (webhookSecret.length < 32) throw Error('GATEWAY_WEBHOOK_SECRET is too short');
  return {
    publicUrl,
    databasePath,
    webhookSecret,
    port,
    allowLive: mode === 'live',
    mode,
    clientId: required(env, 'PLUGGY_CLIENT_ID'),
    clientSecret: required(env, 'PLUGGY_CLIENT_SECRET'),
  };
}
