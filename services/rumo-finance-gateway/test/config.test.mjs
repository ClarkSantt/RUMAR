import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gatewayConfig } from '../src/config.mjs';

const valid = () => ({
  GATEWAY_MODE: 'sandbox',
  GATEWAY_DEPLOYMENT: 'local',
  GATEWAY_DATABASE_PATH: join(tmpdir(), 'rumo-gateway-config-test.db'),
  GATEWAY_PUBLIC_URL: 'http://127.0.0.1:8787',
  GATEWAY_WEBHOOK_SECRET: 'w'.repeat(40),
  GATEWAY_PORT: '8787',
  GATEWAY_ALLOW_LIVE: 'false',
  GATEWAY_LIVE_PILOT_APPROVED: 'false',
  PLUGGY_CLIENT_ID: 'test-client-id',
  PLUGGY_CLIENT_SECRET: 'test-client-secret',
});

test('Sandbox local is explicit and keeps Live disabled', () => {
  const config = gatewayConfig(valid());
  assert.equal(config.allowLive, false);
  assert.equal(config.publicUrl, 'http://127.0.0.1:8787');
});

test('personal Meu Pluggy mode is local-only and never enables commercial Live', () => {
  const config = gatewayConfig({ ...valid(), GATEWAY_MODE: 'personal' });
  assert.equal(config.mode, 'personal');
  assert.equal(config.allowLive, false);
  assert.throws(() =>
    gatewayConfig({ ...valid(), GATEWAY_MODE: 'personal', GATEWAY_ALLOW_LIVE: 'true' }),
  );
  assert.throws(() =>
    gatewayConfig({
      ...valid(),
      GATEWAY_MODE: 'personal',
      GATEWAY_DEPLOYMENT: 'production',
      GATEWAY_PUBLIC_URL: 'https://finance.example.test',
    }),
  );
});

test('production requires HTTPS, private DB, and complete server-side secrets', () => {
  const env = {
    ...valid(),
    GATEWAY_DEPLOYMENT: 'production',
    GATEWAY_PUBLIC_URL: 'https://finance.example.test',
  };
  assert.equal(gatewayConfig(env).allowLive, false);
  assert.throws(() => gatewayConfig({ ...env, GATEWAY_PUBLIC_URL: 'http://finance.example.test' }));
  assert.throws(() => gatewayConfig({ ...env, GATEWAY_PUBLIC_URL: 'https://127.0.0.1:8787' }));
  assert.throws(() => gatewayConfig({ ...env, GATEWAY_WEBHOOK_SECRET: '' }));
  assert.throws(() => gatewayConfig({ ...env, PLUGGY_CLIENT_SECRET: '' }));
  assert.throws(() => gatewayConfig({ ...env, GATEWAY_DATABASE_PATH: './gateway.db' }));
});

test('credentials alone never enable Live; pilot needs separate explicit gates', () => {
  const env = valid();
  assert.throws(() => gatewayConfig({ ...env, GATEWAY_ALLOW_LIVE: 'true' }));
  assert.throws(() => gatewayConfig({ ...env, GATEWAY_MODE: 'live' }));
  assert.throws(() =>
    gatewayConfig({
      ...env,
      GATEWAY_MODE: 'live',
      GATEWAY_DEPLOYMENT: 'production',
      GATEWAY_PUBLIC_URL: 'https://finance.example.test',
      GATEWAY_ALLOW_LIVE: 'true',
    }),
  );
});

test('configuration errors do not expose secret values', () => {
  const env = { ...valid(), GATEWAY_PUBLIC_URL: 'http://public.example.test' };
  assert.throws(
    () => gatewayConfig(env),
    (error) => {
      assert.doesNotMatch(error.message, /test-client-secret|www/);
      return true;
    },
  );
});
