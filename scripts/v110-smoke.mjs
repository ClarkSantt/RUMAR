import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const phase = process.argv[2] ?? 'seed';
assert(['seed', 'finish', 'verify', 'overlap'].includes(phase));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9227');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(20000);
const invoke = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
assert.equal(await invoke('plugin:app|identifier'), 'com.rumo.validation.v110');
const info = await invoke('data_info');
assert.match(info.databasePath.replaceAll('\\', '/'), /com\.rumo\.validation\.v110\/rumo\.db$/);
assert.doesNotMatch(info.databasePath, /com\.rumo\.desktop/i);
const select = (query, values = []) =>
  invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values });
const execute = (query, values = []) =>
  invoke('plugin:sql|execute', { db: 'sqlite:rumo.db', query, values });
assert.equal((await select('SELECT MAX(version) version FROM _sqlx_migrations'))[0].version, 12);
const today = await page.evaluate(() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
});
const nav = page.getByRole('navigation', { name: 'Navegação principal' });
const welcome = page.getByRole('heading', {
  name: 'Seu espaço pessoal para organizar o que importa.',
});
if (await welcome.isVisible()) {
  await page.getByRole('textbox', { name: 'Como gostaria de ser chamado?' }).fill('Validação 1.1');
  await page.getByRole('button', { name: 'Começar' }).click();
  await welcome.waitFor({ state: 'detached' });
}
if (phase === 'seed') {
  assert.equal(
    (await select('SELECT COUNT(*) n FROM workout_plans'))[0].n,
    0,
    'Perfil isolado deve estar vazio',
  );
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  const profileForm = page.locator('form.energy-form');
  await profileForm.getByLabel('Data de nascimento').fill('1996-01-01');
  await profileForm.getByLabel('Altura (cm)').fill('180');
  await profileForm.getByLabel('Peso atual (kg)').fill('80');
  await profileForm.getByLabel('Objetivo corporal').selectOption('lose');
  await profileForm.getByRole('button', { name: 'Salvar perfil' }).click();
  await profileForm.getByText(/Perfil salvo/).waitFor();
  await nav.getByRole('button', { name: 'Treinos' }).click();
  await page.getByRole('button', { name: 'Progresso corporal' }).click();
  await page.getByLabel('Passos de hoje').fill('10000');
  await page.getByRole('button', { name: 'Salvar passos' }).click();
  await page.getByText('10.000 passos').first().waitFor();
  await page.getByLabel('Passos de hoje').fill('8500');
  await page.getByRole('button', { name: 'Salvar passos' }).click();
  await page.getByText('8.500 passos').first().waitFor();
  await page.getByRole('button', { name: 'Plano', exact: true }).click();
  await page.getByRole('button', { name: 'Novo plano', exact: true }).click();
  const plan = page.getByRole('dialog', { name: 'Novo plano de treino' });
  await plan.getByLabel('Nome do plano').fill('A/B/C/Upper/Lower');
  await plan.getByLabel('Plano ativo').check();
  await plan.getByRole('button', { name: 'Salvar plano' }).click();
  await page.getByRole('button', { name: 'Adicionar dia' }).click();
  const dayForm = page.getByRole('dialog', { name: 'Novo dia de treino' });
  await dayForm.getByLabel('Nome do dia').fill('Upper');
  await dayForm.getByRole('checkbox', { name: 'Quinta' }).check();
  await dayForm.getByRole('checkbox', { name: 'Sexta' }).check();
  await dayForm.getByRole('button', { name: 'Salvar dia' }).click();
  await page
    .getByText(/Quinta · Sexta/)
    .first()
    .waitFor();
  const workout = (await select("SELECT id FROM workout_days WHERE name='Upper'"))[0];
  await execute(
    "INSERT INTO workout_day_exercises(id,workout_day_id,exercise_id,target_sets,min_reps,max_reps,created_at,updated_at) VALUES('smoke-ex', $1,'builtin-bench',3,6,10,'now','now')",
    [workout.id],
  );
  await nav.getByRole('button', { name: 'Alimentação' }).click();
  await page.getByRole('button', { name: 'Hoje', exact: true }).click();
  await page.getByText(/Gasto estimado hoje/).waitFor();
  await execute(
    "INSERT INTO food_diary_entries(id,entry_date,meal_label,food_id,food_name,quantity,unit,grams_equivalent,nutrients_json,created_at,updated_at) VALUES('smoke-meal',$1,'Almoço','taco:1','Alimento de teste',1,'g',1,'{\"energy_kcal\":1800}','now','now')",
    [today],
  );
  await nav.getByRole('button', { name: 'Calendário' }).click();
  await page.getByRole('button', { name: 'Filtros' }).click();
  await page
    .getByRole('dialog', { name: 'Filtros do calendário' })
    .getByRole('checkbox', { name: 'Hábitos' })
    .uncheck();
  await page
    .getByRole('dialog', { name: 'Filtros do calendário' })
    .getByRole('checkbox', { name: 'Hábitos' })
    .waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Fechar' }).click();
  assert.equal(
    (await select("SELECT visible FROM calendar_source_preferences WHERE source_type='habit'"))[0]
      .visible,
    0,
  );
  const data = {
    today,
    workoutId: workout.id,
    profile: (await select('SELECT settings_json FROM energy_profile'))[0].settings_json,
    steps: (
      await select('SELECT steps FROM daily_activity_entries WHERE entry_date=$1', [today])
    )[0].steps,
    weight: (
      await select(
        "SELECT value FROM body_measurement_values WHERE metric_key='weight' AND record_date=$1",
        [today],
      )
    )[0].value,
  };
  await mkdir('artifacts/v110', { recursive: true });
  await writeFile('artifacts/v110/smoke.json', JSON.stringify(data, null, 2));
  console.log(
    JSON.stringify({
      phase,
      profile: 'persisted',
      steps: data.steps,
      weight: data.weight,
      calendarHabitVisible: false,
      workout: 'Upper',
    }),
  );
} else if (phase === 'finish') {
  if (!(await page.getByRole('dialog', { name: 'Filtros do calendário' }).isVisible())) {
    await nav.getByRole('button', { name: 'Calendário' }).click();
    await page.getByRole('button', { name: 'Filtros' }).click();
  }
  if (
    (await select("SELECT visible FROM calendar_source_preferences WHERE source_type='habit'"))[0]
      ?.visible !== 0
  )
    await page
      .getByRole('dialog', { name: 'Filtros do calendário' })
      .getByRole('checkbox', { name: 'Hábitos' })
      .click();
  for (let tries = 0; tries < 20; tries++) {
    if (
      (await select("SELECT visible FROM calendar_source_preferences WHERE source_type='habit'"))[0]
        ?.visible === 0
    )
      break;
    await page.waitForTimeout(100);
  }
  assert.equal(
    (await select("SELECT visible FROM calendar_source_preferences WHERE source_type='habit'"))[0]
      .visible,
    0,
  );
  await page.getByRole('button', { name: 'Fechar' }).click();
  const data = {
    today,
    profile: (await select('SELECT settings_json FROM energy_profile'))[0].settings_json,
    steps: (
      await select('SELECT steps FROM daily_activity_entries WHERE entry_date=$1', [today])
    )[0].steps,
    weight: (
      await select(
        "SELECT value FROM body_measurement_values WHERE metric_key='weight' AND record_date=$1",
        [today],
      )
    )[0].value,
  };
  await mkdir('artifacts/v110', { recursive: true });
  await writeFile('artifacts/v110/smoke.json', JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ phase, ...data }));
} else {
  const plans = await select(
    "SELECT name,active FROM workout_plans WHERE name='A/B/C/Upper/Lower'",
  );
  assert.equal(plans.length, 1);
  assert.equal(plans[0].active, 1);
  const weekdays = await select(
    "SELECT weekday FROM workout_day_weekdays WHERE workout_day_id=(SELECT id FROM workout_days WHERE name='Upper') ORDER BY weekday",
  );
  assert.deepEqual(
    weekdays.map((r) => r.weekday),
    [4, 5],
  );
  assert.equal(
    (await select('SELECT steps FROM daily_activity_entries WHERE entry_date=$1', [today]))[0]
      .steps,
    8500,
  );
  assert.equal(
    (
      await select(
        "SELECT value FROM body_measurement_values WHERE metric_key='weight' AND record_date=$1",
        [today],
      )
    )[0].value,
    80,
  );
  assert.equal(
    (await select("SELECT visible FROM calendar_source_preferences WHERE source_type='habit'"))[0]
      .visible,
    0,
  );
  await nav.getByRole('button', { name: 'Treinos' }).click();
  await page.getByRole('button', { name: 'Progresso corporal' }).click();
  await page.getByText('8.500 passos').first().waitFor();
  if (phase === 'verify') {
    await page.getByText('Outro dia e detalhes (opcional)').click();
    await page.getByLabel('Passos do treino incluídos no total').fill('1500');
    await page.getByRole('button', { name: 'Salvar passos' }).click();
    for (let tries = 0; tries < 40; tries++) {
      const row = (
        await select('SELECT workout_steps FROM daily_activity_entries WHERE entry_date=$1', [
          today,
        ])
      )[0];
      if (row?.workout_steps === 1500) break;
      await page.waitForTimeout(100);
    }
  }
  assert.equal(
    (
      await select('SELECT workout_steps FROM daily_activity_entries WHERE entry_date=$1', [today])
    )[0].workout_steps,
    1500,
  );
  await page.getByText('Como foi calculado?').click();
  await page.getByText('Ajuste de passos').waitFor();
  await nav.getByRole('button', { name: 'Alimentação' }).click();
  await page.getByRole('button', { name: 'Hoje', exact: true }).click();
  await page.getByText('Balanço da semana').waitFor();
  console.log(
    JSON.stringify({
      phase,
      plans: plans.length,
      weekdays: weekdays.map((r) => r.weekday),
      steps: 8500,
      weight: 80,
      calendarHabitVisible: false,
    }),
  );
}
await browser.close();
