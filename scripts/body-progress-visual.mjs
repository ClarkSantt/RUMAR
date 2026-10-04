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
const nav = page.getByRole('navigation', { name: 'Navegação principal' });
const output = 'artifacts/body-progress';
await mkdir(output, { recursive: true });
const report = [];
const sections = [
  ['Início'],
  ['Inbox'],
  ['Tarefas'],
  ['Projetos'],
  ['Hábitos'],
  ['Rotinas'],
  ['Calendário'],
  ['Treinos', 'Hoje'],
  ['Treinos', 'Plano'],
  ['Treinos', 'Exercícios'],
  ['Treinos', 'Histórico'],
  ['Treinos', 'Progresso corporal'],
  ['Alimentação', 'Hoje'],
  ['Alimentação', 'Progresso'],
  ['Finanças'],
  ['Pensamentos'],
  ['Configurações'],
];
for (const theme of ['Claro', 'Escuro']) {
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: theme, exact: true }).click();
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [module, tab] of sections) {
      if (module === 'Configurações')
        await page.getByRole('button', { name: module, exact: true }).click();
      else await nav.getByRole('button', { name: module, exact: true }).click();
      if (tab) await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(90);
      const state = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        heading: document.querySelector('main h1')?.textContent?.trim() ?? '',
        theme: document.documentElement.dataset.theme,
      }));
      assert(
        state.scrollWidth <= state.width + 1,
        `${theme} ${width} ${module}/${tab ?? ''}: horizontal overflow ${state.scrollWidth}/${state.width}`,
      );
      assert(state.heading, `${theme} ${width} ${module}/${tab ?? ''}: missing heading`);
      report.push({ theme, width, height, module, tab: tab ?? null, ...state });
      if (
        [1366, 1920].includes(width) &&
        ((module === 'Treinos' && ['Hoje', 'Progresso corporal'].includes(tab)) ||
          (module === 'Alimentação' && tab === 'Progresso') ||
          ['Projetos', 'Hábitos', 'Rotinas', 'Pensamentos'].includes(module))
      ) {
        await page.screenshot({
          path: `${output}/${theme}-${width}-${module}-${tab ?? 'main'}.png`,
        });
      }
    }
  }
}
await nav.getByRole('button', { name: 'Treinos', exact: true }).click();
await page.getByRole('button', { name: 'Progresso corporal', exact: true }).click();
await page.keyboard.press('Tab');
const focus = await page.evaluate(() => ({
  tag: document.activeElement?.tagName,
  visible:
    document.activeElement && getComputedStyle(document.activeElement).outlineStyle !== 'none',
}));
assert(['BUTTON', 'SELECT', 'INPUT'].includes(focus.tag));
await page.setViewportSize({ width: 1366, height: 768 });
await page.getByRole('button', { name: 'Nova medição' }).click();
assert.equal(await page.locator('.body-input-grid input').count(), 16);
const editorOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
assert(editorOverflow <= 1, `Measurement editor overflows horizontally: ${editorOverflow}`);
await page.screenshot({ path: `${output}/Escuro-1366-editor.png` });
await page.getByRole('button', { name: 'Fechar' }).click();
await writeFile(`${output}/visual-report.json`, JSON.stringify({ report, focus }, null, 2));
console.log(
  JSON.stringify({
    combinations: report.length,
    themes: 2,
    resolutions: 3,
    sections: sections.length,
    horizontalOverflow: 0,
    editorInputs: 16,
    editorOverflow,
    keyboardFocus: focus,
  }),
);
await browser.close();
