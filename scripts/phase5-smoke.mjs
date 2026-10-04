import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Requires tauri dev with artifacts/phase5/validation.conf.json and CDP port 9225.
// Every write happens only after the app identifier is checked. No personal OFX is used.
const output = 'artifacts/phase5',
  profile = 'com.rumo.validation.phase5';
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
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
const nav = (name) =>
  page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name, exact: true })
    .click();
const tab = (name) =>
  page
    .getByRole('navigation', { name: 'Seções de Finanças' })
    .getByRole('button', { name, exact: true })
    .click();
const save = (name) => page.getByRole('button', { name, exact: true }).click();
const waitCount = async (table, count) => {
  for (let i = 0; i < 60; i++) {
    const n = (await sql(`SELECT count(*) n FROM ${table}`))[0].n;
    if (n === count) return;
    await page.waitForTimeout(100);
  }
  throw Error(`Expected ${count} rows in ${table}`);
};
const tables = [
  'finance_accounts',
  'finance_transactions',
  'finance_categories',
  'finance_rules',
  'finance_import_batches',
  'finance_month_plans',
  'finance_category_budgets',
  'finance_recurring',
  'finance_goals',
  'finance_goal_contributions',
  'finance_assets',
  'finance_asset_valuations',
  'finance_preferences',
];
const snapshot = async () =>
  Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [table, await sql(`SELECT * FROM ${table} ORDER BY 1`)]),
    ),
  );
const mode = process.argv[2] ?? 'seed';
if (mode === 'seed') {
  assert.equal(
    (await sql('SELECT count(*) n FROM finance_accounts'))[0].n,
    0,
    'Fresh isolated profile required',
  );
  await nav('Finanças');
  await page.getByRole('heading', { name: 'Finanças' }).waitFor();
  const form = page.getByRole('heading', { name: 'Nova conta' }).locator('..');
  for (const [name, type] of [
    ['Conta principal', 'checking'],
    ['Reserva', 'savings'],
    ['Cartão', 'credit_card'],
  ]) {
    await form.getByLabel('Nome').fill(name);
    await form.getByLabel('Tipo').selectOption(type);
    await save('Salvar conta');
  }
  await waitCount('finance_accounts', 3);
  await tab('Transações');
  const rule = page.getByRole('button', { name: 'Criar regra' }).locator('..');
  await rule.getByLabel('Padrão').fill('IFOOD');
  await rule.getByLabel('Categoria').selectOption('finance-food');
  await save('Criar regra');
  await waitCount('finance_rules', 1);
  const importPanel = page.getByRole('heading', { name: 'Importar OFX' }).locator('..');
  await importPanel.getByLabel('Conta').selectOption({ label: 'Conta principal' });
  const input = importPanel.locator('input[type=file]');
  await input.setInputFiles(resolve('tests/fixtures/finance-bank.ofx'));
  await page.getByRole('heading', { name: /Prévia/ }).waitFor();
  assert.match(await importPanel.innerText(), /3 transações · 3 novas/);
  await save('Importar confirmadas');
  await waitCount('finance_transactions', 3);
  const imported = await sql(
    "SELECT description,category_id,external_id FROM finance_transactions WHERE source='ofx' ORDER BY description",
  );
  assert.equal(
    imported.find((row) => row.description.startsWith('IFOOD')).category_id,
    'finance-food',
  );
  await input.setInputFiles([]);
  await input.setInputFiles(resolve('tests/fixtures/finance-bank.ofx'));
  await page.getByText('Este arquivo já foi importado.').waitFor();
  assert.equal((await sql('SELECT count(*) n FROM finance_transactions'))[0].n, 3);

  await tab('Planejamento');
  const plan = page.getByRole('heading', { name: 'Plano mensal' }).locator('..');
  await plan.getByLabel('Receita prevista').fill('5.000,00');
  await plan.getByLabel('Despesas previstas').fill('3.000,00');
  await plan.getByLabel('Aportes planejados').fill('500,00');
  await save('Salvar plano');
  assert.match(await page.locator('main').innerText(), /Disponível planejado: R\$\s*1\.500,00/);
  await tab('Objetivos');
  const goal = page.getByRole('heading', { name: 'Novo objetivo' }).locator('..');
  await goal.getByLabel('Nome').fill('Carro');
  await goal.getByLabel('Meta').fill('40.000,00');
  await goal.getByLabel('Aporte mensal planejado').fill('500,00');
  await save('Salvar objetivo');
  await page.getByRole('button', { name: 'Aportes' }).click();
  await page.getByLabel('Valor', { exact: true }).fill('500,00');
  await save('Registrar aporte');
  await waitCount('finance_goal_contributions', 1);
  await tab('Patrimônio');
  const asset = page.getByRole('heading', { name: 'Novo bem ou passivo' }).locator('..');
  await asset.getByLabel('Nome').fill('Carro de validação');
  await asset.getByLabel('Valor informado').fill('30.000,00');
  await save('Salvar avaliação');
  await waitCount('finance_assets', 1);
  await page.getByText('Patrimônio líquido', { exact: true }).waitFor();
  await tab('Visão geral');
  await save('Ocultar valores');
  await page.getByText('R$ •••••').first().waitFor();
  await save('Mostrar valores');
  await nav('Início');
  await page.getByRole('heading', { name: 'Finanças' }).waitFor();
  const result = {
    accounts: (await sql('SELECT count(*) n FROM finance_accounts'))[0].n,
    transactions: (await sql('SELECT count(*) n FROM finance_transactions'))[0].n,
    goals: (await sql('SELECT count(*) n FROM finance_goals'))[0].n,
    assets: (await sql('SELECT count(*) n FROM finance_assets'))[0].n,
  };
  await writeFile(join(output, 'seed.json'), JSON.stringify(result, null, 2));
  console.log('PHASE5_SEED_OK', result);
} else if (mode === 'resume') {
  assert.equal(
    (await sql('SELECT count(*) n FROM finance_accounts'))[0].n,
    3,
    'Expected seeded validation profile',
  );
  assert.equal((await sql('SELECT count(*) n FROM finance_assets'))[0].n, 1);
  await nav('Finanças');
  await tab('Transações');
  const form = page.getByRole('heading', { name: 'Nova transação' }).locator('..');
  await form.getByLabel('Tipo').selectOption('transfer');
  await form.getByLabel('Conta de origem').selectOption({ label: 'Conta principal' });
  await form.getByLabel('Conta de destino').selectOption({ label: 'Reserva' });
  await form.getByLabel('Descrição').fill('Aporte para reserva');
  await form.getByLabel('Valor em R$').fill('500,00');
  await save('Salvar transação');
  await waitCount('finance_transactions', 4);
  await form.getByLabel('Tipo').selectOption('expense');
  await form.getByLabel('Conta de origem').selectOption({ label: 'Cartão' });
  await form.getByLabel('Descrição').fill('Restaurante cartão');
  await form.getByLabel('Valor em R$').fill('100,00');
  await save('Salvar transação');
  await waitCount('finance_transactions', 5);
  await form.getByLabel('Tipo').selectOption('transfer');
  await form.getByLabel('Conta de origem').selectOption({ label: 'Conta principal' });
  await form.getByLabel('Conta de destino').selectOption({ label: 'Cartão' });
  await form.getByLabel('Descrição').fill('Pagamento cartão');
  await form.getByLabel('Valor em R$').fill('100,00');
  await save('Salvar transação');
  await waitCount('finance_transactions', 6);
  await tab('Planejamento');
  const budget = page
    .getByRole('heading', { name: 'Orçamento por categoria' })
    .locator('..')
    .locator('form');
  await budget.getByLabel('Categoria').selectOption('finance-food');
  await budget.getByLabel('Valor planejado').fill('600,00');
  await save('Salvar orçamento');
  const recurring = page
    .getByRole('heading', { name: 'Recorrências e assinaturas' })
    .locator('..')
    .locator('form');
  await recurring.getByLabel('Descrição').fill('Internet');
  await recurring.getByLabel('Valor').fill('109,90');
  await recurring.getByLabel('Dia do mês').fill('10');
  await recurring.getByRole('checkbox', { name: 'Assinatura' }).check();
  await save('Adicionar recorrência');
  assert.equal((await sql('SELECT count(*) n FROM finance_recurring'))[0].n, 1);
  assert.equal((await sql('SELECT count(*) n FROM finance_category_budgets'))[0].n, 1);
  await tab('Visão geral');
  await save('Ocultar valores');
  await page.getByText('R$ •••••').first().waitFor();
  await save('Mostrar valores');
  await nav('Início');
  await page.getByRole('heading', { name: 'Finanças' }).waitFor();
  const flow = await sql(
    'SELECT transaction_type,SUM(amount_cents) cents FROM finance_transactions GROUP BY transaction_type',
  );
  assert.equal(flow.find((row) => row.transaction_type === 'income').cents, 500000);
  assert.equal(flow.find((row) => row.transaction_type === 'expense').cents, 16280);
  assert.equal(flow.find((row) => row.transaction_type === 'transfer').cents, 60000);
  await writeFile(join(output, 'smoke-result.json'), JSON.stringify({ flow }, null, 2));
  console.log('PHASE5_RESUME_OK', flow);
} else if (mode === 'complete') {
  assert.equal((await sql('SELECT count(*) n FROM finance_transactions'))[0].n, 6);
  assert.equal((await sql('SELECT count(*) n FROM finance_recurring'))[0].n, 0);
  await nav('Finanças');
  await tab('Planejamento');
  const recurring = page
    .getByRole('heading', { name: 'Recorrências e assinaturas' })
    .locator('..')
    .locator('form');
  await recurring.getByLabel('Descrição').fill('Internet');
  await recurring.getByLabel('Valor').fill('109,90');
  await recurring.getByLabel('Dia do mês').fill('10');
  await recurring.getByRole('checkbox', { name: 'Assinatura' }).check();
  await save('Adicionar recorrência');
  assert.equal((await sql('SELECT count(*) n FROM finance_recurring'))[0].n, 1);
  await tab('Visão geral');
  await save('Ocultar valores');
  await page.getByText('R$ •••••').first().waitFor();
  await save('Mostrar valores');
  await nav('Início');
  await page.getByRole('heading', { name: 'Finanças' }).waitFor();
  console.log('PHASE5_COMPLETE_OK');
} else if (mode === 'audit') {
  const checks = [];
  for (const theme of ['Claro', 'Escuro']) {
    await page.locator('aside').getByRole('button', { name: 'Configurações' }).click();
    await page.getByRole('group', { name: 'Tema' }).getByRole('button', { name: theme }).click();
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      await nav('Finanças');
      for (const section of [
        'Visão geral',
        'Transações',
        'Planejamento',
        'Objetivos',
        'Patrimônio',
      ]) {
        await tab(section);
        if (section === 'Transações')
          await page.getByText('IFOOD *RESTAURANTE', { exact: false }).first().waitFor();
        if (section === 'Objetivos') await page.getByText('Carro', { exact: true }).waitFor();
        if (section === 'Patrimônio')
          await page.getByText('Carro de validação', { exact: false }).first().waitFor();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(overflow <= 1, `${theme} ${width}×${height} ${section}: ${overflow}px`);
        await page.screenshot({
          path: join(output, `audit-${theme}-${width}x${height}-${section}.png`),
          animations: 'disabled',
        });
        checks.push({ theme, width, height, section, overflow });
      }
      await nav('Início');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `${theme} ${width}×${height} Home: ${overflow}px`);
      checks.push({ theme, width, height, section: 'Home', overflow });
    }
  }
  await writeFile(join(output, 'visual-report.json'), JSON.stringify(checks, null, 2));
  console.log('PHASE5_VISUAL_OK', checks.length);
} else if (mode === 'snapshot') {
  const data = await snapshot();
  await writeFile(join(output, 'preclose.json'), JSON.stringify(data, null, 2));
  console.log(
    'PHASE5_SNAPSHOT_OK',
    Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])),
  );
} else if (mode === 'verify') {
  const previous = JSON.parse(await readFile(join(output, 'preclose.json'), 'utf8'));
  assert.deepEqual(await snapshot(), previous, 'Financial tables changed across restart');
  assert.equal(
    (await sql("SELECT description FROM finance_transactions WHERE external_id='SAL-001'"))[0]
      .description,
    'Salário',
  );
  await nav('Finanças');
  await page.getByRole('heading', { name: 'Finanças' }).waitFor();
  await tab('Objetivos');
  await page.getByText('Carro', { exact: true }).waitFor();
  await tab('Patrimônio');
  await page.getByText('Carro de validação', { exact: false }).first().waitFor();
  console.log('PHASE5_RESTART_OK');
} else if (mode === 'preview') {
  await nav('Finanças');
  await tab('Transações');
  const panel = page.getByRole('heading', { name: 'Importar OFX' }).locator('..');
  await panel.getByLabel('Conta').selectOption({ label: 'Conta principal' });
  const altered = Buffer.concat([
    await readFile(resolve('tests/fixtures/finance-bank.ofx')),
    Buffer.from('\n'),
  ]);
  await panel
    .locator('input[type=file]')
    .setInputFiles({ name: 'review.ofx', mimeType: 'application/x-ofx', buffer: altered });
  await page.getByRole('heading', { name: /Prévia/ }).waitFor();
  assert.match(await panel.innerText(), /2 duplicadas · 1 possíveis duplicatas/);
  await page.screenshot({
    path: join(output, 'ofx-preview.png'),
    animations: 'disabled',
    fullPage: true,
  });
  await page.getByLabel('Buscar').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'SELECT');
  console.log('PHASE5_PREVIEW_KEYBOARD_OK');
} else throw Error('Use seed, resume, audit, snapshot or verify');
await browser.close();
