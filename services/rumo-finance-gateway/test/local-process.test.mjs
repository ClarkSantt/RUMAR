import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test('personal loopback child ends with parent stdin and rejects an occupied port', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rumo-personal-gateway-'));
  const port = await freePort();
  const env = {
    ...process.env,
    GATEWAY_MODE: 'personal',
    GATEWAY_DEPLOYMENT: 'local',
    GATEWAY_DATABASE_PATH: join(directory, 'gateway.db'),
    GATEWAY_PUBLIC_URL: `http://127.0.0.1:${port}`,
    GATEWAY_PORT: String(port),
    GATEWAY_WEBHOOK_SECRET: 'w'.repeat(40),
    GATEWAY_ALLOW_LIVE: 'false',
    GATEWAY_LIVE_PILOT_APPROVED: 'false',
    GATEWAY_INSTANCE_ID: 'test-instance',
    GATEWAY_BOOTSTRAP_PAIR_CODE: 'test-bootstrap-' + 'a'.repeat(48),
    GATEWAY_PARENT_STDIN: '1',
    PLUGGY_CLIENT_ID: 'fake-id',
    PLUGGY_CLIENT_SECRET: 'fake-secret',
  };
  const launch = () =>
    spawn(process.execPath, ['src/server.mjs'], { env, stdio: ['pipe', 'ignore', 'ignore'] });
  const child = launch();
  let duplicate;
  try {
    let health;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const result = await fetch(`http://127.0.0.1:${port}/health`);
        if (result.ok) {
          health = await result.json();
          break;
        }
      } catch {
        /* starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(health?.environment, 'personal');
    assert.equal(health?.instanceId, 'test-instance');
    const pair = await fetch(`http://127.0.0.1:${port}/v1/device/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: env.GATEWAY_BOOTSTRAP_PAIR_CODE }),
    });
    assert.equal(pair.status, 201);
    const replay = await fetch(`http://127.0.0.1:${port}/v1/device/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: env.GATEWAY_BOOTSTRAP_PAIR_CODE }),
    });
    assert.equal(replay.status, 401);
    duplicate = launch();
    const duplicateExit = await Promise.race([
      new Promise((resolve) => duplicate.once('exit', resolve)),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('duplicate gateway did not exit')), 5000),
      ),
    ]);
    assert.notEqual(duplicateExit, 0);
    child.stdin.end();
    const exit = await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('gateway child did not stop')), 5000),
      ),
    ]);
    assert.equal(exit, 0);
  } finally {
    if (duplicate?.exitCode === null) duplicate.kill();
    if (child.exitCode === null) child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
