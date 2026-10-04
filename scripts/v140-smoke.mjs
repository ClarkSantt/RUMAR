import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Run only against the explicitly isolated com.rumo.validation.v140 dev profile.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const command = process.argv[2] ?? 'inspect';
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
await mkdir('artifacts/v140', { recursive: true });
try {
  assert.equal(
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier')),
    'com.rumo.validation.v140',
  );
  if (command === 'setup') {
    if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
    if (await page.getByRole('button', { name: 'Começar', exact: true }).count()) {
      await page.getByLabel('Como gostaria de ser chamado?').fill('Validação 1.4');
      await page.getByRole('button', { name: 'Começar', exact: true }).click();
    }
    const before = await sql('SELECT count(*) n FROM planner_time_blocks');
    assert.equal(before[0].n, 0, 'Setup requires an empty isolated planner');
    for (const text of ['Estudar amanhã 09:00 por 1h', '/bloco Almoço 12:30 1h']) {
      await page.keyboard.press('Control+Space');
      await page.getByLabel('O que você quer registrar?').fill(text);
      console.log(await page.locator('dialog').innerText());
      await page.locator('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
      await page.locator('dialog').waitFor({ state: 'detached' });
    }
    const blocks = await sql('SELECT * FROM planner_time_blocks ORDER BY block_date,start_time');
    assert.equal(blocks.length, 2);
    assert.equal((await sql('SELECT due_date,due_time FROM tasks'))[0].due_date, null);
    await writeFile('artifacts/v140/setup.json', JSON.stringify(blocks, null, 2));
  }
  if (!(await page.locator('dialog[open]').count())) {
    await page.locator('aside').getByRole('button', { name: 'Calendário', exact: true }).click();
    await page.getByRole('button', { name: 'Novo bloco', exact: true }).waitFor();
  }
  if (command === 'focus-close') {
    if (await page.getByRole('button', { name: 'Retomar', exact: true }).count())
      await page.getByRole('button', { name: 'Retomar', exact: true }).click();
    else {
      await page.locator('.planner-scroll').evaluate((e) => (e.scrollTop = 12 * 60 * 1.2 - 100));
      await page.locator('.planner-block').filter({ hasText: 'Almoço' }).click();
      await page.getByRole('button', { name: 'Iniciar foco', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
    await page.waitForTimeout(6100);
    await page.getByRole('button', { name: 'Pausar', exact: true }).click();
    await page.getByRole('button', { name: 'Retomar', exact: true }).waitFor();
    const paused = await sql("SELECT * FROM focus_sessions WHERE status='paused'");
    assert.equal(paused.length, 1);
    assert(paused[0].focused_seconds >= 5);
    await page.getByRole('button', { name: 'Retomar', exact: true }).click();
    await page.waitForTimeout(5100);
    await writeFile(
      'artifacts/v140/before-close.json',
      JSON.stringify(
        {
          blocks: await sql('SELECT * FROM planner_time_blocks ORDER BY id'),
          focus: await sql('SELECT * FROM focus_sessions'),
        },
        null,
        2,
      ),
    );
    console.log('Snapshot saved. Close the isolated validation window normally before resume.');
  }
  if (command === 'resume') {
    const sessions = await sql("SELECT * FROM focus_sessions WHERE status='paused'");
    assert.equal(sessions.length, 1);
    assert(sessions[0].focused_seconds >= 10);
    console.log('Recovered paused checkpoint:', sessions[0].focused_seconds, 'seconds');
    if (!(await page.locator('dialog[open]').count()))
      await page.getByRole('button', { name: /Foco pausado/ }).click();
    await page.getByRole('button', { name: 'Retomar', exact: true }).click();
    await page.waitForTimeout(5100);
    await page.getByRole('button', { name: 'Finalizar foco', exact: true }).click();
    await page.locator('dialog').waitFor({ state: 'detached' });
    assert.equal(
      (await sql("SELECT count(*) n FROM focus_sessions WHERE status='completed'"))[0].n,
      1,
    );
    await writeFile(
      'artifacts/v140/after-resume.json',
      JSON.stringify(
        {
          blocks: await sql('SELECT * FROM planner_time_blocks ORDER BY id'),
          focus: await sql('SELECT * FROM focus_sessions'),
        },
        null,
        2,
      ),
    );
  }
  if (command !== 'focus-close') {
    await page.screenshot({ path: `artifacts/v140/${command}.png` });
    console.log(await page.locator('main').innerText());
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
