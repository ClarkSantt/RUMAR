import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Attach to an already running tauri dev WebView2. No security policy changes.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
const output = 'artifacts/visual-dev';
await mkdir(output, { recursive: true });
const sql = (query, values = [], execute = false) =>
  page.evaluate(
    ({ query, values, execute }) =>
      window.__TAURI_INTERNALS__.invoke(`plugin:sql|${execute ? 'execute' : 'select'}`, {
        db: 'sqlite:rumo.db',
        query,
        values,
      }),
    { query, values, execute },
  );
const idle = () =>
  page.waitForFunction(
    () => !document.querySelector('.quick-entry input:disabled, #task-form fieldset:disabled'),
  );
const click = async (name) => {
  await page
    .getByRole('button', {
      name: name === 'Inspeção visual do drawer' ? /^Inspeção visual do drawer/ : name,
      exact: name !== 'Inspeção visual do drawer',
    })
    .click();
  await idle();
};
let owned = false;
let settings;
const results = [];
try {
  await page.reload();
  await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor();
  const isolated = process.argv.includes('--phase2-profile');
  if (isolated) {
    assert.equal(
      await page.evaluate(async () => {
        const { getIdentifier } = await import('/node_modules/@tauri-apps/api/app.js');
        return getIdentifier();
      }),
      'com.rumo.validation.phase2',
    );
    assert.equal(
      (await sql('SELECT id FROM tasks WHERE title=$1', ['Inspeção visual do drawer'])).length,
      0,
    );
  } else
    assert.equal((await sql('SELECT id FROM tasks')).length, 0, 'Refusing preexisting task data');
  settings = await sql('SELECT * FROM settings');
  owned = true;
  await page.getByPlaceholder('Adicionar tarefa para hoje…').fill('Inspeção visual do drawer');
  await page.getByPlaceholder('Adicionar tarefa para hoje…').press('Enter');
  await idle();
  await click('Inspeção visual do drawer');
  for (let i = 1; i <= 16; i++) {
    await page
      .getByPlaceholder('Adicionar subtarefa…')
      .fill(`Subtarefa ${i}: organizar documentos e conferir arquivos importantes`);
    await page.getByPlaceholder('Adicionar subtarefa…').press('Enter');
    await idle();
  }
  await click('Fechar');
  for (const theme of ['Claro', 'Escuro']) {
    await click('Configurações');
    await click(theme);
    await page.waitForFunction(
      (t) => document.documentElement.dataset.theme === t,
      theme === 'Claro' ? 'light' : 'dark',
    );
    await click('Início');
    await click('Inspeção visual do drawer');
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({
        animations: 'disabled',
        path: `${output}/${theme}-${width}-layout.png`,
      });
      for (const position of ['top', 'bottom']) {
        await page.locator('.drawer-body').evaluate((el, p) => {
          el.scrollTop = p === 'top' ? 0 : el.scrollHeight;
        }, position);
        const geometry = await page.locator('dialog').evaluate((el) => {
          const h = el.querySelector('header').getBoundingClientRect(),
            f = el.querySelector('footer').getBoundingClientRect(),
            b = el.querySelector('.drawer-body'),
            r = b.getBoundingClientRect();
          return {
            header: h.top >= 0,
            footerBottom: f.bottom,
            viewportHeight: innerHeight,
            footer: f.bottom <= innerHeight,
            separated: r.top >= h.bottom - 1 && r.bottom <= f.top + 1,
            scrollable: b.scrollHeight > b.clientHeight,
            overflow:
              b.scrollWidth > b.clientWidth || document.documentElement.scrollWidth > innerWidth,
            outer: el.scrollTop,
            inner: b.scrollTop,
          };
        });
        assert(
          geometry.header && geometry.footer && geometry.separated && geometry.scrollable,
          JSON.stringify(geometry),
        );
        assert.equal(geometry.overflow, false);
        assert.equal(geometry.outer, 0);
        if (position === 'bottom') assert(geometry.inner > 0);
        await page.screenshot({
          animations: 'disabled',
          path: `${output}/${theme}-${width}-${position}.png`,
        });
        results.push({ theme, width, height, position, geometry });
      }
      await page.getByRole('button', { name: 'Fechar', exact: true }).focus();
      for (const key of ['Shift+Tab', ...Array(32).fill('Tab')]) {
        await page.keyboard.press(key);
        assert(await page.evaluate(() => !!document.activeElement?.closest('dialog')));
      }
    }
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page.keyboard.press('Control+Space');
  await page.getByRole('dialog', { name: 'Capturar' }).waitFor();
  for (const key of [...Array(8).fill('Tab'), ...Array(5).fill('Shift+Tab')]) {
    await page.keyboard.press(key);
    assert(await page.evaluate(() => !!document.activeElement?.closest('dialog')));
  }
  await page.screenshot({ animations: 'disabled', path: `${output}/capture-keyboard.png` });
  await page.keyboard.press('Escape');
  console.log(
    'PASS: 16 subtasks, internal scrolling, pinned header/footer, no horizontal overflow, both themes, both sizes, Tab/Shift+Tab/Escape/Ctrl+Space.',
  );
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ mode: 'tauri dev', passed: true, results }, null, 2),
  );
} finally {
  if (owned) {
    await sql('DELETE FROM tasks WHERE title=$1', ['Inspeção visual do drawer'], true);
    for (const setting of settings)
      await sql(
        'UPDATE settings SET value=$2,updated_at=$3 WHERE key=$1',
        [setting.key, setting.value, setting.updated_at],
        true,
      );
  }
  await browser.close();
}
