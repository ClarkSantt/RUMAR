import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Run only against `tauri dev --config artifacts/phase4/validation.conf.json`.
// The identifier assertion precedes every write; this never touches personal data.
const profile = 'com.rumo.validation.phase4';
const output = 'artifacts/phase4';
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
assert.equal(
  await page.evaluate(async () => {
    const { getIdentifier } = await import('/node_modules/@tauri-apps/api/app.js');
    return getIdentifier();
  }),
  profile,
);
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
const waitSql = async (query, predicate) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rows = await sql(query);
    if (predicate(rows)) return rows;
    await page.waitForTimeout(100);
  }
  throw Error(`Timed out waiting for ${query}`);
};
const nav = (name) =>
  page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name, exact: true })
    .click();
const tab = (name) =>
  page
    .getByRole('navigation', { name: 'Seções de alimentação' })
    .getByRole('button', { name, exact: true })
    .click();
const save = (name) => page.getByRole('button', { name, exact: true }).click();
const mode = process.argv[2] ?? 'seed';
const persistedTables = [
  'foods',
  'food_nutrients',
  'meals',
  'meal_items',
  'diet_plans',
  'diet_meals',
  'food_diary_entries',
  'body_weight_entries',
  'nutrition_goals',
  'settings',
];
const snapshot = async () =>
  Object.fromEntries(
    await Promise.all(
      persistedTables.map(async (table) => [table, await sql(`SELECT * FROM ${table} ORDER BY 1`)]),
    ),
  );

if (mode === 'seed') {
  assert.equal(
    (await sql('SELECT count(*) n FROM food_diary_entries'))[0].n,
    0,
    'Fresh validation profile required',
  );
  assert.equal((await sql("SELECT count(*) n FROM foods WHERE source_id='taco'"))[0].n, 597);
  await nav('Alimentação');
  await page.getByRole('heading', { name: 'Alimentação' }).waitFor();
  await tab('Alimentos');
  await page.getByLabel('Buscar alimento').fill('frango');
  await page.getByText('Frango, peito, sem pele, grelhado', { exact: true }).click();
  await page.getByText('Micronutrientes e fibras').click();
  await page.screenshot({ path: join(output, 'food-light.png'), animations: 'disabled' });
  await save('Novo alimento');
  await page.getByLabel('Nome', { exact: true }).fill('Whey de validação');
  await page.getByLabel('Calorias (kcal)', { exact: true }).fill('120');
  await page.getByLabel('Proteínas (g)', { exact: true }).fill('24');
  await save('Salvar alimento');
  assert.equal((await sql("SELECT count(*) n FROM foods WHERE source_id='custom'"))[0].n, 1);

  await tab('Refeições');
  for (const [name, foods] of [
    ['Café da manhã', ['Banana, prata, crua', 'Aveia, flocos, crua']],
    ['Almoço', ['Arroz, integral, cozido', 'Frango, peito, sem pele, grelhado']],
    ['Jantar', ['Ovo, de galinha, inteiro, cozido']],
  ]) {
    await page.getByLabel('Nova refeição').fill(name);
    await save('Criar');
    await page.getByRole('button', { name, exact: true }).click();
    for (const food of foods) {
      const picker = page.getByRole('group', { name: 'Alimentos encontrados' });
      await page.getByLabel('Buscar alimento').fill(food);
      await picker
        .getByRole('button', { name: new RegExp(food.split(',')[0]) })
        .first()
        .click();
      await save('Salvar');
      await picker.waitFor({ state: 'visible' });
    }
  }
  assert.equal((await sql('SELECT count(*) n FROM meals'))[0].n, 3);
  assert.equal((await sql('SELECT count(*) n FROM meal_items'))[0].n, 5);
  await page.screenshot({ path: join(output, 'meal-light.png'), animations: 'disabled' });

  await tab('Dieta');
  await page.getByLabel('Nova dieta').fill('Dieta atual');
  await save('Criar');
  await page.getByRole('button', { name: 'Dieta atual', exact: false }).first().click();
  await save('Ativar dieta');
  for (const name of ['Café da manhã', 'Almoço', 'Jantar']) {
    await page.getByLabel('Adicionar refeição').selectOption({ label: name });
    await save('Adicionar');
  }
  assert.equal((await sql('SELECT count(*) n FROM diet_meals'))[0].n, 3);
  await page.screenshot({ path: join(output, 'diet-light.png'), animations: 'disabled' });

  await tab('Diário');
  for (const name of ['Café da manhã', 'Almoço', 'Jantar']) {
    await page.getByLabel('Copiar refeição planejada').selectOption({ label: name });
    await save('Copiar para o diário');
  }
  assert.equal((await sql('SELECT count(*) n FROM food_diary_entries'))[0].n, 5);
  await page.screenshot({ path: join(output, 'diary-light.png'), animations: 'disabled' });

  await tab('Peso');
  await page.getByLabel('Peso (kg)').fill('72,5');
  await save('Registrar');
  assert.equal(
    (await waitSql('SELECT weight_kg FROM body_weight_entries', (r) => r.length === 1))[0]
      .weight_kg,
    72.5,
  );
  await tab('Compras');
  await page.getByText('Arroz, integral, cozido', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'shopping-light.png'), animations: 'disabled' });
  await tab('Histórico');
  await page.screenshot({ path: join(output, 'history-light.png'), animations: 'disabled' });
  await nav('Início');
  await page.getByRole('heading', { name: 'Alimentação' }).waitFor();
  await page.screenshot({ path: join(output, 'home-light.png'), animations: 'disabled' });
  const summary = {
    foods: (await sql("SELECT count(*) n FROM foods WHERE source_id='taco'"))[0].n,
    custom: (await sql("SELECT count(*) n FROM foods WHERE source_id='custom'"))[0].n,
    meals: (await sql('SELECT count(*) n FROM meals'))[0].n,
    entries: (await sql('SELECT count(*) n FROM food_diary_entries'))[0].n,
    weights: (await sql('SELECT count(*) n FROM body_weight_entries'))[0].n,
  };
  await writeFile(join(output, 'smoke-seed.json'), JSON.stringify(summary, null, 2));
  console.log('PHASE4_SEED_OK', summary);
} else if (mode === 'resume') {
  assert.equal((await sql('SELECT count(*) n FROM food_diary_entries'))[0].n, 5);
  assert.equal((await sql('SELECT weight_kg FROM body_weight_entries'))[0].weight_kg, 72.5);
  await nav('Alimentação');
  await tab('Compras');
  await page.getByText('Arroz, integral, cozido', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'shopping-light.png'), animations: 'disabled' });
  await tab('Histórico');
  await page.screenshot({ path: join(output, 'history-light.png'), animations: 'disabled' });
  await nav('Início');
  await page.getByRole('heading', { name: 'Alimentação' }).waitFor();
  await page.screenshot({ path: join(output, 'home-light.png'), animations: 'disabled' });
  const summary = {
    foods: (await sql("SELECT count(*) n FROM foods WHERE source_id='taco'"))[0].n,
    custom: (await sql("SELECT count(*) n FROM foods WHERE source_id='custom'"))[0].n,
    meals: (await sql('SELECT count(*) n FROM meals'))[0].n,
    entries: (await sql('SELECT count(*) n FROM food_diary_entries'))[0].n,
    weights: (await sql('SELECT count(*) n FROM body_weight_entries'))[0].n,
  };
  await writeFile(join(output, 'smoke-seed.json'), JSON.stringify(summary, null, 2));
  console.log('PHASE4_SEED_OK', summary);
} else if (mode === 'verify') {
  const before = JSON.parse(await readFile(join(output, 'preclose.json'), 'utf8'));
  assert.deepEqual(await snapshot(), before, 'Nutrition data changed across native restart');
  const counts = await Promise.all(
    ['foods', 'meals', 'diet_plans', 'diet_meals', 'food_diary_entries', 'body_weight_entries'].map(
      async (table) => [table, (await sql(`SELECT count(*) n FROM ${table}`))[0].n],
    ),
  );
  const result = Object.fromEntries(counts);
  assert.equal(result.foods, 599);
  assert.equal(result.meals, 3);
  assert.equal((await sql("SELECT count(*) n FROM foods WHERE name='Barra por porção'"))[0].n, 1);
  assert.equal(result.diet_plans, 1);
  assert.equal(result.diet_meals, 3);
  assert.equal(result.food_diary_entries, 5);
  assert.ok(result.body_weight_entries >= 1);
  await nav('Alimentação');
  await tab('Hoje');
  await page.getByText('Refeições registradas').waitFor();
  await tab('Dieta');
  await page.getByText('Dieta atual').first().waitFor();
  await tab('Peso');
  await page.getByText('72,5 kg').waitFor();
  await writeFile(join(output, 'smoke-restart.json'), JSON.stringify(result, null, 2));
  console.log('PHASE4_RESTART_OK', result);
} else if (mode === 'snapshot') {
  const data = await snapshot();
  await writeFile(join(output, 'preclose.json'), JSON.stringify(data, null, 2));
  console.log(
    'PHASE4_SNAPSHOT_OK',
    Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
  );
} else if (mode === 'weight-history') {
  assert.equal((await sql('SELECT count(*) n FROM body_weight_entries'))[0].n, 1);
  await page.locator('aside').getByRole('button', { name: 'Configurações' }).click();
  await page.getByRole('group', { name: 'Tema' }).getByRole('button', { name: 'Claro' }).click();
  await nav('Alimentação');
  await tab('Peso');
  await page.getByLabel('Data').fill('2026-09-26');
  await page.getByLabel('Peso (kg)').fill('73,0');
  await save('Registrar');
  await waitSql('SELECT count(*) n FROM body_weight_entries', (r) => r[0].n === 2);
  await page.getByLabel('Evolução do peso').waitFor();
  await page.screenshot({ path: join(output, 'weight-chart-light.png'), animations: 'disabled' });
  console.log('PHASE4_WEIGHT_CHART_OK');
} else if (mode === 'units') {
  await nav('Alimentação');
  await tab('Alimentos');
  await save('Novo alimento');
  await page.getByLabel('Nome', { exact: true }).fill('Barra por porção');
  await page.getByLabel('Quantidade base').fill('1');
  await page.getByLabel('Unidade da base').selectOption('porção');
  await page.getByLabel('Equivalente da base em gramas').fill('30');
  await page.getByLabel('Calorias (kcal)', { exact: true }).fill('120');
  await save('Salvar alimento');
  const food = (
    await waitSql(
      "SELECT base_amount,base_unit,base_grams_equivalent FROM foods WHERE name='Barra por porção'",
      (r) => r.length === 1,
    )
  )[0];
  assert.deepEqual(food, { base_amount: 1, base_unit: 'porção', base_grams_equivalent: 30 });
  await page.screenshot({ path: join(output, 'custom-portion.png'), animations: 'disabled' });
  console.log('PHASE4_UNITS_OK', food);
} else if (mode === 'audit') {
  const checks = [];
  await nav('Alimentação');
  await tab('Hoje');
  await save('Definir metas diárias');
  for (const [label, value] of [
    ['Calorias (kcal)', '2074'],
    ['Carboidratos (g)', '260'],
    ['Proteínas (g)', '104'],
    ['Gorduras (g)', '70'],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await save('Salvar metas');
  await page.getByText('kcal restantes').waitFor();
  for (const theme of ['Claro', 'Escuro']) {
    await page.locator('aside').getByRole('button', { name: 'Configurações' }).click();
    await page.getByRole('group', { name: 'Tema' }).getByRole('button', { name: theme }).click();
    await page.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      theme === 'Claro' ? 'light' : 'dark',
    );
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      await nav('Alimentação');
      for (const section of [
        'Hoje',
        'Dieta',
        'Diário',
        'Alimentos',
        'Refeições',
        'Peso',
        'Histórico',
        'Compras',
      ]) {
        await tab(section);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(
          overflow <= 1,
          `${theme} ${width}x${height} ${section}: horizontal overflow ${overflow}px`,
        );
        await page.screenshot({
          path: join(output, `audit-${theme}-${width}x${height}-${section}.png`),
          animations: 'disabled',
        });
        checks.push({ theme, width, height, section, overflow });
      }
      await tab('Alimentos');
      await page.getByLabel('Buscar alimento').focus();
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.outerHTML ?? '');
      assert.match(focused, /select/);
    }
  }
  await writeFile(join(output, 'visual-report.json'), JSON.stringify(checks, null, 2));
  console.log('PHASE4_VISUAL_OK', checks.length);
} else throw Error('Use seed, resume, units, weight-history, audit, snapshot or verify');
await browser.close();
