import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const output = 'artifacts/ui-advanced-hardening';
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
const report = [];
for (const [width, height] of [
  [900, 620],
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4175/scripts/ui-preview/index.html?screen=settings-data');
  await page.getByRole('heading', { name: 'Backup e dados' }).waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.waitForTimeout(100);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0)
      throw new Error(`settings ${theme} ${width}x${height}: overflow ${overflow}px`);
    const file = `${output}/settings-${theme}-${width}x${height}.png`;
    await page.screenshot({ path: file, animations: 'disabled', fullPage: true });
    report.push({ theme, resolution: `${width}x${height}`, overflow, file });
  }
  if (errors.length) throw new Error(`settings ${width}x${height}: ${errors.join('; ')}`);
  await page.close();
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(`ADVANCED_HARDENING_VISUAL_OK ${report.length}`);
