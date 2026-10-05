import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const output = 'artifacts/ui-nutrition-finance';
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
const browser = await chromium.launch({ headless: true, executablePath });

const allScreens = [
  'nutrition-today',
  'nutrition-diet',
  'nutrition-foods',
  'finance-overview',
  'finance-transactions',
  'finance-planning',
  'finance-connections',
  'finance-connection-preview',
  'finance-connection-confirmation',
];
const selectedScreens = process.argv.slice(2);
const screens = selectedScreens.length
  ? allScreens.filter((screen) => selectedScreens.includes(screen))
  : allScreens;
if (screens.length !== (selectedScreens.length || allScreens.length)) {
  throw new Error('Tela de preview desconhecida.');
}
for (const screen of screens) {
  const sizes = ['nutrition-today', 'finance-overview', 'finance-connections'].includes(screen)
    ? [
        [900, 620],
        [1280, 720],
        [1366, 768],
        [1440, 900],
        [1920, 1080],
        [2560, 1440],
      ]
    : [
        [1366, 768],
        [1920, 1080],
      ];
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:4175/scripts/ui-preview/index.html?screen=${screen}`);
    await page
      .getByRole('heading', { name: screen.startsWith('nutrition-') ? 'Alimentação' : 'Finanças' })
      .first()
      .waitFor();
    await page.waitForTimeout(160);
    if (screen === 'finance-connection-confirmation') {
      await page.getByRole('dialog', { name: 'Confirmar importação' }).waitFor();
    }
    const capture = width === 1366 || width === 1920;
    if (capture)
      await page.screenshot({
        path: `${output}/${screen}-light-${width}x${height}.png`,
        fullPage: screen.startsWith('finance-connection'),
      });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await page.waitForTimeout(160);
    if (capture)
      await page.screenshot({
        path: `${output}/${screen}-dark-${width}x${height}.png`,
        fullPage: screen.startsWith('finance-connection'),
      });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`${screen} ${width}x${height}: overflow ${overflow}px`);
    if (errors.length) throw new Error(`${screen} ${width}x${height}: ${errors.join('; ')}`);
    process.stdout.write(`${screen} ${width}x${height}: overflow ${overflow}px\n`);
    await page.close();
  }
}
await browser.close();
