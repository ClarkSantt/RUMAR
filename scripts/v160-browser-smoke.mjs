// Browser-only UI audit. The local SQL bridge uses a fresh validation profile;
// native attachment, backup and export commands are not emulated or claimed.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve('artifacts/v160');
const profile = join(root, `ui-${randomUUID()}`);
const token = randomUUID();
mkdirSync(profile, { recursive: true });
writeFileSync(
  join(profile, 'PROFILE.json'),
  JSON.stringify({ identifier: 'rumo.validation.v160.browser', native: false }),
);
const db = new DatabaseSync(join(profile, 'rumo.db'));
db.exec('PRAGMA foreign_keys=ON');
for (const name of readdirSync('src-tauri/migrations')
  .filter((value) => /^\d{4}_.*\.sql$/.test(value))
  .sort())
  db.exec(readFileSync(join('src-tauri/migrations', name), 'utf8'));
const stamp = new Date().toISOString();
db.prepare(
  'INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)',
).run('validation-account', 'Conta de validação', 'checking', stamp, stamp);
db.prepare("UPDATE settings SET value='Validação' WHERE key='name'").run();

let server, browser;
const report = {
  profile,
  scope: 'React UI + isolated SQLite, no native Tauri commands',
  visual: [],
  scenarios: [],
  pageErrors: [],
};
try {
  server = await createServer({
    server: { host: '127.0.0.1', port: 1426, strictPort: true },
    configFile: resolve('vite.config.ts'),
  });
  server.middlewares.use(async (req, res, next) => {
    if (req.url === '/__validation_rpc') {
      if (req.method !== 'POST' || req.headers['x-validation-token'] !== token) {
        res.statusCode = 403;
        res.end();
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2_000_000) {
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
          const statement = db.prepare(args.query);
          const bindings = Object.fromEntries(
            (args.values ?? []).map((value, index) => [`$${index + 1}`, value]),
          );
          result = cmd.endsWith('select')
            ? statement.all(bindings)
            : (() => {
                const run = statement.run(bindings);
                return [Number(run.changes), Number(run.lastInsertRowid)];
              })();
        } else if (cmd === 'plugin:sql|close') result = true;
        else if (cmd === 'data_info')
          result = { databasePath: join(profile, 'rumo.db'), appVersion: '1.6.0' };
        else if (cmd === 'attachment_stats')
          result = { database_bytes: 0, attachment_bytes: 0, attachment_count: 0, backup_bytes: 0 };
        else if (cmd === 'automatic_backup') result = null;
        else if (cmd === 'attachment_cleanup') result = null;
        else if (cmd === 'plugin:notification|is_permission_granted') result = false;
        else if (cmd === 'plugin:event|listen') result = 1;
        else if (cmd === 'plugin:event|unlisten') result = null;
        else throw Error(`Native command unsupported in UI audit: ${cmd}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ result }));
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }
    if (req.url === '/__validation.html') {
      const html =
        '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, html));
      return;
    }
    next();
  });
  const middleware = server.middlewares.stack.pop();
  server.middlewares.stack.unshift(middleware);
  await server.listen();
  browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await context.addInitScript(
    ({ token }) => {
      let callback = 0;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => ++callback,
        invoke: async (cmd, args = {}) => {
          const response = await fetch('/__validation_rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Validation-Token': token },
            body: JSON.stringify({ cmd, args }),
          });
          const raw = await response.text();
          if (!response.ok) throw Error(`Harness HTTP ${response.status}: ${raw.slice(0, 120)}`);
          return JSON.parse(raw).result;
        },
      };
    },
    { token },
  );
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.goto('http://127.0.0.1:1426/__validation.html');
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Configurações', exact: true })
    .click();
  await page.getByRole('heading', { name: 'Dados', exact: true }).waitFor();
  await page.getByText('Total estimado:').waitFor();
  report.scenarios.push('Data Center opens with lightweight storage summary');
  await page.locator('.data-center .name-field select').first().selectOption('full_json');
  assert.equal(
    await page.locator('.data-center .name-field input[type=date]').first().isDisabled(),
    true,
  );
  await page.locator('.data-center .name-field select').first().selectOption('finance');
  await page.locator('.data-import select').first().selectOption('finance_csv');
  await page.locator('.data-import input[type=file]').setInputFiles({
    name: 'finance.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'data;descrição;valor\n01/10/2026;Mercado;83,40\n31/02/2026;Inválida;10,00',
    ),
  });
  await page.getByText('1 válidos, 1 com problema').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Confirmar importação' }).isDisabled(), true);
  report.scenarios.push(
    'Finance CSV preview counts valid/invalid rows and blocks unconfirmed partial import',
  );
  for (const theme of ['Claro', 'Escuro']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [2560, 1440],
    ]) {
      await page.setViewportSize({ width, height });
      await page.getByRole('heading', { name: 'Dados', exact: true }).scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${theme} ${width}: overflow horizontal`);
      await page.screenshot({
        path: join(profile, `${theme}-${width}.png`),
        animations: 'disabled',
      });
      await page.locator('.data-import-preview').scrollIntoViewIfNeeded();
      const previewOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert.equal(previewOverflow, false, `${theme} ${width}: preview overflow horizontal`);
      await page.screenshot({
        path: join(profile, `${theme}-${width}-preview.png`),
        animations: 'disabled',
      });
      report.visual.push({ theme, width, height, overflow, previewOverflow });
    }
  }
  await page.getByLabel('Conta de destino').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'SELECT');
  report.scenarios.push('Keyboard Tab advances through import mapping controls');
  assert.deepEqual(report.pageErrors, []);
  writeFileSync(join(profile, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  db.close();
}
