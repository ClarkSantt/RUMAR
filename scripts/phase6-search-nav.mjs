import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
assert.equal(
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier')),
  'com.rumo.validation.phase6',
);
async function search(term) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  const input = page.getByRole('textbox', { name: 'Buscar no RUMO' });
  await input.fill(term);
  return page.getByRole('listbox', { name: 'Resultados da busca' });
}
let list = await search('guitarra');
await list.getByRole('option', { name: 'Aprender guitarra' }).click();
await page.getByRole('heading', { name: 'Aprender guitarra' }).waitFor();
list = await search('Ideias sobre guitarra');
await list.getByRole('option', { name: /Ideias sobre guitarra/ }).click();
const thoughtContent = page.getByRole('textbox', { name: 'Pensamento', exact: true });
await thoughtContent.waitFor();
assert.equal(await thoughtContent.inputValue(), 'Texto sintético de validação');
list = await search('Supino de teste');
await list.getByRole('option', { name: /Supino de teste/ }).click();
await page
  .getByRole('button', { name: 'Exercícios', exact: true })
  .and(page.locator('[aria-current="page"]'))
  .waitFor();
assert.equal(
  await page.locator('.workout-evolution select').first().inputValue(),
  'release-exercise',
);
list = await search('Guitarra nova');
await list.getByRole('option', { name: /Objetivo financeiro/ }).click();
await page.getByRole('heading', { name: 'Objetivos', exact: true }).waitFor();
list = await search('Arroz');
await list.getByRole('option').first().click();
await page.getByRole('heading', { name: 'Alimentos' }).waitFor();
assert.equal(await page.getByRole('dialog', { name: 'Busca global' }).count(), 0);
console.log(
  JSON.stringify({ project: true, thought: true, exercise: true, goal: true, food: true }),
);
await browser.close();
