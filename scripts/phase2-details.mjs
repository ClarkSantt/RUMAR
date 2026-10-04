import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const output = 'artifacts/phase2';
const sql = (query, values = []) =>
  page.evaluate(
    ({ query, values }) =>
      window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {
        db: 'sqlite:rumo.db',
        query,
        values,
      }),
    { query, values },
  );
assert.equal(
  await page.evaluate(async () => {
    const { getIdentifier } = await import('/node_modules/@tauri-apps/api/app.js');
    return getIdentifier();
  }),
  'com.rumo.validation.phase2',
);
const click = async (name) => page.getByRole('button', { name, exact: true }).click();
const nav = async (name) =>
  page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: name === 'Inbox' ? /^Inbox/ : name, exact: name !== 'Inbox' })
    .click();
const wait = async (query, predicate) => {
  for (let i = 0; i < 100; i++) {
    const rows = await sql(query);
    if (predicate(rows)) return rows;
    await page.waitForTimeout(80);
  }
  throw Error(query);
};
const tables = [
  'projects',
  'project_sections',
  'tasks',
  'subtasks',
  'task_completions',
  'subtask_completions',
  'habits',
  'habit_entries',
  'routines',
  'routine_items',
  'routine_occurrences',
  'routine_item_completions',
  'thoughts',
  'inbox_items',
  'settings',
];
const snapshot = async () =>
  Object.fromEntries(
    await Promise.all(tables.map(async (t) => [t, await sql(`SELECT * FROM ${t} ORDER BY 1`)])),
  );
const project = async (name) => {
  await nav('Projetos');
  await page.locator('.project-row').filter({ hasText: name }).click();
};

const mode = process.argv[2] ?? 'details';
if (mode === 'reopened') {
  const expected = JSON.parse(await readFile(`${output}/before-native-close.json`, 'utf8'));
  assert.deepEqual(await snapshot(), expected);
  await writeFile(
    `${output}/restart-report.json`,
    JSON.stringify(
      {
        allTablesIdentical: true,
        nativeWindowClose: true,
        thoughtFinal: expected.thoughts[0].content.length,
      },
      null,
      2,
    ),
  );
  console.log('ALL_TABLES_IDENTICAL_AFTER_NATIVE_RESTART');
  await browser.close();
  process.exit(0);
}
if (mode === 'details') {
  await project('Aprender guitarra');
  for (const [section, titles] of [
    ['Fundamentos', ['Aprender afinação', 'Acordes básicos', 'Power chords', 'Palm mute']],
    ['Músicas', []],
  ]) {
    const add = page.getByPlaceholder('Adicionar seção…');
    await add.fill(section);
    await add.press('Enter');
    const input = page.getByPlaceholder(`Adicionar tarefa em ${section}…`);
    await input.waitFor();
    for (const title of titles) {
      await input.fill(title);
      await input.press('Enter');
      await wait('SELECT title FROM tasks', (rows) => rows.some((r) => r.title === title));
    }
  }
  await page.getByRole('button', { name: 'Praticar guitarra', exact: true }).waitFor();
  await nav('Hábitos');
  await click('Praticar guitarra');
  await page.getByLabel('Data do registro', { exact: true }).fill('2026-09-25');
  await page.getByLabel('Valor', { exact: true }).fill('30');
  await click('Salvar registro');
  await wait('SELECT * FROM habit_entries', (r) =>
    r.some((e) => e.entry_date === '2026-09-25' && e.value === 30),
  );
  await click('Fechar');
  await project('Reset da Vida');
  await page.getByRole('button', { name: /Organizar gavetas/ }).click();
  await page.getByLabel('Data', { exact: true }).fill('2026-09-28');
  await page.getByLabel('Horário', { exact: true }).fill('19:00');
  await click('Salvar tarefa');
  await nav('Calendário');
  await page.getByRole('button', { name: /segunda-feira, 28 de setembro:/ }).click();
  await page.getByRole('button', { name: '19:00 Organizar gavetas', exact: true }).click();
  await page.getByLabel('Data', { exact: true }).fill('2026-09-30');
  await click('Salvar tarefa');
  await page.getByRole('button', { name: /segunda-feira, 28 de setembro:/ }).click();
  assert.equal(
    await page.locator('dialog').getByText('19:00 Organizar gavetas', { exact: true }).count(),
    0,
  );
  await click('Fechar');
  await page.getByRole('button', { name: /quarta-feira, 30 de setembro:/ }).click();
  await page.getByRole('button', { name: '19:00 Organizar gavetas', exact: true }).waitFor();
  await click('Fechar');
  await project('Reset da Vida');
  await click('Editar projeto');
  await page.getByLabel('Prazo', { exact: true }).fill('2026-09-30');
  await click('Salvar projeto');
  await nav('Calendário');
  await page.getByRole('button', { name: /quarta-feira, 30 de setembro:/ }).click();
  await page.getByRole('button', { name: 'Reset da Vida', exact: true }).waitFor();
  await click('Fechar');
  await project('Reset da Vida');
  await click('Editar projeto');
  await page.getByLabel('Prazo', { exact: true }).fill('2026-10-05');
  await click('Salvar projeto');
  await nav('Calendário');
  await page.getByRole('button', { name: /quarta-feira, 30 de setembro:/ }).click();
  assert.equal(await page.locator('dialog').getByText('Reset da Vida', { exact: true }).count(), 0);
  await click('Fechar');
  await page.getByRole('button', { name: /segunda-feira, 5 de outubro:/ }).click();
  await page.getByRole('button', { name: 'Reset da Vida', exact: true }).waitFor();
  await click('Fechar');
  // Eligibility in Home is evaluated using the app clock, without changing Windows time.
  await page.clock.setFixedTime(new Date('2026-09-28T12:00:00'));
  await nav('Início');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: 'Praticar guitarra', exact: true }).waitFor();
  await page.clock.setFixedTime(new Date());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}
if (mode === 'details' || mode === 'conversions') {
  await nav('Inbox');
  const pending = page.locator('.inbox-row').filter({ hasText: 'Captura de teste para tarefa' });
  if (await pending.count()) {
    await pending.getByRole('button', { name: 'Transformar em tarefa', exact: true }).click();
    await pending.waitFor({ state: 'hidden' });
  }
  for (const target of ['projeto', 'pensamento']) {
    await page.keyboard.press('Control+Space');
    await page.getByPlaceholder('O que você quer guardar?').fill(`Captura de teste para ${target}`);
    await page.getByPlaceholder('O que você quer guardar?').press('Enter');
    await page.locator('dialog').waitFor({ state: 'hidden' });
    await nav('Inbox');
    const row = page.locator('.inbox-row').filter({ hasText: `Captura de teste para ${target}` });
    await row.getByRole('button', { name: `Transformar em ${target}`, exact: true }).click();
    await row.waitFor({ state: 'hidden' });
  }
  await nav('Pensamentos');
  await page
    .locator('.thought-list-item')
    .filter({ hasText: 'Planos para os próximos meses' })
    .click();
  for (const target of ['Tarefa', 'Projeto', 'Inbox']) {
    await page
      .locator('.thought-actions')
      .getByRole('button', { name: target, exact: true })
      .click();
    await page
      .locator('.thought-editor')
      .getByText(/Disponível em/)
      .waitFor();
    await page
      .locator('.thought-actions')
      .getByRole('button', { name: target, exact: true })
      .click();
  }
  for (const table of ['tasks', 'projects', 'inbox_items'])
    assert.equal(
      (await sql(`SELECT * FROM ${table} WHERE source_thought_id IS NOT NULL`)).length,
      1,
    );
  await writeFile(
    `${output}/details-report.json`,
    JSON.stringify(
      {
        calendarTaskMoved: true,
        calendarProjectMoved: true,
        guitarSections: true,
        habitHistory: true,
        habitHomeEligible: true,
        conversions: true,
        keyboardCapture: true,
      },
      null,
      2,
    ),
  );
  console.log('DETAILS_PASSED');
}
if (mode === 'visual') {
  async function capture(name) {
    await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name);
  }
  async function dialogCheck(name) {
    await capture(name);
    const d = page.locator('dialog');
    assert(await d.evaluate((e) => e.scrollWidth <= e.clientWidth));
    await page.getByRole('button', { name: 'Fechar', exact: true }).focus();
    for (const key of ['Shift+Tab', ...Array(22).fill('Tab')]) {
      await page.keyboard.press(key);
      assert(await page.evaluate(() => !!document.activeElement.closest('dialog')));
    }
    await page.keyboard.press('Escape');
    await d.waitFor({ state: 'hidden' });
  }
  for (const theme of ['Claro', 'Escuro']) {
    await click('Configurações');
    await click(theme);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      const prefix = `details-${theme}-${width}`;
      await project('Reset da Vida');
      await capture(prefix + '-project');
      await click('Editar projeto');
      await dialogCheck(prefix + '-modal');
      await page.getByRole('button', { name: /Organizar gavetas/ }).click();
      await dialogCheck(prefix + '-task-drawer');
      await nav('Hábitos');
      await click('Praticar guitarra');
      await dialogCheck(prefix + '-habit-drawer');
      await nav('Rotinas');
      await capture(prefix + '-routine-execution');
      await click('Rotina da noite');
      await dialogCheck(prefix + '-routine-drawer');
      await nav('Pensamentos');
      await page
        .locator('.thought-list-item')
        .filter({ hasText: 'Planos para os próximos meses' })
        .click();
      await capture(prefix + '-thought-editor');
      await page.getByLabel('Pensamento', { exact: true }).focus();
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => document.activeElement.tagName === 'BUTTON'));
      await click('Visualizar Markdown');
      await capture(prefix + '-markdown');
      await nav('Calendário');
      await page.getByRole('button', { name: /quarta-feira, 30 de setembro:/ }).click();
      await dialogCheck(prefix + '-calendar-day');
      await nav('Inbox');
      await capture(prefix + '-inbox');
    }
  }
  console.log('VISUAL_DETAILS_PASSED');
}
if (mode === 'empty') {
  for (const theme of ['Claro', 'Escuro']) {
    await click('Configurações');
    await click(theme);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      for (const name of ['Projetos', 'Hábitos', 'Rotinas', 'Pensamentos', 'Calendário']) {
        await nav(name);
        await page.waitForTimeout(100);
        await page.screenshot({
          path: `${output}/empty-${theme}-${width}-${name}.png`,
          animations: 'disabled',
        });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
    }
  }
  console.log('EMPTY_STATES_PASSED');
}
if (mode === 'close') {
  await nav('Pensamentos');
  await page
    .locator('.thought-list-item')
    .filter({ hasText: 'Planos para os próximos meses' })
    .click();
  const input = page.getByLabel('Pensamento', { exact: true });
  const final = (await input.inputValue()) + '\nPersistência após fechamento nativo.';
  const expected = await snapshot();
  expected.thoughts.find((t) => t.title === 'Planos para os próximos meses').content = final;
  await input.fill(final);
  const closed = page.waitForEvent('close');
  const close = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'rumo.exe' -and $_.ExecutablePath -eq $env:RUMO_TEST_EXECUTABLE} | ForEach-Object {(Get-Process -Id $_.ProcessId).CloseMainWindow()}",
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        RUMO_TEST_EXECUTABLE: join(process.cwd(), 'src-tauri', 'target', 'debug', 'rumo.exe'),
      },
    },
  );
  await new Promise((resolve) => close.on('exit', resolve));
  await closed;
  const db = new DatabaseSync(join(process.env.APPDATA, 'com.rumo.validation.phase2', 'rumo.db'), {
    readOnly: true,
  });
  const persisted = Object.fromEntries(
    tables.map((t) => [
      t,
      db
        .prepare(`SELECT * FROM ${t} ORDER BY 1`)
        .all()
        .map((row) => ({ ...row })),
    ]),
  );
  db.close();
  const thought = expected.thoughts.find((t) => t.title === 'Planos para os próximos meses');
  const saved = persisted.thoughts.find((t) => t.id === thought.id);
  assert(saved.updated_at >= thought.updated_at);
  thought.updated_at = saved.updated_at;
  assert.deepEqual(persisted, expected);
  await writeFile(`${output}/before-native-close.json`, JSON.stringify(persisted, null, 2));
  console.log('NATIVE_CLOSE_REQUESTED');
}
await browser.close();
