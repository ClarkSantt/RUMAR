import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'artifacts/phase3';
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
assert.equal(
  await page.evaluate(async () => {
    const { getIdentifier } = await import('/node_modules/@tauri-apps/api/app.js');
    return getIdentifier();
  }),
  'com.rumo.validation.phase3',
);
const nav = (name) =>
  page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name, exact: true })
    .click();
const tab = (name) =>
  page
    .getByRole('navigation', { name: 'Seções de treinos' })
    .getByRole('button', { name, exact: true })
    .click();
const click = (name) => page.getByRole('button', { name, exact: true }).click();
const sql = (query) =>
  page.evaluate(
    (query) =>
      window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {
        db: 'sqlite:rumo.db',
        query,
        values: [],
      }),
    query,
  );
async function editUpper(weekday) {
  await nav('Treinos');
  await tab('Plano');
  await page
    .getByRole('navigation', { name: 'Dias do plano' })
    .getByRole('button', { name: 'Upper', exact: true })
    .click();
  await click('Editar dia Upper');
  await page
    .getByRole('combobox', { name: 'Dia da semana', exact: true })
    .selectOption(String(weekday));
  await click('Salvar dia');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(
    (await sql("SELECT weekday FROM workout_days WHERE name='Upper'"))[0].weekday,
    weekday,
  );
}
await editUpper(5);
await nav('Calendário');
const dates = page.locator('.calendar-cell');
assert.match(
  await dates
    .filter({ hasText: /^25Upper/ })
    .first()
    .innerText(),
  /Upper/,
);
assert.doesNotMatch(await dates.filter({ hasText: /^26/ }).first().innerText(), /Upper/);
assert.match(await dates.filter({ hasText: /^27/ }).first().innerText(), /Upper/);
await editUpper(6);
await nav('Calendário');
assert.doesNotMatch(await dates.filter({ hasText: /^25/ }).first().innerText(), /Upper/);
assert.match(
  await dates
    .filter({ hasText: /^26Upper/ })
    .first()
    .innerText(),
  /Upper/,
);
assert.match(await dates.filter({ hasText: /^27/ }).first().innerText(), /Upper/);

const results = [];
for (const [theme, label] of [
  ['light', 'Claro'],
  ['dark', 'Escuro'],
]) {
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByRole('group', { name: 'Tema' }).getByRole('button', { name: label }).click();
  await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [name, open] of [
      ['home', async () => nav('Início')],
      [
        'today',
        async () => {
          await nav('Treinos');
          await tab('Hoje');
        },
      ],
      [
        'plan',
        async () => {
          await nav('Treinos');
          await tab('Plano');
          await page
            .getByRole('navigation', { name: 'Dias do plano' })
            .getByRole('button', { name: 'Upper', exact: true })
            .click();
        },
      ],
      [
        'exercises',
        async () => {
          await nav('Treinos');
          await tab('Exercícios');
        },
      ],
      [
        'history',
        async () => {
          await nav('Treinos');
          await tab('Histórico');
        },
      ],
      [
        'evolution',
        async () => {
          await nav('Treinos');
          await tab('Evolução');
          await page
            .getByRole('combobox', { name: 'Exercício', exact: true })
            .selectOption('builtin-bench');
        },
      ],
      ['calendar', async () => nav('Calendário')],
    ]) {
      await open();
      await page.waitForTimeout(120);
      const measure = await page.evaluate(() => ({
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        focused: document.activeElement?.tagName,
      }));
      assert.ok(
        measure.scrollWidth <= measure.width + 1,
        `${name} ${theme} ${width}: horizontal overflow ${JSON.stringify(measure)}`,
      );
      const file = `${output}/${theme}-${width}-${name}.png`;
      await page.screenshot({ path: file, animations: 'disabled' });
      results.push({ name, theme, resolution: `${width}x${height}`, ...measure, file });
    }
    await nav('Treinos');
    await tab('Histórico');
    await page.locator('.workout-history-row').first().click();
    await page.screenshot({
      path: `${output}/${theme}-${width}-session.png`,
      animations: 'disabled',
    });
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({
      name: document.activeElement?.getAttribute('aria-label'),
      tag: document.activeElement?.tagName,
    }));
    assert.equal(focus.tag, 'BUTTON');
    results.push({ name: 'session', theme, resolution: `${width}x${height}`, focus });
    await click('← Voltar aos treinos');
  }
}
await writeFile(`${output}/visual-report.json`, JSON.stringify(results, null, 2));
console.log('CALENDAR_REFRESH_AND_VISUAL_OK', results.length);
await browser.close();
