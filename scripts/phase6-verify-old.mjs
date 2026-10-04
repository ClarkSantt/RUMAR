import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const preventive = process.argv[2];
assert(preventive?.includes('com.rumo.validation.phase6\\backups\\RUMO-pre-restore-'));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
const invoke = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
const select = (query) => invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values: [] });
assert.equal(await invoke('plugin:app|identifier'), 'com.rumo.validation.phase6');
assert.equal((await select('SELECT MAX(version) version FROM _sqlx_migrations'))[0].version, 9);
assert.equal(
  (await select("SELECT title FROM tasks WHERE id='old-task'"))[0]?.title,
  'Tarefa da Fase 4',
);
assert.equal(
  (await select("SELECT name FROM projects WHERE id='old-project'"))[0]?.name,
  'Projeto da Fase 4',
);
assert.equal(
  (await select("SELECT content FROM thoughts WHERE id='old-thought'"))[0]?.content,
  'Conteúdo preservado',
);
assert.equal(
  (await select("SELECT name FROM workout_plans WHERE id='old-plan'"))[0]?.name,
  'Plano antigo',
);
assert.equal(
  (await select("SELECT name FROM meals WHERE id='old-meal'"))[0]?.name,
  'Refeição antiga',
);
assert.equal(
  (await select("SELECT value FROM settings WHERE key='name'"))[0]?.value,
  'Backup da Fase 4',
);
assert.equal((await select('PRAGMA integrity_check'))[0].integrity_check, 'ok');
assert.equal((await invoke('inspect_backup', { source: preventive })).kind, 'pre_restore');
await invoke('plugin:sql|close', { db: 'sqlite:rumo.db' });
await invoke('restore_backup', { source: preventive });
await page.reload();
await page.waitForTimeout(500);
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
  JSON.stringify({
    previousSchema: 5,
    migratedSchema: 9,
    preventiveRestored: true,
    integrity: 'ok',
  }),
);
await browser.close();
