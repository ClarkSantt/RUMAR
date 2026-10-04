import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9227');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(20000);
const identifier = await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'),
);
assert.equal(identifier, 'com.rumo.validation.v110');
const nav = page.getByRole('navigation', { name: 'Navegação principal' });
const output = 'artifacts/v110/visual';
await mkdir(output, { recursive: true });
const report = [];
for (const theme of ['Claro', 'Escuro']) {
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: theme, exact: true }).click();
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [section, tab] of [
      ['Treinos', 'Plano'],
      ['Treinos', 'Progresso corporal'],
      ['Treinos', 'Exercícios'],
      ['Alimentação', 'Hoje'],
      ['Configurações', null],
      ['Calendário', null],
      ['Início', null],
    ]) {
      await (section === 'Configurações' ? page : nav)
        .getByRole('button', { name: section, exact: true })
        .click();
      if (tab) await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        heading: document.querySelector('main h1')?.textContent?.trim() ?? '',
        theme: document.documentElement.dataset.theme,
        alertCount: document.querySelectorAll('[role=alert]').length,
      }));
      assert(state.heading, `${section}/${tab} missing heading`);
      assert(
        state.scrollWidth <= state.width + 1,
        `${theme} ${width} ${section}/${tab}: overflow ${state.scrollWidth}/${state.width}`,
      );
      assert.equal(state.alertCount, 0, `${theme} ${width} ${section}/${tab}: UI alert`);
      const name = `${theme}-${width}-${section}${tab ? '-' + tab : ''}`
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replaceAll(' ', '-')
        .toLowerCase();
      await page.screenshot({ path: `${output}/${name}.png` });
      report.push({ theme, width, height, section, tab, ...state });
    }
  }
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checked: report.length, overflow: 0, alerts: 0 }));
await browser.close();
