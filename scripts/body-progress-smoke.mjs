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
const info = await invoke('data_info');
assert.match(info.databasePath.replaceAll('\\', '/'), /com\.rumo\.validation\.phase6\/rumo\.db$/);
const select = (query) => invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values: [] });
assert.equal((await select('SELECT MAX(version) AS version FROM _sqlx_migrations'))[0].version, 9);
const welcome = page.getByRole('heading', {
  name: 'Seu espaço pessoal para organizar o que importa.',
});
if (await welcome.isVisible()) {
  await page.getByRole('textbox', { name: 'Como gostaria de ser chamado?' }).fill('Teste corporal');
  await page.getByRole('button', { name: 'Começar' }).click();
  await welcome.waitFor({ state: 'detached' });
}
const nav = page.getByRole('navigation', { name: 'Navegação principal' });
await nav.getByRole('button', { name: 'Treinos' }).click();
await page.getByRole('button', { name: 'Progresso corporal' }).click();
await page.getByRole('button', { name: 'Nova medição' }).click();
let form = page.locator('.body-editor form');
await form.locator('input[type=date]').fill('2026-09-01');
for (const [name, value] of [
  ['Peso (kg)', '93,0'],
  ['Braço esquerdo (cm)', '35,2'],
  ['Braço direito (cm)', '35,5'],
  ['Cintura (cm)', '94,0'],
])
  await form.getByLabel(name, { exact: true }).fill(value);
await form.getByRole('button', { name: 'Salvar medição' }).click();
await page.getByRole('button', { name: 'Nova medição' }).click();
form = page.locator('.body-editor form');
await form.locator('input[type=date]').fill('2026-09-27');
for (const [name, value] of [
  ['Peso (kg)', '91,4'],
  ['Percentual de gordura (%)', '14,8'],
  ['Braço esquerdo (cm)', '35,6'],
  ['Braço direito (cm)', '35,9'],
  ['Cintura (cm)', '91'],
])
  await form.getByLabel(name, { exact: true }).fill(value);
await form.getByRole('button', { name: 'Salvar medição' }).click();
await page.getByText('−1,6 kg').waitFor();
await page.getByText('+0,4 cm').first().waitFor();
assert.equal((await select('SELECT COUNT(*) AS count FROM body_measurement_records'))[0].count, 2);
await nav.getByRole('button', { name: 'Alimentação' }).click();
await page.getByRole('button', { name: 'Progresso', exact: true }).click();
await page.getByText('91,4 kg').first().waitFor();
await page.locator('.nutrition-inline-form input[type=date]').fill('2026-09-27');
await page.getByLabel('Peso (kg)').fill('90,8');
await page.locator('.nutrition-inline-form').getByRole('button', { name: 'Registrar' }).click();
await page.getByText('90,8 kg').first().waitFor();
await page.getByRole('button', { name: /Ver progresso corporal completo/ }).click();
await page
  .getByRole('button', { name: 'Progresso corporal' })
  .and(page.locator('[aria-current="page"]'))
  .waitFor();
await page.getByText('90,8 kg').first().waitFor();
assert.equal(
  (
    await select(
      "SELECT value FROM body_measurement_values WHERE record_date='2026-09-27' AND metric_key='weight'",
    )
  )[0].value,
  90.8,
);
assert.equal(
  (
    await select(
      "SELECT value FROM body_measurement_values WHERE record_date='2026-09-27' AND metric_key='waist'",
    )
  )[0].value,
  91,
);
assert.equal((await select('SELECT COUNT(*) AS count FROM body_weight_entries'))[0].count, 0);
console.log(
  JSON.stringify({ schema: 9, dates: 2, sharedWeight: 90.8, waistPreserved: 91, comparison: true }),
);
await browser.close();
