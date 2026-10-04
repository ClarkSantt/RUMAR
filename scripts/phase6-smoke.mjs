import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Run only with a release build using artifacts/phase6/validation.conf.json
// and WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9226.
const identifier = 'com.rumo.validation.phase6';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const invoke = (command, args = {}) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
const select = (query, values = []) =>
  invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values });
const execute = (query, values = []) =>
  invoke('plugin:sql|execute', { db: 'sqlite:rumo.db', query, values });
const actualIdentifier = await invoke('plugin:app|identifier');
assert.equal(actualIdentifier, identifier, 'Refusing to touch a non-validation profile');
const info = await invoke('data_info');
assert.match(info.databasePath.replaceAll('\\', '/'), /com\.rumo\.validation\.phase6\/rumo\.db$/);
assert.doesNotMatch(info.databasePath, /com\.rumo\.desktop/i);
await execute("DELETE FROM tasks WHERE title='Teste teclado da busca'");
const empty = await select(
  'SELECT (SELECT count(*) FROM tasks) tasks,(SELECT count(*) FROM projects) projects,(SELECT count(*) FROM finance_transactions) transactions',
);
const fresh = empty[0].tasks === 0 && empty[0].projects === 0 && empty[0].transactions === 0;
if (!fresh) {
  assert.equal(
    (await select("SELECT name FROM projects WHERE id='release-project'"))[0]?.name,
    'Aprender guitarra',
    'Refusing an unknown nonempty profile',
  );
  assert.equal(
    (await select("SELECT description FROM finance_transactions WHERE id='release-transaction'"))[0]
      ?.description,
    'Mercado R$ 927,38',
  );
}
if (fresh) {
  const welcome = page.getByRole('textbox', { name: 'Como gostaria de ser chamado?' });
  if (await welcome.isVisible()) {
    await welcome.fill('Teste Release');
    await page.getByRole('button', { name: 'Começar', exact: true }).click();
  }
  await page.getByPlaceholder('Adicionar tarefa para hoje…').fill('Comprar guitarra');
  await page.getByPlaceholder('Adicionar tarefa para hoje…').press('Enter');
  await page.waitForTimeout(250);
  assert.equal(
    (await select("SELECT count(*) n FROM tasks WHERE title='Comprar guitarra'"))[0].n,
    1,
  );

  const date = new Date().toISOString();
  const day = date.slice(0, 10);
  await execute('INSERT INTO projects(id,name,created_at,updated_at) VALUES($1,$2,$3,$3)', [
    'release-project',
    'Aprender guitarra',
    date,
  ]);
  await execute(
    "INSERT INTO habits(id,name,frequency,kind,start_date,project_id,created_at,updated_at) VALUES('release-habit','Praticar guitarra','daily','boolean',$1,'release-project',$2,$2)",
    [day, date],
  );
  await execute(
    "INSERT INTO routines(id,name,frequency,created_at,updated_at) VALUES('release-routine','Rotina de teste','daily',$1,$1)",
    [date],
  );
  await execute(
    "INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES('release-thought','Ideias sobre guitarra','Texto sintético de validação',$1,$1)",
    [date],
  );
  await execute(
    "INSERT INTO workout_plans(id,name,created_at,updated_at) VALUES('release-plan','Plano de teste',$1,$1)",
    [date],
  );
  await execute(
    "INSERT INTO exercises(id,name,muscle_group,equipment,load_type,created_at,updated_at) VALUES('release-exercise','Supino de teste','Peito','Barra','per_side',$1,$1)",
    [date],
  );
  await execute(
    "INSERT INTO workout_sessions(id,workout_plan_id,plan_name,day_name,session_date,started_at,status,created_at,updated_at) VALUES('release-session','release-plan','Plano de teste','Upper',$1,$2,'in_progress',$2,$2)",
    [day, date],
  );
  await execute(
    "INSERT INTO meals(id,name,created_at,updated_at) VALUES('release-meal','Refeição de teste',$1,$1)",
    [date],
  );
  await execute(
    "INSERT INTO diet_plans(id,name,created_at,updated_at) VALUES('release-diet','Dieta de teste',$1,$1)",
    [date],
  );
  const food = (await select("SELECT id FROM foods WHERE source_id='taco' LIMIT 1"))[0].id;
  await execute(
    "INSERT INTO food_diary_entries(id,entry_date,food_id,food_name,quantity,unit,grams_equivalent,nutrients_json,created_at,updated_at) VALUES('release-diary',$1,$2,'Alimento de teste',100,'g',100,'{}',$3,$3)",
    [day, food, date],
  );
  await execute(
    'INSERT INTO body_measurement_records(record_id,measurement_date,pending_values,created_at,updated_at) VALUES(\'release-weight\',$1,\'{"weight":70,"waist":91}\',$2,$2)',
    [day, date],
  );
  await execute(
    "INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES('release-account','Conta de teste','checking',$1,$1)",
    [date],
  );
  await execute(
    "INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at) VALUES('release-transaction','release-account',$1,92738,'expense','Mercado R$ 927,38','MERCADO',$2,$2)",
    [day, date],
  );
  await execute(
    "INSERT INTO finance_goals(id,name,target_amount_cents,created_at,updated_at) VALUES('release-goal','Guitarra nova',100000,$1,$1)",
    [date],
  );
  await execute('UPDATE finance_preferences SET hide_values=1 WHERE id=1');
}

await page.keyboard.press('Control+k');
const search = page.getByRole('textbox', { name: 'Buscar no RUMO' });
await search.fill('guitarra');
await page
  .getByRole('listbox', { name: 'Resultados da busca' })
  .getByText('Aprender guitarra')
  .waitFor();
assert.match(
  await page.getByRole('listbox').innerText(),
  /PROJETOS[\s\S]*HÁBITOS[\s\S]*PENSAMENTOS/,
);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+k');
await search.fill('Mercado');
await page
  .getByRole('listbox')
  .getByText(/Transação financeira/)
  .waitFor();
assert.doesNotMatch(await page.getByRole('listbox').innerText(), /927,38|92738/);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+Space');
await page
  .getByRole('dialog')
  .getByText(/Capturar|Inbox/i)
  .first()
  .waitFor();
await page.keyboard.press('Escape');

await mkdir('artifacts/phase6', { recursive: true });
const backup = resolve(`artifacts/phase6/smoke-A-${Date.now()}.zip`);
const manifest = await invoke('create_backup', { destination: backup });
assert.equal(manifest.app, 'RUMO');
assert.equal(manifest.schemaVersion, 9);
assert.equal(manifest.sha256.length, 64);
await execute("UPDATE tasks SET title='Estado B' WHERE title='Comprar guitarra'");
await execute("UPDATE finance_transactions SET amount_cents=12345 WHERE id='release-transaction'");
const random = resolve('artifacts/phase6/not-a-backup.zip');
await writeFile(random, 'not a zip');
await assert.rejects(invoke('inspect_backup', { source: random }));
assert.equal((await select("SELECT title FROM tasks WHERE title='Estado B'"))[0].title, 'Estado B');

await invoke('plugin:sql|close', { db: 'sqlite:rumo.db' });
const preventive = await invoke('restore_backup', { source: backup });
await page.reload();
await page.waitForTimeout(500);
assert.equal(
  (await select("SELECT title FROM tasks WHERE title='Comprar guitarra'"))[0].title,
  'Comprar guitarra',
);
assert.equal(
  (await select("SELECT amount_cents FROM finance_transactions WHERE id='release-transaction'"))[0]
    .amount_cents,
  92738,
);
assert.equal((await select('PRAGMA integrity_check'))[0].integrity_check, 'ok');
const preventiveManifest = await invoke('inspect_backup', { source: preventive });
assert.equal(preventiveManifest.kind, 'pre_restore');
await invoke('plugin:sql|close', { db: 'sqlite:rumo.db' });
await invoke('restore_backup', { source: preventive });
await page.reload();
await page.waitForTimeout(500);
assert.equal((await select("SELECT title FROM tasks WHERE title='Estado B'"))[0].title, 'Estado B');
assert.equal(
  (await select("SELECT amount_cents FROM finance_transactions WHERE id='release-transaction'"))[0]
    .amount_cents,
  12345,
);
console.log(
  JSON.stringify(
    {
      identifier,
      backup,
      preventive,
      schema: manifest.schemaVersion,
      modules: [
        'tasks',
        'projects',
        'habits',
        'routines',
        'thoughts',
        'workouts',
        'nutrition',
        'finance',
        'settings',
      ],
      integrity: 'ok',
    },
    null,
    2,
  ),
);
await browser.close();
