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
assert.equal(
  (
    await invoke('plugin:sql|select', {
      db: 'sqlite:rumo.db',
      query: 'SELECT COUNT(*) AS count FROM tasks',
      values: [],
    })
  )[0].count,
  0,
);
await page
  .getByRole('heading', { name: 'Seu espaço pessoal para organizar o que importa.' })
  .waitFor();
await page
  .getByRole('textbox', { name: 'Como gostaria de ser chamado?' })
  .fill('Teste de primeira abertura');
await page.getByRole('button', { name: 'Começar' }).click();
await page
  .getByRole('heading', { name: 'Seu espaço pessoal para organizar o que importa.' })
  .waitFor({ state: 'detached' });
const nav = page.getByRole('navigation', { name: 'Navegação principal' });
const pages = [
  'Inbox',
  'Tarefas',
  'Projetos',
  'Hábitos',
  'Rotinas',
  'Calendário',
  'Treinos',
  'Alimentação',
  'Finanças',
  'Pensamentos',
  'Configurações',
];
for (const name of pages) {
  if (name === 'Configurações') await page.getByRole('button', { name, exact: true }).click();
  else await nav.getByRole('button', { name, exact: true }).click();
  await page.locator('main h1').first().waitFor();
  assert.equal(await page.locator('main [role="alert"]').count(), 0, name);
}
await nav.getByRole('button', { name: 'Início', exact: true }).click();
const quick = page.locator('.quick-entry input').first();
await quick.fill('Teste teclado da busca');
await quick.press('Enter');
await page.keyboard.press('Control+k');
const input = page.getByRole('textbox', { name: 'Buscar no RUMO' });
await input.fill('Teste teclado');
await page.getByRole('option', { name: /Teste teclado da busca/ }).waitFor();
await input.press('Enter');
await page.getByRole('dialog', { name: 'Busca global' }).waitFor({ state: 'detached' });
assert.equal(
  await nav.getByRole('button', { name: 'Tarefas' }).getAttribute('aria-current'),
  'page',
);
console.log(
  JSON.stringify({ firstRun: true, emptyPages: pages.length, keyboardSearchEnter: true }),
);
await browser.close();
