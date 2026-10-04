import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const output = 'artifacts/phase2';
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
const click = async (name) => {
  await page.getByRole('button', { name, exact: true }).click();
};
const nav = async (name) => {
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name, exact: true })
    .click();
};
const waitSQL = async (query, test) => {
  for (let i = 0; i < 100; i++) {
    const rows = await sql(query);
    if (test(rows)) return rows;
    await page.waitForTimeout(100);
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
const mode = process.argv[2] ?? 'seed';
await page.reload();
await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor();
assert.equal(
  await page.evaluate(async () => {
    const { getIdentifier } = await import('/node_modules/@tauri-apps/api/app.js');
    return getIdentifier();
  }),
  'com.rumo.validation.phase2',
);
const today = await page.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});
if (mode === 'reset') {
  // Conversion origins can form a cycle; only this verified disposable profile is reset.
  await sql('UPDATE thoughts SET source_inbox_id=NULL', [], true);
  await sql('UPDATE inbox_items SET source_thought_id=NULL', [], true);
  for (const t of [
    'routine_item_completions',
    'routine_occurrences',
    'routine_items',
    'routines',
    'habit_entries',
    'habits',
    'subtask_completions',
    'task_completions',
    'subtasks',
    'tasks',
    'project_sections',
    'projects',
    'inbox_items',
    'thoughts',
  ])
    await sql('DELETE FROM ' + t, [], true);
  console.log('ISOLATED_PROFILE_RESET');
} else if (mode === 'seed') {
  for (const t of tables.filter((t) => t !== 'settings'))
    assert.equal((await sql(`SELECT * FROM ${t}`)).length, 0, `Refusing existing ${t}`);
  await writeFile(`${output}/settings.json`, JSON.stringify(await sql('SELECT * FROM settings')));
  await nav('Projetos');
  await click('Novo projeto');
  await page.getByLabel('Nome', { exact: true }).fill('Reset da Vida');
  await page.getByLabel('Prazo', { exact: true }).fill(today);
  await click('Salvar projeto');
  await page.getByRole('heading', { name: 'Reset da Vida', exact: true }).waitFor();
  for (const [section, tasks] of [
    [
      'Quarto e ambiente',
      ['Organizar guarda-roupa', 'Organizar gavetas', 'Organizar documentos físicos'],
    ],
    ['Vida digital', ['Organizar computador', 'Organizar celular', 'Organizar backups']],
  ]) {
    await page.getByPlaceholder('Adicionar seção…').fill(section);
    await page.getByPlaceholder('Adicionar seção…').press('Enter');
    const input = page.getByPlaceholder(`Adicionar tarefa em ${section}…`);
    await input.waitFor();
    for (const title of tasks) {
      await input.fill(title);
      await input.press('Enter');
      await waitSQL('SELECT title FROM tasks', (rows) => rows.some((r) => r.title === title));
    }
  }
  for (const name of ['Organizar guarda-roupa', 'Organizar computador']) {
    await page.getByRole('checkbox', { name: `Concluir ${name}`, exact: true }).click();
    await waitSQL("SELECT * FROM tasks WHERE status='completed'", (r) =>
      r.some((t) => t.title === name),
    );
  }
  await page.getByText('2 de 6 tarefas concluídas', { exact: false }).waitFor();
  await nav('Projetos');
  await click('Todos os projetos');
  await click('Novo projeto');
  await page.getByLabel('Nome', { exact: true }).fill('Aprender guitarra');
  await page
    .getByLabel('Descrição', { exact: false })
    .fill('Aprender fundamentos e tocar músicas completas.');
  await click('Salvar projeto');
  await page.getByRole('heading', { name: 'Aprender guitarra', exact: true }).waitFor();
  await nav('Hábitos');
  await click('Novo hábito');
  await page.getByLabel('Nome', { exact: true }).fill('Praticar guitarra');
  await page.getByRole('combobox', { name: 'Frequência', exact: true }).selectOption('weekdays');
  await page.getByRole('combobox', { name: 'Registro', exact: true }).selectOption('quantity');
  await page.getByLabel('Meta', { exact: true }).fill('30');
  await page.getByLabel('Unidade', { exact: true }).fill('min');
  await page.getByLabel('Início', { exact: true }).fill(today.slice(0, 7) + '-01');
  await page
    .getByRole('combobox', { name: 'Projeto', exact: true })
    .selectOption({ label: 'Aprender guitarra' });
  await click('Salvar hábito');
  await page.getByRole('button', { name: 'Praticar guitarra', exact: true }).waitFor();
  await click('Praticar guitarra');
  await page.screenshot({ path: `${output}/habit-editor.png`, animations: 'disabled' });
  await click('Fechar');
  await nav('Rotinas');
  await click('Nova rotina');
  await page.getByLabel('Nome', { exact: true }).fill('Rotina da noite');
  await click('Salvar e adicionar itens');
  for (const title of [
    'Skincare',
    'Escovar dentes',
    'Organizar mesa',
    'Ver compromissos de amanhã',
    'Preparar roupa',
  ]) {
    await page.getByLabel('Novo item da rotina', { exact: true }).fill(title);
    await click('Adicionar item');
    await waitSQL('SELECT title FROM routine_items', (r) => r.some((t) => t.title === title));
  }
  await click('Salvar rotina');
  await click('Iniciar rotina');
  for (const title of ['Skincare', 'Escovar dentes', 'Organizar mesa']) {
    await page.getByRole('checkbox', { name: title, exact: true }).click();
    await waitSQL(
      'SELECT * FROM routine_item_completions',
      (r) => r.length >= ['Skincare', 'Escovar dentes', 'Organizar mesa'].indexOf(title) + 1,
    );
  }
  await nav('Pensamentos');
  await click('Novo pensamento');
  await page.getByLabel('Título (opcional)', { exact: true }).fill('Planos para os próximos meses');
  const content =
    '# Planos\n\n' +
    'Quero aprender guitarra, organizar a casa e registrar minhas ideias com tranquilidade.\n'.repeat(
      150,
    );
  await page.getByLabel('Pensamento', { exact: true }).fill(content);
  await nav('Início');
  await nav('Pensamentos');
  await page.locator('.thought-list-item').first().click();
  assert.equal(await page.getByLabel('Pensamento', { exact: true }).inputValue(), content);
  await page
    .getByLabel('Pensamento', { exact: true })
    .fill(content + 'Última linha antes de fechar.');
  await writeFile(`${output}/expected-thought.txt`, content + 'Última linha antes de fechar.');
  await page.evaluate(async () => {
    const { getCurrentWindow } = await import('/node_modules/@tauri-apps/api/window.js');
    await getCurrentWindow().emit('tauri://close-requested');
  });
  console.log('SEED_COMPLETE_NATIVE_CLOSE');
} else if (mode === 'verify') {
  const expected = await readFile(`${output}/expected-thought.txt`, 'utf8');
  assert.equal((await sql('SELECT content FROM thoughts'))[0].content, expected);
  assert.equal((await sql('SELECT * FROM projects')).length, 2);
  assert.equal((await sql('SELECT * FROM project_sections')).length, 2);
  assert.equal((await sql('SELECT * FROM tasks')).length, 6);
  assert.equal((await sql("SELECT * FROM tasks WHERE status='completed'")).length, 2);
  assert.equal((await sql('SELECT * FROM routine_item_completions')).length, 3);
  await writeFile(`${output}/persisted.json`, JSON.stringify(await snapshot(), null, 2));
  for (const theme of ['Claro', 'Escuro']) {
    await click('Configurações');
    await click(theme);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      for (const section of [
        'Início',
        'Projetos',
        'Hábitos',
        'Rotinas',
        'Pensamentos',
        'Calendário',
      ]) {
        await nav(section);
        await page.waitForTimeout(200);
        await page.screenshot({
          path: `${output}/${theme}-${width}-${section}.png`,
          animations: 'disabled',
        });
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `Horizontal overflow ${section}`,
        );
      }
    }
  }
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        status: 'passed',
        persisted: true,
        themes: ['light', 'dark'],
        sizes: [
          [1366, 768],
          [1920, 1080],
        ],
      },
      null,
      2,
    ),
  );
  console.log('VERIFY_COMPLETE');
} else if (mode === 'cleanup') {
  const expected = JSON.parse(await readFile(`${output}/before-native-close.json`, 'utf8'));
  for (const thought of expected.thoughts ?? [])
    await sql('UPDATE thoughts SET source_inbox_id=NULL WHERE id=$1', [thought.id], true);
  for (const capture of expected.inbox_items ?? [])
    await sql('UPDATE inbox_items SET source_thought_id=NULL WHERE id=$1', [capture.id], true);
  for (const t of [
    'routine_item_completions',
    'routine_occurrences',
    'routine_items',
    'routines',
    'habit_entries',
    'habits',
    'subtask_completions',
    'task_completions',
    'subtasks',
    'tasks',
    'project_sections',
    'projects',
    'inbox_items',
    'thoughts',
  ]) {
    for (const row of expected[t] ?? []) {
      if (row.id) await sql(`DELETE FROM ${t} WHERE id=$1`, [row.id], true);
    }
  }
  for (const s of JSON.parse(await readFile(`${output}/settings.json`, 'utf8')))
    await sql(
      'UPDATE settings SET value=$2,updated_at=$3 WHERE key=$1',
      [s.key, s.value, s.updated_at],
      true,
    );
  console.log('CLEANUP_COMPLETE');
}
await browser.close();
