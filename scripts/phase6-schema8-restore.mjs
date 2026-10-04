import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const invoke = (page, command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
const select = (page, query) =>
  invoke(page, 'plugin:sql|select', { db: 'sqlite:rumo.db', query, values: [] });
async function connect() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { timeout: 1500 });
      const page = browser.contexts()[0].pages()[0];
      assert.equal(await invoke(page, 'plugin:app|identifier'), 'com.rumo.validation.phase6');
      assert.match(
        (await invoke(page, 'data_info')).databasePath.replaceAll('\\', '/'),
        /com\.rumo\.validation\.phase6\/rumo\.db$/,
      );
      return { browser, page };
    } catch (error) {
      if (attempt === 39) throw error;
      await delay(500);
    }
  }
}
let { browser, page } = await connect();
const old = resolve('artifacts/phase6/final-cases/old-schema8.zip');
assert.equal((await invoke(page, 'inspect_backup', { source: old })).schemaVersion, 8);
await invoke(page, 'plugin:sql|close', { db: 'sqlite:rumo.db' });
const preventive = await invoke(page, 'restore_backup', { source: old });
void invoke(page, 'restart_after_restore').catch(() => {});
await delay(2500);
await browser.close().catch(() => {});
({ browser, page } = await connect());
assert.equal(
  (await select(page, 'SELECT MAX(version) version FROM _sqlx_migrations'))[0].version,
  9,
);
assert.equal(
  (await select(page, "SELECT value FROM body_measurement_values WHERE metric_key='weight'"))[0]
    .value,
  70,
);
assert.equal((await select(page, 'PRAGMA integrity_check'))[0].integrity_check, 'ok');
assert.equal((await invoke(page, 'inspect_backup', { source: preventive })).schemaVersion, 9);
await invoke(page, 'plugin:sql|close', { db: 'sqlite:rumo.db' });
await invoke(page, 'restore_backup', { source: preventive });
void invoke(page, 'restart_after_restore').catch(() => {});
await delay(2500);
await browser.close().catch(() => {});
({ browser, page } = await connect());
assert.equal(
  (await select(page, "SELECT value FROM body_measurement_values WHERE metric_key='weight'"))[0]
    .value,
  70.5,
);
assert.equal((await select(page, 'PRAGMA integrity_check'))[0].integrity_check, 'ok');
console.log(
  JSON.stringify({
    oldSchema: 8,
    migratedTo: 9,
    oldWeight: 70,
    preventiveWeight: 70.5,
    integrity: 'ok',
  }),
);
await browser.close();
