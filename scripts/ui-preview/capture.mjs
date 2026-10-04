import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const output = 'artifacts/ui-phase1';
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
const browser = await chromium.launch({
  headless: true,
  executablePath,
});
for (const [width, height] of [
  [900, 620],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4175/scripts/ui-preview/index.html');
  await page.screenshot({ path: `${output}/home-light-${width}x${height}.png` });
  if (width === 1366 || width === 1920) {
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/home-dark-${width}x${height}.png` });
    await page.getByRole('button', { name: 'Recolher barra lateral' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/sidebar-collapsed-${width}x${height}.png` });
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (overflow > 0) throw new Error(`Overflow horizontal: ${width}x${height} = ${overflow}px`);
  process.stdout.write(`${width}x${height}: horizontal overflow ${overflow}px\n`);
  await page.close();
}
await browser.close();
