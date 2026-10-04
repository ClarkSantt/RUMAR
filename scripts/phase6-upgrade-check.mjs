import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
const invoke = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
const select = (query) => invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values: [] });
assert.equal(await invoke('plugin:app|identifier'), 'com.rumo.validation.phase6');
const info = await invoke('data_info');
assert.match(info.databasePath.replaceAll('\\', '/'), /com\.rumo\.validation\.phase6\/rumo\.db$/);
assert.equal(await invoke('plugin:app|version'), '1.0.0');
assert.equal((await select('SELECT MAX(version) AS version FROM _sqlx_migrations'))[0].version, 9);
assert.equal(
  (await select("SELECT title FROM tasks WHERE title='Estado B'"))[0]?.title,
  'Estado B',
);
assert.equal(
  (await select("SELECT amount_cents FROM finance_transactions WHERE id='release-transaction'"))[0]
    ?.amount_cents,
  12345,
);
assert.equal((await select('PRAGMA integrity_check'))[0].integrity_check, 'ok');
console.log(
  JSON.stringify({ version: '1.0.0', schema: 9, task: true, finance: true, integrity: 'ok' }),
);
await browser.close();
