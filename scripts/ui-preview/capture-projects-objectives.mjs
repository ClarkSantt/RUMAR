import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const output = 'artifacts/ui-projects-objectives';
await mkdir(output, { recursive: true });
const browserRoot = join(process.env.LOCALAPPDATA, 'ms-playwright');
const candidates = (await readdir(browserRoot))
  .filter((name) => name.startsWith('chromium_headless_shell-'))
  .sort()
  .reverse();
const executablePath = candidates
  .map((name) =>
    join(browserRoot, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
  )
  .find(existsSync);
if (!executablePath) throw new Error('Chromium headless local não encontrado.');
const browser = await chromium.launch({ headless: true, executablePath });
const titles = {
  projects: 'Projetos',
  'project-detail': 'Organizar o espaço de trabalho',
  objectives: 'Objetivos',
  'objective-detail': 'Ter mais energia no cotidiano',
};

for (const screen of Object.keys(titles)) {
  for (const [width, height] of [
    [900, 620],
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:4175/scripts/ui-preview/index.html?screen=${screen}`);
    await page.getByRole('heading', { name: titles[screen] }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/${screen}-light-${width}x${height}.png` });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/${screen}-dark-${width}x${height}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`${screen} ${width}x${height}: overflow ${overflow}px`);
    if (errors.length) throw new Error(`${screen} ${width}x${height}: ${errors.join('; ')}`);
    process.stdout.write(`${screen} ${width}x${height}: horizontal overflow ${overflow}px\n`);
    await page.close();
  }
}
await browser.close();
