import assert from 'node:assert/strict';
import { resolve } from 'node:path';
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
assert.equal(
  (await select("SELECT title FROM tasks WHERE title='Estado B'"))[0]?.title,
  'Estado B',
  'Refusing unknown profile data',
);

const cases = [
  'missing-manifest.zip',
  'missing-database.zip',
  'corrupt-database.zip',
  'wrong-hash.zip',
  'future-schema.zip',
  'zip-slip.zip',
  'extra-path.zip',
  'renamed-random.zip',
];
for (const filename of cases) {
  const source = resolve(process.argv[2] ?? 'artifacts/phase6', filename);
  await assert.rejects(invoke('inspect_backup', { source }), undefined, filename);
  await assert.rejects(invoke('restore_backup', { source }), undefined, filename);
  assert.equal(
    (await select("SELECT title FROM tasks WHERE title='Estado B'"))[0]?.title,
    'Estado B',
  );
}

console.log(JSON.stringify({ rejected: cases, currentDataPreserved: true }, null, 2));
await browser.close();
