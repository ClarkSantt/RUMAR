import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
const invoke = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
const identifier = await invoke('plugin:app|identifier');
assert.equal(identifier, 'com.rumo.validation.phase6');
const select = (query) => invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values: [] });
const schemaSql = (await select("SELECT sql FROM sqlite_master WHERE name='_sqlx_migrations'"))[0]
  .sql;
const rows = await select(
  'SELECT version,description,installed_on,success,hex(checksum) checksum,execution_time FROM _sqlx_migrations ORDER BY version',
);
await mkdir('artifacts/phase6', { recursive: true });
await writeFile(
  'artifacts/phase6/migration-metadata.json',
  JSON.stringify({ identifier, schemaSql, rows }, null, 2),
);
await browser.close();
