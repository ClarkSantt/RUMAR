import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
assert.equal(
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier')),
  'com.rumo.validation.phase6',
);
const nav = (name) =>
  page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name, exact: true });
const pages = [
  'Início',
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
const report = [];
await mkdir('artifacts/phase6', { recursive: true });
for (const theme of ['Claro', 'Escuro']) {
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: theme, exact: true }).click();
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of pages) {
      if (name === 'Configurações')
        await page.getByRole('button', { name: 'Configurações', exact: true }).click();
      else await nav(name).click();
      await page.waitForTimeout(80);
      const state = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        heading: document.querySelector('main h1')?.textContent?.trim() ?? '',
        theme: document.documentElement.dataset.theme,
      }));
      assert(
        state.scrollWidth <= state.width + 1,
        `${theme} ${width} ${name}: horizontal overflow ${state.scrollWidth}/${state.width}`,
      );
      assert(state.heading, `${theme} ${width} ${name}: missing heading`);
      report.push({ theme, width, height, page: name, ...state });
      if (['Início', 'Finanças', 'Alimentação', 'Configurações'].includes(name) && width !== 1920) {
        await page.screenshot({ path: `artifacts/phase6/${theme}-${width}-${name}.png` });
      }
    }
  }
}
await page.keyboard.press('Control+k');
await page.getByRole('textbox', { name: 'Buscar no RUMO' }).fill('guitarra');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Escape');
assert.equal(await page.getByRole('dialog', { name: 'Busca global' }).count(), 0);
await writeFile('artifacts/phase6/visual-report.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    combinations: report.length,
    themes: 2,
    resolutions: 3,
    pages: pages.length,
    horizontalOverflow: 0,
  }),
);
await browser.close();
