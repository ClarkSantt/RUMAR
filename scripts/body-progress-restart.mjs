import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const invoke = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
assert.equal(await invoke('plugin:app|identifier'), 'com.rumo.validation.phase6');
const select = (query) => invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values: [] });
assert.equal((await select('PRAGMA integrity_check'))[0].integrity_check, 'ok');
assert.equal((await select('SELECT COUNT(*) AS count FROM body_measurement_records'))[0].count, 2);
assert.deepEqual(
  await select(`SELECT metric_key,value FROM body_measurement_values
    WHERE record_date='2026-09-27' AND metric_key IN ('weight','waist') ORDER BY metric_key`),
  [
    { metric_key: 'waist', value: 91 },
    { metric_key: 'weight', value: 90.8 },
  ],
);
const nav = page.getByRole('navigation', { name: 'Navegação principal' });
await nav.getByRole('button', { name: 'Treinos' }).click();
await page.getByRole('button', { name: 'Progresso corporal' }).click();
await page.getByText('90,8 kg').first().waitFor();
await nav.getByRole('button', { name: 'Alimentação' }).click();
await page.getByRole('button', { name: 'Progresso', exact: true }).click();
await page.getByText('90,8 kg').first().waitFor();
console.log(JSON.stringify({ restarted: true, records: 2, sharedWeight: 90.8, integrity: 'ok' }));
await browser.close();
