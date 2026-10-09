import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const output = 'artifacts/ui-phase3-validation';
await mkdir(output, { recursive: true });
const browserRoot = join(process.env.LOCALAPPDATA, 'ms-playwright');
const executablePath = (await readdir(browserRoot))
  .filter((name) => name.startsWith('chromium_headless_shell-'))
  .sort()
  .reverse()
  .map((name) =>
    join(browserRoot, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
  )
  .find(existsSync);
if (!executablePath) throw new Error('Chromium headless local não encontrado.');

const allScreens = [
  'inbox',
  'focus-phase3',
  'global-search',
  'workout-history',
  'body-progress',
  'nutrition-meals',
  'finance-overview',
];
const selectedScreens = process.argv.slice(2);
const screens = selectedScreens.length
  ? allScreens.filter((screen) => selectedScreens.includes(screen))
  : allScreens;
if (screens.length !== (selectedScreens.length || allScreens.length))
  throw new Error('Tela de preview desconhecida.');
const sizes = [
  [900, 620],
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
];
const browser = await chromium.launch({ headless: true, executablePath });
for (const screen of screens)
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:4175/scripts/ui-preview/index.html?screen=${screen}`);
    if (screen === 'global-search') {
      const input = page.getByRole('combobox', { name: 'Buscar no RUMAR' });
      await input.waitFor();
      await input.fill('nova tarefa estudar SQL amanhã 14h');
      await page.getByText(/Criar Task: estudar SQL/i).waitFor();
    } else if (screen === 'focus-phase3') {
      await page.getByRole('heading', { name: 'Modo Focus' }).waitFor();
    } else {
      await page
        .getByRole('heading', {
          name:
            screen === 'inbox'
              ? 'Inbox'
              : screen === 'body-progress'
                ? 'Progresso corporal'
                : screen === 'nutrition-meals'
                  ? 'Alimentação'
                  : screen === 'finance-overview'
                    ? 'Finanças'
                    : 'Treinos',
        })
        .first()
        .waitFor();
    }
    await page.waitForTimeout(220);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.waitForTimeout(100);
      await page.screenshot({
        path: `${output}/${screen}-${theme}-${width}x${height}.png`,
        animations: 'disabled',
      });
    }
    if (screen === 'finance-overview') {
      await page.getByRole('button', { name: 'Ocultar valores' }).click();
      await page.getByText(/Valores e padrões estão ocultos/).waitFor();
    }
    const layout = await page.evaluate(() => {
      const dialog = document.querySelector('dialog');
      const rect = dialog?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        dialogClipped: Boolean(
          rect &&
          (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight),
        ),
      };
    });
    if (layout.overflow > 0)
      throw new Error(`${screen} ${width}x${height}: overflow ${layout.overflow}px`);
    if (layout.dialogClipped)
      throw new Error(`${screen} ${width}x${height}: dialog fora da viewport`);
    if (errors.length) throw new Error(`${screen} ${width}x${height}: ${errors.join('; ')}`);
    process.stdout.write(
      `${screen} ${width}x${height}: overflow ${layout.overflow}px, dialog clipped ${layout.dialogClipped}\n`,
    );
    await page.close();
  }
await browser.close();
