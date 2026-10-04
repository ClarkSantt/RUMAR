import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { externalRequestDiagnostic } from './safe-diagnostics.mjs';

// This test drives the release WebView2, never a browser substitute or an in-memory repository.
// Refuse to touch a database with any preexisting user records.
const output = resolve('artifacts/desktop');
await mkdir(output, { recursive: true });
let app, browser, page;
let ownsData = false;
let initialSettings;
const errors = [];
const requests = [];
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function launch() {
  app = spawn(resolve('src-tauri/target/release/rumo.exe'), [], {
    windowsHide: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223' },
    stdio: 'ignore',
  });
  app.on('error', () => errors.push('launch-error'));
  for (let i = 0; i < 120; i++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
      break;
    } catch {
      await sleep(250);
    }
  }
  assert(browser, 'Release WebView2 did not start');
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? (await context.waitForEvent('page'));
  page.on('pageerror', () => errors.push('page-error'));
  page.on('request', (request) => {
    const diagnostic = externalRequestDiagnostic(request.url());
    if (diagnostic) requests.push(diagnostic);
  });
  page.setDefaultTimeout(10000);
  await page.getByRole('heading', { name: /Boa noite|Boa tarde|Bom dia/ }).waitFor();
}
async function stop() {
  if (browser) {
    await browser.close();
    browser = undefined;
  }
  if (app && app.exitCode === null) {
    app.kill();
    await new Promise((resolve) => app.once('exit', resolve));
  }
  await sleep(1000);
}
async function sql(query, bindValues = [], execute = false) {
  return page.evaluate(
    ({ query, bindValues, execute }) =>
      window.__TAURI_INTERNALS__.invoke(`plugin:sql|${execute ? 'execute' : 'select'}`, {
        db: 'sqlite:rumo.db',
        query,
        values: bindValues,
      }),
    { query, bindValues, execute },
  );
}
async function idle() {
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '.quick-entry input:disabled, .quick-entry textarea:disabled, #task-form fieldset:disabled',
      ),
  );
}
async function click(name) {
  const target =
    name === 'Inbox'
      ? page.locator('aside').getByRole('button', { name: /^Inbox/ })
      : page.getByRole('button', { name, exact: true });
  await target.click();
  await idle();
}
async function capture(content) {
  await page.keyboard.press('Control+Space');
  await page.getByRole('dialog', { name: 'Capturar' }).waitFor();
  await page.getByPlaceholder('O que você quer guardar?').fill(content);
  await page.getByPlaceholder('O que você quer guardar?').press('Enter');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await idle();
}
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
try {
  await launch();
  assert.equal((await sql('SELECT id FROM tasks')).length, 0, 'Refusing to modify existing tasks');
  assert.equal(
    (await sql('SELECT id FROM inbox_items')).length,
    0,
    'Refusing to modify existing inbox',
  );
  initialSettings = await sql('SELECT * FROM settings');
  ownsData = true;
  await page.screenshot({ animations: 'disabled', path: resolve(output, '01-empty-light.png') });
  assert.equal((await sql('PRAGMA foreign_keys'))[0].foreign_keys, 1);
  results.push('Release launch, migration and empty SQLite verified');
  await page.getByPlaceholder('Adicionar tarefa para hoje…').fill('Organizar computador');
  await page.getByPlaceholder('Adicionar tarefa para hoje…').press('Enter');
  await idle();
  await page.getByRole('button', { name: 'Organizar computador', exact: true }).click();
  await page.getByLabel('Prioridade', { exact: true }).selectOption('high');
  await page.getByLabel('Descrição opcional').fill('Revisar arquivos locais.');
  await click('Salvar tarefa');
  await page.getByRole('button', { name: /Organizar computador/ }).click();
  const subtaskTitles = [
    'Limpar Downloads',
    'Organizar Documentos',
    'Limpar desktop',
    'Revisar programas instalados',
    'Revisar inicialização do Windows',
    'Organizar projetos',
    'Organizar imagens',
    'Organizar vídeos',
    'Organizar backups',
    'Revisar arquivos antigos',
    'Organizar favoritos',
    'Limpar arquivos temporários',
  ];
  for (const title of subtaskTitles) {
    await page.getByPlaceholder('Adicionar subtarefa…').fill(title);
    await page.getByPlaceholder('Adicionar subtarefa…').press('Enter');
    await idle();
  }
  await page
    .getByRole('checkbox', { name: 'Concluir subtarefa Limpar Downloads', exact: true })
    .click();
  await idle();
  await page
    .getByRole('checkbox', { name: 'Desmarcar subtarefa Limpar Downloads', exact: true })
    .waitFor();
  await page.screenshot({ animations: 'disabled', path: resolve(output, '02-task-drawer.png') });
  assert(
    await page
      .locator('dialog .dialog-header')
      .evaluate((el) => el.getBoundingClientRect().top >= 0),
    'Drawer header scrolled outside viewport',
  );
  await click('Fechar');
  await page.getByRole('button', { name: /Organizar computador/ }).click();
  assert.equal(await page.locator('.subtask-row').count(), subtaskTitles.length);
  assert(
    await page
      .getByRole('checkbox', { name: 'Desmarcar subtarefa Limpar Downloads', exact: true })
      .isChecked(),
  );
  for (const [width, height] of [
    [900, 620],
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    for (const position of ['top', 'bottom']) {
      await page.locator('.drawer-body').evaluate((element, position) => {
        element.scrollTop = position === 'top' ? 0 : element.scrollHeight;
      }, position);
      const geometry = await page.locator('dialog').evaluate((element) => {
        const header = element.querySelector('.dialog-header').getBoundingClientRect();
        const footer = element.querySelector('.drawer-footer').getBoundingClientRect();
        const body = element.querySelector('.drawer-body');
        const rect = body.getBoundingClientRect();
        return {
          headerVisible: header.top >= 0 && header.bottom <= innerHeight,
          footerVisible: footer.top >= 0 && footer.bottom <= innerHeight,
          separated: rect.top >= header.bottom - 1 && rect.bottom <= footer.top + 1,
          scrollable: body.scrollHeight > body.clientHeight,
          horizontal:
            body.scrollWidth > body.clientWidth ||
            document.documentElement.scrollWidth > innerWidth,
          outerScroll: element.scrollTop,
        };
      });
      assert(
        geometry.headerVisible && geometry.footerVisible && geometry.separated,
        JSON.stringify(geometry),
      );
      assert.equal(geometry.horizontal, false);
      assert.equal(geometry.outerScroll, 0);
      if (height <= 1080) assert(geometry.scrollable);
      await page.screenshot({
        animations: 'disabled',
        path: resolve(output, `drawer-${width}-${position}.png`),
      });
    }
  }
  results.push(
    'Drawer with 12 subtasks keeps header, close button and footer visible with only internal scrolling at 900, 1366, 1920 and 2560 pixels',
  );
  await click('Fechar');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('checkbox', { name: 'Concluir Organizar computador', exact: true }).check();
  await idle();
  await click('Tarefas');
  await click('Nova tarefa');
  await page.getByLabel('Título', { exact: true }).fill('Estudar');
  await page.getByLabel('Horário', { exact: true }).fill('19:00');
  await page.getByLabel('Repetir', { exact: true }).selectOption('weekdays');
  await click('Salvar tarefa');
  assert.equal(
    await page.getByRole('checkbox', { name: 'Concluir Estudar', exact: true }).count(),
    [1, 3, 5].includes(now.getDay()) ? 1 : 0,
  );
  await click('Nova tarefa');
  await page.getByLabel('Título', { exact: true }).fill('Skincare');
  await page.getByLabel('Horário', { exact: true }).fill('22:00');
  await page.getByLabel('Repetir', { exact: true }).selectOption('daily');
  await click('Salvar tarefa');
  await page.getByRole('checkbox', { name: 'Concluir Skincare', exact: true }).check();
  await idle();
  await capture('Comprar pasta térmica');
  await click('Inbox');
  await click('Transformar em tarefa');
  await capture('Pesquisar guitarra');
  await page.screenshot({ animations: 'disabled', path: resolve(output, '03-inbox.png') });
  await click('Configurações');
  await page.getByLabel('Como podemos chamar você?').fill('Gustavo QA');
  await click('Salvar');
  await click('Escuro');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ animations: 'disabled', path: resolve(output, '04-settings-dark.png') });
  await click('Início');
  for (const [width, height] of [
    [900, 620],
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Horizontal overflow',
    );
    await page.screenshot({
      animations: 'disabled',
      path: resolve(output, `05-home-dark-${width}.png`),
    });
  }
  const before = {
    tasks: await sql('SELECT * FROM tasks ORDER BY id'),
    subtasks: await sql('SELECT * FROM subtasks ORDER BY id'),
    completions: await sql('SELECT * FROM task_completions ORDER BY task_id'),
    inbox: await sql('SELECT * FROM inbox_items ORDER BY id'),
    settings: await sql('SELECT * FROM settings ORDER BY key'),
  };
  assert.equal(before.tasks.length, 4);
  assert.equal(before.subtasks.length, 12);
  assert.equal(before.completions.length, 1);
  assert(before.tasks.find((t) => t.title === 'Organizar computador').completed_at);
  assert.equal(before.tasks.find((t) => t.title === 'Skincare').status, 'pending');
  assert.equal(before.completions[0].occurrence_date, today);
  assert.equal(before.inbox.filter((i) => i.status === 'processed').length, 1);
  results.push(
    'Required task, subtask, recurring task, Inbox conversion and settings scenario passed',
  );
  await stop();
  await launch();
  const after = {
    tasks: await sql('SELECT * FROM tasks ORDER BY id'),
    subtasks: await sql('SELECT * FROM subtasks ORDER BY id'),
    completions: await sql('SELECT * FROM task_completions ORDER BY task_id'),
    inbox: await sql('SELECT * FROM inbox_items ORDER BY id'),
    settings: await sql('SELECT * FROM settings ORDER BY key'),
  };
  assert.deepEqual(after, before);
  await page.getByRole('heading', { name: /Gustavo QA/ }).waitFor();
  assert(
    await page
      .getByRole('checkbox', { name: 'Desfazer conclusão de Organizar computador', exact: true })
      .isChecked(),
  );
  assert(
    await page
      .getByRole('checkbox', { name: 'Desfazer conclusão de Skincare', exact: true })
      .isChecked(),
  );
  results.push('Complete process termination and relaunch preserved every SQLite record');
  await page
    .getByRole('checkbox', { name: 'Desfazer conclusão de Skincare', exact: true })
    .uncheck();
  await idle();
  assert.equal((await sql('SELECT * FROM task_completions')).length, 0);
  await page.keyboard.press('Control+Space');
  await page.getByRole('dialog').waitFor();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    assert(
      await page.evaluate(() => Boolean(document.activeElement?.closest('dialog'))),
      'Focus escaped modal',
    );
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Shift+Tab');
    assert(
      await page.evaluate(() => Boolean(document.activeElement?.closest('dialog'))),
      'Backward focus escaped modal',
    );
  }
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  results.push('Completion undo, Ctrl+Space, Tab focus containment and Escape passed');
  await click('Configurações');
  await click('Claro');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await click('Sistema');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  results.push('Light, dark and live system theme changes passed');
  await click('Início');
  await page.getByRole('checkbox', { name: 'Concluir Skincare', exact: true }).check();
  await idle();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  await page.clock.setFixedTime(tomorrow);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('checkbox', { name: 'Concluir Skincare', exact: true }).waitFor();
  assert.equal((await sql('SELECT * FROM task_completions')).length, 1);
  results.push('Next local day shows Skincare pending while preserving yesterday completion');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  results.push('No runtime JavaScript errors or external application requests observed');
} finally {
  if (ownsData && page && !page.isClosed()) {
    await sql('DELETE FROM tasks', [], true);
    await sql('DELETE FROM inbox_items', [], true);
    for (const setting of initialSettings)
      await sql(
        'UPDATE settings SET value=$2,updated_at=$3 WHERE key=$1',
        [setting.key, setting.value, setting.updated_at],
        true,
      );
    assert.equal((await sql('SELECT * FROM tasks')).length, 0);
    results.push('Test data removed; original settings restored; first-run database remains clean');
  }
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify({ results, errors, requests }, null, 2),
  );
  await stop();
  console.log(results.join('\n'));
}
