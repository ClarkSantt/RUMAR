// UI validation only: signed Edge + actual SQLite in a fresh temporary validation
// profile. The bridge below is NOT shipped or imported by the product. Native
// Tauri commands are not executed; native smoke/backup remain separate checks.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const root = resolve('artifacts/v150'),
  profile = join(root, `ui-${randomUUID()}`),
  token = randomUUID();
mkdirSync(profile, { recursive: true });
writeFileSync(
  join(profile, 'PROFILE.json'),
  JSON.stringify({ identifier: 'rumo.validation.v150.browser', native: false }),
);
const db = new DatabaseSync(join(profile, 'rumo.db'));
db.exec('PRAGMA foreign_keys=ON');
for (const name of readdirSync('src-tauri/migrations')
  .filter((n) => /^\d{4}_.*\.sql$/.test(n))
  .sort())
  db.exec(readFileSync(join('src-tauri/migrations', name), 'utf8'));
const at = new Date().toISOString(),
  day = at.slice(0, 10);
db.prepare("UPDATE settings SET value='Validação' WHERE key='name'").run();
db.prepare(
  "INSERT INTO objectives(id,name,start_date,created_at,updated_at) VALUES('validation-objective','Comprar carro',?,?,?)",
).run(day, at, at);
db.prepare(
  "INSERT INTO finance_goals(id,name,target_amount_cents,created_at,updated_at) VALUES('validation-goal','Carro',3000000,?,?)",
).run(at, at);
let browser, server;
const report = {
  profile,
  scope: 'Browser React UI + isolated real SQLite; native Tauri execution not validated',
  scenarios: [],
  visual: [],
  pageErrors: [],
};
try {
  server = await createServer({
    server: { host: '127.0.0.1', port: 1425, strictPort: true },
    configFile: resolve('vite.config.ts'),
  });
  server.middlewares.use(async (req, res, next) => {
    if (req.url === '/__validation_sql') {
      if (req.method !== 'POST' || req.headers['x-validation-token'] !== token) {
        res.statusCode = 403;
        res.end();
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2e6) {
          res.statusCode = 413;
          res.end();
          return;
        }
      }
      try {
        const { cmd, args } = JSON.parse(body);
        let result;
        if (cmd === 'plugin:sql|load') {
          assert.equal(args.db, 'sqlite:rumo.db');
          result = 'sqlite:rumo.db';
        } else if (cmd === 'plugin:sql|select' || cmd === 'plugin:sql|execute') {
          assert.equal(args.db, 'sqlite:rumo.db');
          const statement = db.prepare(args.query),
            bindings = Object.fromEntries((args.values ?? []).map((v, i) => [`$${i + 1}`, v]));
          if (cmd.endsWith('select')) result = statement.all(bindings);
          else {
            const r = statement.run(bindings);
            result = [Number(r.changes), Number(r.lastInsertRowid)];
          }
        } else if (cmd === 'plugin:sql|close') result = true;
        else if (cmd === 'data_info')
          result = {
            databasePath: join(profile, 'rumo.db'),
            appVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
          };
        else if (cmd === 'automatic_backup') result = null;
        else if (cmd === 'plugin:notification|is_permission_granted') result = false;
        else if (cmd === 'plugin:event|listen') result = 1;
        else if (cmd === 'plugin:event|unlisten') result = null;
        else throw Error(`Native command not supported in browser harness: ${cmd}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ result }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.url === '/__validation.html') {
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, html));
      return;
    }
    next();
  });
  // Handle validation RPC before Vite's final 404 middleware.
  const validationMiddleware = server.middlewares.stack.pop();
  server.middlewares.stack.unshift(validationMiddleware);
  await server.listen();
  browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      reducedMotion: 'reduce',
    }),
    page = await context.newPage();
  await context.addInitScript(
    ({ token }) => {
      let callback = 0;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => ++callback,
        invoke: async (cmd, args = {}) => {
          const response = await fetch('/__validation_sql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Validation-Token': token },
            body: JSON.stringify({ cmd, args }),
          });
          const raw = await response.text();
          if (!response.ok)
            throw Error('Harness HTTP ' + response.status + ': ' + raw.slice(0, 100));
          const data = JSON.parse(raw);
          if (data.error) throw Error(data.error);
          return data.result;
        },
      };
    },
    { token },
  );
  page.on('pageerror', (e) => report.pageErrors.push(e.message));
  const open = async () => {
    await page.goto('http://127.0.0.1:1425/__validation.html');
    await page.getByRole('button', { name: 'Configurações', exact: true }).waitFor();
  };
  const nav = async (name) => {
    await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
  };
  await open();
  const startup = await page.evaluate(async () => {
    try {
      const { getDatabase } = await import('/src/lib/database/connection.ts');
      const { Repository } = await import('/src/services/repository.ts');
      await new Repository(await getDatabase()).snapshot();
      return 'ok';
    } catch (e) {
      return e.stack;
    }
  });
  assert.equal(startup, 'ok', startup);
  await nav('Configurações');
  await page.getByRole('button', { name: '+ Nova automação', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome', { exact: true }).fill('Revisão semanal');
  await dialog.getByLabel('Título', { exact: true }).fill('Fazer revisão semanal');
  await dialog.getByRole('button', { name: 'Salvar regra', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(db.prepare('SELECT count(*) n FROM automation_rules').get().n, 1);
  report.scenarios.push('Automation builder creates a valid weekly task rule');
  await nav('Objetivos');
  await page
    .getByRole('button', { name: /Comprar carro/ })
    .first()
    .click();
  await page.getByRole('button', { name: '+ Novo marco', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Título', { exact: true }).fill('R$ 10.000');
  await dialog.getByLabel('Conclusão', { exact: true }).selectOption('financial_goal');
  await dialog.getByLabel('Meta financeira', { exact: true }).selectOption('validation-goal');
  await dialog.getByLabel('Valor alvo em reais', { exact: true }).fill('10.000');
  await dialog.getByRole('button', { name: 'Salvar marco', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(
    db.prepare('SELECT target_value FROM objective_milestones').get().target_value,
    10000,
  );
  db.prepare(
    "INSERT INTO finance_goal_contributions(id,goal_id,date,amount_cents,created_at) VALUES('validation-contribution','validation-goal',?,1000000,?)",
  ).run(day, at);
  await nav('Início');
  await nav('Objetivos');
  await page
    .getByRole('button', { name: /Comprar carro/ })
    .first()
    .click();
  await page
    .getByText('1 de 1 concluídos. O objetivo permanece sob seu controle.', { exact: true })
    .waitFor();
  report.scenarios.push(
    'Financial milestone respects pt-BR thousands and derives completion from contribution',
  );
  await nav('Calendário');
  await page.getByRole('button', { name: 'Novo bloco', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Título', { exact: true }).fill('Estudar');
  await dialog.getByLabel('Início', { exact: true }).fill('19:00');
  await dialog.getByLabel('Fim', { exact: true }).fill('20:00');
  await dialog.getByRole('combobox', { name: 'Frequência', exact: true }).selectOption('weekly');
  await dialog.getByLabel('Seg', { exact: true }).check();
  await dialog.getByLabel('Qua', { exact: true }).check();
  await dialog.getByLabel('Sex', { exact: true }).check();
  await dialog.getByRole('button', { name: /Salvar/ }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(db.prepare('SELECT count(*) n FROM planner_time_block_series').get().n, 1);
  report.scenarios.push(
    'Recurring block editor persists Seg/Qua/Sex without future materialization',
  );
  await page.getByRole('button', { name: 'Semana', exact: true }).click();
  await page
    .getByRole('button', { name: /^Estudar, 19:00/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Editar horário', exact: true }).click();
  await page.getByRole('button', { name: 'Somente este bloco', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Editar bloco', exact: true });
  await dialog.getByLabel('Fim', { exact: true }).fill('20:30');
  await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
  await page.keyboard.press('Shift+Tab');
  await dialog.getByRole('button', { name: 'Salvar bloco', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(db.prepare('SELECT count(*) n FROM planner_time_block_exceptions').get().n, 1);
  report.scenarios.push(
    'Occurrence edit changes only one block; Tab/Shift+Tab stay inside the editor',
  );
  // Domain execution uses the actual repository against the SAME isolated DB.
  const { AutomationsRepository } = await server.ssrLoadModule(
    '/src/features/automations/repository.ts',
  );
  const bindings = (values) => Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v]));
  const connection = {
    select: async (q, v = []) => db.prepare(q).all(bindings(v)),
    execute: async (q, v = []) => ({
      rowsAffected: Number(db.prepare(q).run(bindings(v)).changes),
    }),
  };
  const repo = new AutomationsRepository(connection),
    rule = (await repo.list())[0];
  await repo.save(
    { ...rule, trigger_config: { mode: 'daily', time: '00:00' }, missed_policy: 'latest' },
    rule.id,
    new Date('2026-09-01T00:00:00Z'),
  );
  const executionTime = new Date();
  executionTime.setDate(executionTime.getDate() + 1);
  executionTime.setHours(0, 1, 0, 0);
  await repo.process(executionTime);
  await repo.process(executionTime);
  assert.equal(
    db.prepare("SELECT count(*) n FROM tasks WHERE title='Fazer revisão semanal'").get().n,
    1,
  );
  await repo.enable(rule.id, false);
  executionTime.setDate(executionTime.getDate() + 1);
  await repo.process(executionTime);
  assert.equal(
    db.prepare("SELECT count(*) n FROM tasks WHERE title='Fazer revisão semanal'").get().n,
    1,
  );
  report.scenarios.push('Automation occurrence processed once; disabled rule does not execute');
  await nav('Início');
  await page.getByRole('button', { name: /REVISÃO SEMANAL/ }).click();
  await page.getByRole('button', { name: 'Revisão mensal', exact: true }).click();
  await page.getByRole('heading', { name: 'Revisão Mensal', exact: true }).waitFor();
  const note = page.getByRole('textbox', { name: 'Reflexão pessoal opcional', exact: true });
  await note.fill('Reflexão do perfil de validação.');
  await page.getByRole('button', { name: /Salvar nota/ }).click();
  await page.getByText('Nota salva.', { exact: true }).waitFor();
  report.scenarios.push('Monthly review displays registered sources and saves the monthly note');
  const counts = () =>
    Object.fromEntries(
      [
        'automation_rules',
        'automation_executions',
        'planner_time_block_series',
        'planner_time_block_exceptions',
        'objective_milestones',
        'monthly_review_notes',
        'tasks',
      ].map((t) => [t, db.prepare(`SELECT count(*) n FROM ${t}`).get().n]),
    );
  const before = counts();
  await open();
  assert.deepEqual(counts(), before);
  report.scenarios.push(
    'Browser reopening preserves all validation records (not a native restart)',
  );
  async function shot(name, view) {
    await view();
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `Horizontal overflow ${name}`,
    );
    await page.screenshot({ path: join(profile, `${name}.png`) });
    report.visual.push(name);
  }
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(size);
      db.prepare("UPDATE settings SET value=? WHERE key='theme'").run(theme);
      await open();
      const suffix = `${size.width}-${theme}`;
      await shot(`automation-list-${suffix}`, async () => {
        await nav('Configurações');
        await page.getByRole('heading', { name: 'Automações locais' }).waitFor();
      });
      await shot(`automation-builder-${suffix}`, async () => {
        await page.getByRole('button', { name: '+ Nova automação', exact: true }).click();
      });
      await page.keyboard.press('Escape');
      await shot(`automation-log-${suffix}`, async () => {
        await page.getByRole('button', { name: 'Histórico', exact: true }).click();
      });
      await page.keyboard.press('Escape');
      await shot(`milestones-${suffix}`, async () => {
        await nav('Objetivos');
        await page
          .getByRole('button', { name: /Comprar carro/ })
          .first()
          .click();
        await page
          .getByText('1 de 1 concluídos. O objetivo permanece sob seu controle.', { exact: true })
          .waitFor();
      });
      await shot(`recurrence-editor-${suffix}`, async () => {
        await nav('Calendário');
        await page.getByRole('button', { name: 'Novo bloco', exact: true }).click();
        await page
          .getByRole('combobox', { name: 'Frequência', exact: true })
          .selectOption('weekly');
      });
      await page.keyboard.press('Escape');
      await shot(`day-planner-${suffix}`, async () => {
        await page.getByRole('button', { name: 'Dia', exact: true }).click();
      });
      await shot(`week-planner-${suffix}`, async () => {
        await page.getByRole('button', { name: 'Semana', exact: true }).click();
      });
      await shot(`occurrence-scope-${suffix}`, async () => {
        await page
          .getByRole('button', { name: /^Estudar, 19:00/ })
          .first()
          .click();
        await page.getByRole('button', { name: 'Editar horário', exact: true }).click();
        await page.getByRole('dialog', { name: 'Editar bloco recorrente', exact: true }).waitFor();
      });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await shot(`monthly-review-${suffix}`, async () => {
        await nav('Início');
        await page.getByRole('button', { name: /REVISÃO SEMANAL/ }).click();
        await page.getByRole('button', { name: 'Revisão mensal', exact: true }).click();
        await page.getByRole('heading', { name: 'Revisão Mensal' }).waitFor();
      });
    }
  assert.deepEqual(report.pageErrors, []);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  writeFileSync(join(profile, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      profile,
      scenarios: report.scenarios.length,
      visualCombinations: report.visual.length,
      native: false,
    }),
  );
} finally {
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage) {
    writeFileSync(join(profile, 'last-page.txt'), await failedPage.locator('body').innerText());
    writeFileSync(join(profile, 'last-aria.txt'), await failedPage.locator('body').ariaSnapshot());
    await failedPage.screenshot({ path: join(profile, 'last-page.png') });
  }
  await browser?.close();
  await server?.close();
  db.close();
  writeFileSync(join(profile, 'report.json'), JSON.stringify(report, null, 2));
}
