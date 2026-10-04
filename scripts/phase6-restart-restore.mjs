import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const endpoint = 'http://127.0.0.1:9226';
const expectedIdentifier = 'com.rumo.validation.phase6';
const invoke = (page, command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
const select = (page, query) =>
  invoke(page, 'plugin:sql|select', { db: 'sqlite:rumo.db', query, values: [] });

async function connectVerified() {
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      const browser = await chromium.connectOverCDP(endpoint, { timeout: 1500 });
      const page = browser.contexts()[0]?.pages()[0];
      if (!page) throw new Error('Janela de validação ausente');
      assert.equal(await invoke(page, 'plugin:app|identifier'), expectedIdentifier);
      const info = await invoke(page, 'data_info');
      assert.match(
        info.databasePath.replaceAll('\\', '/'),
        /com\.rumo\.validation\.phase6\/rumo\.db$/,
      );
      return { browser, page };
    } catch (error) {
      if (attempt === 44) throw error;
      await delay(1000);
    }
  }
}

let { browser, page } = await connectVerified();
assert.equal(
  (await select(page, "SELECT title FROM tasks WHERE title='Estado B'"))[0]?.title,
  'Estado B',
);
const old = resolve('artifacts/phase6/old-phase4.zip');
assert.equal((await invoke(page, 'inspect_backup', { source: old })).schemaVersion, 5);
await invoke(page, 'plugin:sql|close', { db: 'sqlite:rumo.db' });
const preventive = await invoke(page, 'restore_backup', { source: old });
assert.equal((await invoke(page, 'inspect_backup', { source: preventive })).kind, 'pre_restore');
void invoke(page, 'restart_after_restore').catch(() => {});
await delay(4000);
await browser.close().catch(() => {});
({ browser, page } = await connectVerified());
assert.equal(
  (await select(page, 'SELECT MAX(version) version FROM _sqlx_migrations'))[0].version,
  8,
);
assert.equal(
  (await select(page, "SELECT title FROM tasks WHERE id='old-task'"))[0]?.title,
  'Tarefa da Fase 4',
);
assert.equal((await select(page, 'PRAGMA integrity_check'))[0].integrity_check, 'ok');

await invoke(page, 'plugin:sql|close', { db: 'sqlite:rumo.db' });
await invoke(page, 'restore_backup', { source: preventive });
void invoke(page, 'restart_after_restore').catch(() => {});
await delay(4000);
await browser.close().catch(() => {});
({ browser, page } = await connectVerified());
assert.equal(
  (await select(page, 'SELECT MAX(version) version FROM _sqlx_migrations'))[0].version,
  8,
);
assert.equal(
  (await select(page, "SELECT title FROM tasks WHERE title='Estado B'"))[0]?.title,
  'Estado B',
);
assert.equal(
  (
    await select(
      page,
      "SELECT amount_cents FROM finance_transactions WHERE id='release-transaction'",
    )
  )[0]?.amount_cents,
  12345,
);
assert.equal((await select(page, 'PRAGMA integrity_check'))[0].integrity_check, 'ok');
console.log(JSON.stringify({ oldSchema: 5, migratedTo: 9, preventive, restoredCurrent: true }));
await browser.close();
