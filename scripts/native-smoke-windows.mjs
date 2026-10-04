import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.argv[2] ?? 'artifacts/native-smoke');
const expectedHash = process.argv[3]?.toUpperCase();
assert.match(expectedHash ?? '', /^[0-9A-F]{64}$/);
execFileSync(process.execPath, ['scripts/native-smoke-preflight.mjs', directory, expectedHash], {
  stdio: 'inherit',
});
const executable = join(directory, 'RUMO-Smoke.exe');
const hash = () =>
  readFile(executable).then((bytes) =>
    createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  );
assert.equal(await hash(), expectedHash);

async function launch(args = []) {
  assert.equal(await hash(), expectedHash);
  const endpoint = 'http://127.0.0.1:9232';
  try {
    await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(800) });
    throw new Error('CDP port 9232 occupied');
  } catch (error) {
    if (error.message.includes('occupied')) throw error;
  }
  const child = spawn(executable, args, {
    windowsHide: false,
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9232' },
  });
  let launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  let browser;
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Smoke app exited: ${child.exitCode}`);
      try {
        browser = await chromium.connectOverCDP(endpoint, { timeout: 500 });
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 250));
      }
    }
    assert(browser, 'Smoke WebView did not open');
    const page = browser.contexts()[0]?.pages()[0];
    assert(page);
    await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__), undefined, {
      timeout: 10000,
    });
    const invoke = (command, params = {}) =>
      page.evaluate(({ command, params }) => window.__TAURI_INTERNALS__.invoke(command, params), {
        command,
        params,
      });
    assert.equal(await invoke('plugin:app|identifier'), 'com.rumo.validation.native.v180');
    const info = await invoke('data_info');
    assert.match(
      info.databasePath.replaceAll('\\', '/'),
      /com\.rumo\.validation\.native\.v180\/rumo\.db$/,
    );
    await invoke('plugin:sql|load', { db: 'sqlite:rumo.db' });
    return { child, browser, page, invoke };
  } catch (error) {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill();
    throw error;
  }
}

async function quit(app) {
  try {
    void app.invoke('native_exit').catch(() => {});
    await new Promise((done) => {
      if (app.child.exitCode !== null) return done();
      app.child.once('exit', done);
      setTimeout(done, 5000);
    });
    assert.notEqual(app.child.exitCode, null);
  } finally {
    await app.browser.close().catch(() => {});
    if (app.child.exitCode === null) app.child.kill();
  }
}

let app = await launch();
const sql = (query, values = []) =>
  app.invoke('plugin:sql|execute', { db: 'sqlite:rumo.db', query, values });
const select = (query, values = []) =>
  app.invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values });
async function waitFocusStatus(expected) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const [row] = await select(
      "SELECT status FROM focus_sessions WHERE title='Smoke Focus' ORDER BY created_at DESC LIMIT 1",
    );
    if (row?.status === expected) return;
    await app.page.waitForTimeout(100);
  }
  assert.fail(`Focus did not reach ${expected}`);
}
async function setting(key, value) {
  await sql(
    `INSERT INTO settings(key,value,updated_at) VALUES($1,$2,$3)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    [key, value, new Date().toISOString()],
  );
  await app.page.evaluate(() => window.dispatchEvent(new Event('rumo-windows-settings-changed')));
}
function sendNativeKeys(keys) {
  assert.equal(app.child.exitCode, null);
  assert.match(String(app.child.pid), /^\d+$/);
  const command = `$shell = New-Object -ComObject WScript.Shell; if (-not $shell.AppActivate(${app.child.pid})) { throw 'Smoke window not active' }; Start-Sleep -Milliseconds 300; $shell.SendKeys('${keys}')`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'pipe' });
}
let autostartWasEnabled = false;
try {
  const second = spawn(executable, [], { stdio: 'ignore', windowsHide: true });
  await new Promise((done) => {
    if (second.exitCode !== null) return done();
    second.once('exit', done);
    setTimeout(done, 5000);
  });
  if (second.exitCode === null) second.kill();
  assert.equal(second.exitCode, 0, 'Second smoke instance should exit without opening a new app');
  assert.equal(app.child.exitCode, null);
  console.log('Single instance PASS');

  await setting('windows_global_shortcut', 'Control+Alt+R');
  await app.page.waitForTimeout(1500);
  sendNativeKeys('^%r');
  const quick = app.page.getByRole('dialog', { name: 'Adicionar ao RUMO' });
  await quick.waitFor({ timeout: 5000 });
  await app.page.keyboard.press('Escape');
  console.log('Global Quick Add hotkey with native Windows input PASS');

  const [unfinishedFocus] = await select(
    "SELECT id FROM focus_sessions WHERE title='Smoke Focus' AND status IN('running','paused') LIMIT 1",
  );
  if (unfinishedFocus) {
    const recovery = app.page.getByRole('dialog', { name: 'Retomar sessão de foco' });
    await recovery.waitFor();
    await recovery.getByRole('button', { name: 'Finalizar foco' }).click();
    await waitFocusStatus('completed');
  }

  await app.page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('rumo-focus-start', { detail: { title: 'Smoke Focus' } })),
  );
  const focus = app.page.getByRole('dialog', { name: 'Modo Focus' });
  await focus.waitFor();
  await app.invoke('plugin:event|emit', { event: 'rumo-tray-command', payload: 'focus-pause' });
  await waitFocusStatus('paused');
  await app.invoke('plugin:event|emit', { event: 'rumo-tray-command', payload: 'focus-resume' });
  await waitFocusStatus('running');
  await app.invoke('plugin:event|emit', { event: 'rumo-tray-command', payload: 'focus-finish' });
  await waitFocusStatus('completed');
  console.log(
    'Focus tray-command bridge and SQLite persistence PASS; tray menu click not verified',
  );

  const notification = await app.page.evaluate(() => {
    if (window.Notification.permission !== 'granted') return 'permission-not-granted';
    new window.Notification('RUMO Smoke', { body: 'Notificação fictícia de validação' });
    return 'api-called';
  });
  console.log(`Notification ${notification}; visual toast not automatically verified`);

  assert.equal(
    await app.invoke('plugin:autostart|is_enabled'),
    false,
    'Smoke autostart already active',
  );
  await app.invoke('plugin:autostart|enable');
  autostartWasEnabled = true;
  assert.equal(await app.invoke('plugin:autostart|is_enabled'), true);
  await setting('windows_start_minimized', '1');
  await app.invoke('plugin:autostart|disable');
  autostartWasEnabled = false;
  assert.equal(await app.invoke('plugin:autostart|is_enabled'), false);
  console.log('Autostart enable/disable and cleanup PASS');

  await quit(app);
  app = await launch(['--rumo-autostart']);
  assert.equal(await app.invoke('plugin:window|is_visible', { label: 'main' }), false);
  await app.invoke('plugin:window|show', { label: 'main' });
  assert.equal(await app.invoke('plugin:window|is_visible', { label: 'main' }), true);
  console.log('Start minimized and restore-by-window API PASS; tray icon click not verified');

  await setting('windows_close_behavior', 'tray');
  await setting('windows_tray_notice_shown', '1');
  await app.invoke('plugin:window|set_focus', { label: 'main' });
  sendNativeKeys('%{F4}');
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!(await app.invoke('plugin:window|is_visible', { label: 'main' }))) break;
    await app.page.waitForTimeout(100);
  }
  assert.equal(app.child.exitCode, null);
  assert.equal(await app.invoke('plugin:window|is_visible', { label: 'main' }), false);
  await app.invoke('plugin:window|show', { label: 'main' });
  assert.equal(await app.invoke('plugin:window|is_visible', { label: 'main' }), true);
  console.log('Close-to-tray and restore-by-window API PASS; tray menu click not verified');
} finally {
  if (app.child.exitCode === null) {
    await setting('windows_global_shortcut', '').catch(() => {});
    await setting('windows_start_minimized', '0').catch(() => {});
    await setting('windows_close_behavior', 'exit').catch(() => {});
    if (autostartWasEnabled) await app.invoke('plugin:autostart|disable').catch(() => {});
    await quit(app).catch(() => {});
  }
}
