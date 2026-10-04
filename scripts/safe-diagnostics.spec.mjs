import test from 'node:test';
import assert from 'node:assert/strict';
import { externalRequestDiagnostic, frameDiagnostic } from './safe-diagnostics.mjs';

test('diagnostics never include URL, iframe name, or Connect Token', () => {
  const token = 'temporary-connect-token-must-remain-private';
  const url = `https://connect.pluggy.ai/${token}?connectToken=${token}#${token}`;
  assert.equal(externalRequestDiagnostic(url), 'external-request');
  assert.equal(externalRequestDiagnostic('http://tauri.localhost/app'), null);
  assert.equal(externalRequestDiagnostic('https://ipc.localhost/secret'), null);
  assert.deepEqual(frameDiagnostic({ name: url, url }), { framePresent: true });
  assert.doesNotMatch(
    JSON.stringify([externalRequestDiagnostic(url), frameDiagnostic({ name: url })]),
    /temporary-connect-token/,
  );
});
