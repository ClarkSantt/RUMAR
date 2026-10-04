import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

// Only the explicitly isolated validation profile is allowed. Never runs on personal data.
const profile = 'com.rumo.validation.phase3',
  output = 'artifacts/phase3';
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
page.on('console', (message) => {
  if (message.type() === 'error') console.error(message.text());
});
assert.equal(
  await page.evaluate(async () => {
    const { getIdentifier } = await import('/node_modules/@tauri-apps/api/app.js');
    return getIdentifier();
  }),
  profile,
);
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
const click = (name) => page.getByRole('button', { name, exact: true }).click();
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
const wait = async (query, predicate) => {
  for (let i = 0; i < 100; i++) {
    const rows = await sql(query);
    if (predicate(rows)) return rows;
    await page.waitForTimeout(80);
  }
  throw Error(`Condition failed: ${query}`);
};
const tables = [
  'settings',
  'tasks',
  'projects',
  'habits',
  'habit_entries',
  'routines',
  'thoughts',
  'inbox_items',
  'exercises',
  'workout_plans',
  'workout_days',
  'workout_day_exercises',
  'workout_sessions',
  'workout_session_exercises',
  'workout_sets',
];
const snapshot = async () =>
  Object.fromEntries(
    await Promise.all(tables.map(async (t) => [t, await sql(`SELECT * FROM ${t} ORDER BY 1`)])),
  );
async function closeNative(name) {
  const expected = await snapshot();
  const closed = page.waitForEvent('close', { timeout: 60000 });
  const child = spawn(
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
  await new Promise((resolve, reject) =>
    child.on('exit', (code) => (code === 0 ? resolve() : reject(Error('Native close failed')))),
  );
  await closed;
  const db = new DatabaseSync(join(process.env.APPDATA, profile, 'rumo.db'), { readOnly: true });
  const actual = Object.fromEntries(
    tables.map((t) => [
      t,
      db
        .prepare(`SELECT * FROM ${t} ORDER BY 1`)
        .all()
        .map((r) => ({ ...r })),
    ]),
  );
  db.close();
  assert.deepEqual(actual, expected);
  await writeFile(`${output}/${name}.json`, JSON.stringify(actual, null, 2));
  console.log(`NATIVE_CLOSE_PERSISTED ${name}`);
}
const mode = process.argv[2] ?? 'seed';
if (mode === 'seed') {
  for (const table of ['tasks', 'projects', 'habits', 'workout_plans', 'workout_sessions'])
    assert.equal(
      (await sql(`SELECT count(*) n FROM ${table}`))[0].n,
      0,
      'seed requires empty validation profile',
    );
  await nav('Hábitos');
  await click('Novo hábito');
  await page.getByLabel('Nome', { exact: true }).fill('Treinar');
  await page
    .getByRole('combobox', { name: 'Frequência', exact: true })
    .selectOption('weekly_target');
  await page.getByLabel('Vezes por semana', { exact: true }).fill('4');
  await click('Salvar hábito');
  const [habit] = await wait('SELECT * FROM habits', (r) => r.length === 1);
  await nav('Treinos');
  await tab('Plano');
  await click('Novo plano');
  await page.getByLabel('Nome do plano').fill('PPL + Upper/Lower');
  await page.getByLabel('Descrição', { exact: true }).fill('Plano de validação local');
  await page.getByRole('combobox', { name: /Hábito vinculado/ }).selectOption(habit.id);
  await click('Salvar plano');
  await click('Ativar plano');
  for (const [name, weekday] of [
    ['Push', '1'],
    ['Pull', '2'],
    ['Legs', '3'],
    ['Upper', String(new Date().getDay())],
    ['Lower', '6'],
  ]) {
    await click('Adicionar dia');
    await page.getByLabel('Nome do dia').fill(name);
    await page.getByRole('combobox', { name: 'Dia da semana', exact: true }).selectOption(weekday);
    await click('Salvar dia');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page
    .getByRole('navigation', { name: 'Dias do plano' })
    .getByRole('button', { name: 'Upper', exact: true })
    .click();
  for (const [id, min, max] of [
    ['builtin-bench', '6', '10'],
    ['builtin-row', '8', '12'],
    ['builtin-press', '8', '12'],
  ]) {
    await click('Adicionar exercício');
    await page.getByRole('combobox', { name: 'Exercício', exact: true }).selectOption(id);
    await page.getByLabel('Reps mínimas').fill(min);
    await page.getByLabel('Reps máximas').fill(max);
    await click('Salvar exercício no dia');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await nav('Início');
  await page.getByRole('button', { name: 'Upper · Hoje · Iniciar', exact: true }).waitFor();
  await nav('Treinos');
  await click('Iniciar treino');
  const bench = page.getByRole('region', { name: 'Supino reto', exact: true });
  for (const [i, load, reps] of [
    [1, '25', '10'],
    [2, '27,5', '9'],
    [3, '30', '8'],
  ]) {
    await bench.getByLabel(`Série ${i}: carga`, { exact: true }).fill(load);
    await bench.getByLabel(`Série ${i}: repetições`, { exact: true }).fill(reps);
    await bench.getByLabel(`Série ${i}: concluída`, { exact: true }).click();
  }
  await wait(
    "SELECT * FROM workout_sets WHERE exercise_id='builtin-bench' AND completed=1",
    (r) => r.length === 3,
  );
  assert.equal((await sql('SELECT count(*) n FROM habit_entries'))[0].n, 0);
  await nav('Início');
  await page.getByRole('button', { name: 'Upper · Continuar treino', exact: true }).waitFor();
  await nav('Treinos');
  await click('Continuar treino');
  await closeNative('in-progress');
} else if (mode === 'resume') {
  assert.deepEqual(
    await snapshot(),
    JSON.parse(await readFile(`${output}/in-progress.json`, 'utf8')),
  );
  await nav('Treinos');
  await tab('Hoje');
  await click('Continuar treino');
  const bench = page.getByRole('region', { name: 'Supino reto', exact: true });
  assert.equal(await bench.getByLabel('Série 2: carga', { exact: true }).inputValue(), '27,5');
  assert.equal(await bench.getByLabel('Série 3: repetições', { exact: true }).inputValue(), '8');
  await click('Finalizar treino');
  await page.getByText('3 séries · 27 repetições', { exact: true }).waitFor();
  await wait('SELECT * FROM habit_entries', (r) => r.length === 1 && r[0].value === 1);
  await nav('Início');
  await page.getByRole('button', { name: 'Upper · Concluído', exact: true }).waitFor();
  await closeNative('completed');
} else if (mode === 'second' || mode === 'second-continue') {
  if (mode === 'second') {
    assert.deepEqual(
      await snapshot(),
      JSON.parse(await readFile(`${output}/completed.json`, 'utf8')),
    );
    await nav('Treinos');
    await tab('Histórico');
    await page.locator('.workout-history-row').filter({ hasText: 'Upper' }).click();
    await page.getByText('3 séries · 27 repetições', { exact: true }).waitFor();
    await click('← Voltar aos treinos');
    await tab('Hoje');
    const [upper] = await sql("SELECT id FROM workout_days WHERE name='Upper'");
    await page.getByRole('combobox', { name: 'Dia do plano ativo' }).selectOption(upper.id);
    await click('Iniciar escolhido');
  } else {
    await nav('Treinos');
    await tab('Hoje');
    await click('Continuar treino');
  }
  const bench = page.getByRole('region', { name: 'Supino reto', exact: true });
  await bench.getByText('Último treino', { exact: true }).waitFor();
  await bench.getByRole('button', { name: 'Usar cargas anteriores' }).click();
  await wait(
    "SELECT w.* FROM workout_sets w JOIN workout_sessions s ON s.id=w.workout_session_id WHERE s.status='in_progress' AND w.exercise_id='builtin-bench'",
    (r) => r.length === 3 && r[2].load_value === 30 && r.every((s) => !s.completed),
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Supino reto"] [aria-label="Série 3: carga"]')?.value ===
      '30',
  );
  await bench.getByLabel('Série 3: repetições', { exact: true }).fill('9');
  await bench.getByLabel('Série 3: concluída', { exact: true }).click();
  await bench.getByText(/Novo recorde/).waitFor();
  await bench.getByText(/\+1 rep/).waitFor();
  await click('Finalizar treino');
  await page.getByText('1 séries · 9 repetições', { exact: true }).waitFor();
  assert.equal((await sql('SELECT count(*) n FROM habit_entries'))[0].n, 1);
  await bench.getByLabel('Série 3: repetições', { exact: true }).fill('10');
  await bench.getByLabel('Série 3: repetições', { exact: true }).press('Tab');
  await page.getByText('1 séries · 10 repetições', { exact: true }).waitFor();
  await page.getByText(/Volume registrado.*300/).waitFor();
  await click('← Voltar aos treinos');
  await tab('Evolução');
  await page
    .getByRole('combobox', { name: 'Exercício', exact: true })
    .selectOption('builtin-bench');
  await page.getByText('30 kg/lado × 10', { exact: true }).waitFor();
  await writeFile(
    `${output}/functional-report.json`,
    JSON.stringify(
      {
        nativeRestartInProgress: true,
        restartCompleted: true,
        sets: [25, 27.5, 30],
        previous: true,
        copyUnchecked: true,
        newRecord: true,
        historicalEditRefresh: true,
        habitUnique: true,
        homeStates: ['planned', 'in_progress', 'completed'],
      },
      null,
      2,
    ),
  );
  console.log('SECOND_SESSION_AND_HISTORICAL_EDIT_OK');
} else if (mode === 'inspect')
  console.log((await page.locator('body').innerText()).slice(0, 16000));
else if (mode === 'close') await closeNative('final');
else if (mode === 'close-completed') await closeNative('completed');
else if (mode === 'snapshot-completed')
  await writeFile(`${output}/completed.json`, JSON.stringify(await snapshot(), null, 2));
else if (mode === 'verify-final') {
  assert.deepEqual(await snapshot(), JSON.parse(await readFile(`${output}/final.json`, 'utf8')));
  console.log('ALL_TABLES_IDENTICAL_AFTER_RESTART');
} else throw Error('Unknown mode');
await browser.close();
