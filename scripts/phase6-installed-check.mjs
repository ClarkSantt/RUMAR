import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const mode = process.argv[2];
assert(['upgrade', 'prepare', 'reopened'].includes(mode));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const invoke = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
assert.equal(await invoke('plugin:app|identifier'), 'com.rumo.validation.phase6');
assert.equal(await invoke('plugin:app|version'), '1.0.0');
const info = await invoke('data_info');
assert.match(info.databasePath.replaceAll('\\', '/'), /com\.rumo\.validation\.phase6\/rumo\.db$/);
const select = (query) => invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values: [] });
assert.equal((await select('SELECT MAX(version) version FROM _sqlx_migrations'))[0].version, 9);
assert.equal((await select('PRAGMA integrity_check'))[0].integrity_check, 'ok');
if (mode === 'upgrade') {
  const before = JSON.parse(
    await readFile('artifacts/phase6/schema8-fixture/snapshot.json', 'utf8'),
  );
  for (const [table, rows] of Object.entries(before))
    assert.deepEqual(await select(`SELECT * FROM ${table} ORDER BY rowid`), rows, table);
  assert.equal(
    (await select("SELECT value FROM body_measurement_values WHERE metric_key='weight'"))[0].value,
    70,
  );
  console.log(
    JSON.stringify({
      upgrade: '8→9',
      tablesPreserved: Object.keys(before).length,
      weightMigrated: 70,
      integrity: 'ok',
    }),
  );
} else {
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  if (mode === 'prepare') {
    await nav.getByRole('button', { name: 'Pensamentos', exact: true }).click();
    await page.getByRole('button', { name: /Ideias sobre guitarra/ }).click();
    await page
      .getByRole('textbox', { name: 'Pensamento', exact: true })
      .fill('Thought final 1.0.0 — conteúdo preservado após fechamento nativo.');
    await nav.getByRole('button', { name: 'Alimentação', exact: true }).click();
    await page.getByRole('button', { name: 'Progresso', exact: true }).click();
    await page.locator('.nutrition-inline-form input[type=date]').fill('2026-09-27');
    await page.getByLabel('Peso (kg)', { exact: true }).fill('70,5');
    await page
      .locator('.nutrition-inline-form')
      .getByRole('button', { name: 'Registrar', exact: true })
      .click();
  }
  await nav.getByRole('button', { name: 'Alimentação', exact: true }).click();
  await page.getByRole('button', { name: 'Progresso', exact: true }).click();
  await page.getByText('70,5 kg').first().waitFor();
  await page.getByRole('button', { name: /Ver progresso corporal completo/ }).click();
  await page.getByText('70,5 kg').first().waitFor();
  assert.equal(
    (await select("SELECT content FROM thoughts WHERE id='release-thought'"))[0].content,
    'Thought final 1.0.0 — conteúdo preservado após fechamento nativo.',
  );
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Buscar no RUMO' }).fill('Mercado');
  await page.getByRole('listbox').getByText('Transação financeira').waitFor();
  assert.doesNotMatch(await page.getByRole('listbox').innerText(), /123,45|927,38|12345|92738/);
  await page.keyboard.press('Escape');
  const tables = (
    await select(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='_sqlx_migrations' ORDER BY name",
    )
  ).map((row) => row.name);
  const snapshot = {};
  for (const table of tables) {
    assert(/^[a-z_]+$/.test(table));
    snapshot[table] = await select(`SELECT * FROM ${table} ORDER BY rowid`);
  }
  if (mode === 'prepare') {
    const manifest = await invoke('create_backup', {
      destination: resolve('artifacts/phase6/final-smoke.zip'),
    });
    assert.equal(manifest.schemaVersion, 9);
    await writeFile(
      'artifacts/phase6/final-smoke-snapshot.json',
      JSON.stringify(snapshot, null, 2),
    );
  } else {
    assert.deepEqual(
      snapshot,
      JSON.parse(await readFile('artifacts/phase6/final-smoke-snapshot.json', 'utf8')),
    );
  }
  console.log(
    JSON.stringify({
      mode,
      version: '1.0.0',
      schema: 9,
      sharedWeight: 70.5,
      thought: true,
      privacy: true,
      tables: tables.length,
      integrity: 'ok',
    }),
  );
}
await browser.close();
