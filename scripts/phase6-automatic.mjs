import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
const invoke = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
assert.equal(await invoke('plugin:app|identifier'), 'com.rumo.validation.phase6');
const info = await invoke('data_info');
assert.match(
  info.automaticDirectory.replaceAll('\\', '/'),
  /com\.rumo\.validation\.phase6\/backups$/,
);
const execute = (query) =>
  invoke('plugin:sql|execute', { db: 'sqlite:rumo.db', query, values: [] });
const manual = join(info.automaticDirectory, 'RUMO-auto-0.zip');
await invoke('create_backup', { destination: manual });
await execute(
  "UPDATE backup_preferences SET frequency='daily',keep_count=2,last_auto_at=NULL WHERE id=1",
);
const created = [];
for (let attempt = 0; attempt < 3; attempt++) {
  await execute("UPDATE backup_preferences SET last_auto_at='0' WHERE id=1");
  const path = await invoke('automatic_backup');
  assert(path?.includes('RUMO-auto-'));
  created.push(path);
  await new Promise((resolve) => setTimeout(resolve, 1100));
}
const files = await readdir(info.automaticDirectory);
assert(files.includes('RUMO-auto-0.zip'), 'Manual backup must survive retention');
assert(
  !files.includes(created[0].split(/[\\/]/).at(-1)),
  'Oldest automatic backup must be removed',
);
assert(files.includes(created[1].split(/[\\/]/).at(-1)));
assert(files.includes(created[2].split(/[\\/]/).at(-1)));
await execute("UPDATE backup_preferences SET frequency='off' WHERE id=1");
console.log(JSON.stringify({ automaticCreated: 3, automaticRetained: 2, manualRetained: true }));
await browser.close();
