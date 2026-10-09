import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const output = 'artifacts/ui-phase2-validation';
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
for (const screen of ['home', 'timeline', 'reviews', 'planning-today'])
  for (const [width, height] of [
    [900, 620],
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:4175/scripts/ui-preview/index.html?screen=${screen}`);
    await page
      .getByRole('heading', {
        name:
          screen === 'home'
            ? /Bom dia/
            : screen === 'reviews'
              ? 'Revisão semanal'
              : screen === 'planning-today'
                ? 'Planejamento'
                : 'Timeline',
      })
      .waitFor();
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
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`${screen} ${width}x${height}: overflow ${overflow}px`);
    if (errors.length) throw new Error(`${screen}: ${errors.join('; ')}`);
    process.stdout.write(`${screen} ${width}x${height}: horizontal overflow ${overflow}px\n`);
    await page.close();
  }
await browser.close();
