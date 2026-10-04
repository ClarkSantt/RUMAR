import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(10000);
const results = [];
await page.emulateMedia({ reducedMotion: 'reduce' });
await mkdir('artifacts/v140/visual', { recursive: true });
try {
  assert.equal(
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier')),
    'com.rumo.validation.v140',
  );
  await page.locator('aside').getByRole('button', { name: 'Calendário', exact: true }).click();
  await page.getByRole('button', { name: 'Novo bloco', exact: true }).waitFor();
  // Keyboard alternative is available even without dragging.
  await page.locator('.planner-column').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Novo bloco', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Início', { exact: true }).inputValue(), '09:15');
  await page.keyboard.press('Escape');
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      for (const view of ['Dia', 'Semana útil', 'Semana', 'Mês']) {
        await page.getByRole('button', { name: view, exact: true }).click();
        if (view !== 'Mês')
          await page
            .locator('.planner-scroll')
            .evaluate((e) => (e.scrollTop = 12 * 60 * 1.2 - 100));
        await page.screenshot({
          path: `artifacts/v140/visual/${width}-${theme}-${view.replaceAll(' ', '-')}.png`,
          animations: 'disabled',
        });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        assert.equal(overflow, false, `${width}/${theme}/${view}`);
        results.push({ width, height, theme, view, overflow });
      }
      await page.getByRole('button', { name: 'Novo bloco', exact: true }).click();
      await page
        .getByLabel('Título', { exact: true })
        .fill(
          'Título longo de validação do planejador diário sem perda de leitura ou quebra horizontal',
        );
      await page.waitForTimeout(350);
      await page.screenshot({
        path: `artifacts/v140/visual/${width}-${theme}-modal.png`,
        animations: 'disabled',
      });
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => document.activeElement?.closest('dialog') !== null));
      await page.keyboard.press('Escape');
    }
  }
  await writeFile('artifacts/v140/visual/results.json', JSON.stringify(results, null, 2));
  console.log(
    `${results.length} view/theme/resolution combinations without document horizontal overflow; keyboard creation and modal focus passed.`,
  );
} finally {
  await browser.close();
}
