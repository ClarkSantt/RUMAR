import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
const sql = (query, values = [], execute = false) =>
  page.evaluate(
    ({ query, values, execute }) =>
      window.__TAURI_INTERNALS__.invoke(`plugin:sql|${execute ? 'execute' : 'select'}`, {
        db: 'sqlite:rumo.db',
        query,
        values,
      }),
    { query, values, execute },
  );
try {
  assert.equal(
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier')),
    'com.rumo.validation.v140',
  );
  const tables = [
    'planner_time_blocks',
    'focus_sessions',
    'planner_preferences',
    'tasks',
    'settings',
  ];
  const before = Object.fromEntries(
    await Promise.all(tables.map(async (t) => [t, await sql(`SELECT * FROM ${t} ORDER BY rowid`)])),
  );
  const destination = resolve('artifacts/v140/planner-backup.zip');
  const manifest = await page.evaluate(
    (destination) => window.__TAURI_INTERNALS__.invoke('create_backup', { destination }),
    destination,
  );
  assert.equal(manifest.schemaVersion, 16);
  await sql("UPDATE planner_time_blocks SET notes='Alteração após backup'", [], true);
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:sql|close', { db: 'sqlite:rumo.db' }),
  );
  const preventive = await page.evaluate(
    (source) => window.__TAURI_INTERNALS__.invoke('restore_backup', { source }),
    destination,
  );
  await page.reload();
  await page.getByRole('heading', { name: /Boa noite|Bom dia|Boa tarde/ }).waitFor();
  const after = Object.fromEntries(
    await Promise.all(tables.map(async (t) => [t, await sql(`SELECT * FROM ${t} ORDER BY rowid`)])),
  );
  assert.deepEqual(after, before);
  assert.match(
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('check_integrity')),
    /ok/,
  );
  await writeFile(
    'artifacts/v140/backup-result.json',
    JSON.stringify({ manifest, preventive, tables, equal: true }, null, 2),
  );
  console.log(
    'Schema 15 backup/restore preserved blocks, completed focus, preferences, tasks and settings exactly.',
  );
} finally {
  await browser.close();
}
