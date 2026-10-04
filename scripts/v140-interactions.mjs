import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(10000);
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
try {
  assert.equal(
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier')),
    'com.rumo.validation.v140',
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('aside').getByRole('button', { name: 'Calendário', exact: true }).click();
  await page.getByRole('button', { name: 'Semana', exact: true }).click();
  await page.locator('.planner-scroll').evaluate((e) => (e.scrollTop = 11 * 60 * 1.2));
  const original = (await sql('SELECT * FROM planner_time_blocks WHERE entity_type IS NULL'))[0];
  const source = page.locator('.planner-block').filter({ hasText: 'Almoço' });
  const s = await source.boundingBox();
  const target = await page.locator('.planner-column').nth(1).boundingBox();
  assert(s && target);
  await page.mouse.move(s.x + s.width / 2, s.y + 20);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 12, s.y + 20, { steps: 5 });
  await page.mouse.move(target.x + 60, target.y + 14 * 60 * 1.2, { steps: 15 });
  await page.mouse.up();
  await page.waitForFunction(async (id) => {
    const r = await window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {
      db: 'sqlite:rumo.db',
      query: 'SELECT block_date FROM planner_time_blocks WHERE id=$1',
      values: [id],
    });
    return r[0].block_date === '2026-09-29';
  }, original.id);
  const moved = (await sql(`SELECT * FROM planner_time_blocks WHERE id='${original.id}'`))[0];
  assert.equal(moved.start_time, '14:00');
  assert.equal(moved.end_time, '15:00');
  const handle = source.locator('.planner-resize');
  const h = await handle.boundingBox();
  assert(h);
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 30 * 1.2, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(async (id) => {
    const r = await window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {
      db: 'sqlite:rumo.db',
      query: 'SELECT end_time FROM planner_time_blocks WHERE id=$1',
      values: [id],
    });
    return r[0].end_time === '15:30';
  }, original.id);
  await page.getByRole('button', { name: 'Novo bloco', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Conflito de horário');
  await page.getByLabel('Data', { exact: true }).fill('2026-09-29');
  await page.getByLabel('Início', { exact: true }).fill('14:30');
  await page.getByLabel('Fim', { exact: true }).fill('15:00');
  await page.getByRole('button', { name: 'Salvar bloco', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: /conflito de horário/i }).count(), 2);
  await page.screenshot({
    path: 'artifacts/v140/drag-resize-conflict.png',
    animations: 'disabled',
  });
  await writeFile(
    'artifacts/v140/interactions.json',
    JSON.stringify(
      {
        moved,
        resized: await sql(`SELECT * FROM planner_time_blocks WHERE id='${original.id}'`),
        task: await sql('SELECT due_date,due_time FROM tasks'),
      },
      null,
      2,
    ),
  );
  console.log(
    'Native HTML drag across days, pointer resize and conflict layout passed in the isolated WebView.',
  );
} finally {
  await browser.close();
}
