import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const expectedIdentifier = 'com.rumo.validation.native.v180';
const expectedProductName = 'RUMO Smoke';
const expectedCredentialNamespace = 'RUMO-Smoke-v180';
const productionHash = 'D7D5256BF9785A3577C0025DB1F50992B5275990586EFB4F201D3CA657C401BB';
const directory = resolve(process.argv[2] ?? 'artifacts/native-smoke');
const independentlyExpectedHash = process.argv[3]?.toUpperCase();
assert.match(independentlyExpectedHash ?? '', /^[0-9A-F]{64}$/, 'Pass the SHA256 printed by CI');
const manifest = JSON.parse(await readFile(join(directory, 'native-smoke-build.json'), 'utf8'));
assert.equal(manifest.identifier, expectedIdentifier, 'Refusing a non-isolated Tauri build');
assert.equal(manifest.productName, expectedProductName);
assert.equal(manifest.credentialNamespace, expectedCredentialNamespace);
assert.equal(manifest.autostartName, 'RUMO Smoke Validation');
assert.match(manifest.commit, /^[0-9a-f]{40}$/i);
assert.equal(manifest.filename, 'RUMO-Smoke.exe');
const executable = join(directory, 'RUMO-Smoke.exe');
const bytes = await readFile(executable);
assert.equal((await stat(executable)).size, manifest.bytes);
const actualHash = createHash('sha256').update(bytes).digest('hex').toUpperCase();
assert.equal(
  actualHash,
  independentlyExpectedHash,
  'Executable differs from independently recorded CI hash',
);
assert.equal(actualHash, manifest.sha256);
assert.notEqual(actualHash, productionHash, 'Refusing the production executable');
const utf16 = (value) => Buffer.from(value, 'utf16le');
assert(
  bytes.includes(Buffer.from(expectedIdentifier)) || bytes.includes(utf16(expectedIdentifier)),
);
assert(
  !bytes.includes(Buffer.from('com.rumo.desktop')) && !bytes.includes(utf16('com.rumo.desktop')),
);
assert(
  bytes.includes(Buffer.from(expectedCredentialNamespace)) ||
    bytes.includes(utf16(expectedCredentialNamespace)),
);
const expectedConfig = JSON.parse(
  await readFile(resolve('src-tauri/validation.native.conf.json'), 'utf8'),
);
assert.equal(expectedConfig.identifier, expectedIdentifier);
assert.equal(expectedConfig.productName, expectedProductName);

const endpoint = 'http://127.0.0.1:9229';
try {
  await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(800) });
  throw new Error('CDP port 9229 is already occupied; refusing to attach to another app');
} catch (error) {
  if (error.message.includes('already occupied')) throw error;
}

let child;
let browser;
let launchError;
try {
  child = spawn(executable, [], {
    windowsHide: false,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9229',
    },
    stdio: 'ignore',
  });
  child.on('error', (error) => {
    launchError = error;
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Validation app exited: ${child.exitCode}`);
    try {
      browser = await chromium.connectOverCDP(endpoint, { timeout: 500 });
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  assert(browser, 'Validation WebView did not open within 15 seconds');
  const page = browser.contexts()[0]?.pages()[0];
  assert(page, 'Validation WebView has no page');
  await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__), undefined, {
    timeout: 10000,
  });
  const invoke = (command) =>
    page.evaluate((name) => window.__TAURI_INTERNALS__.invoke(name), command);
  assert.equal(await invoke('plugin:app|identifier'), expectedIdentifier);
  const info = await invoke('data_info');
  assert.match(
    info.databasePath.replaceAll('\\', '/'),
    /com\.rumo\.validation\.native\.v180\/rumo\.db$/,
  );
  assert.doesNotMatch(info.databasePath, /com\.rumo\.desktop/i);
  assert.match(
    info.automaticDirectory.replaceAll('\\', '/'),
    /com\.rumo\.validation\.native\.v180\/backups$/,
  );
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:sql|load', { db: 'sqlite:rumo.db' }),
  );
  const migrations = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {
      db: 'sqlite:rumo.db',
      query: 'SELECT MAX(version) AS version FROM _sqlx_migrations WHERE success=1',
      values: [],
    }),
  );
  assert.equal(migrations[0]?.version, 28, 'Smoke database did not migrate to current schema');
  assert.match(await invoke('check_integrity'), /integrity_check: ok/);
  console.log(
    'Native isolated preflight PASS: identity, database location, schema 28, integrity check',
  );
  void invoke('native_exit').catch(() => {});
  await new Promise((done) => {
    if (child.exitCode !== null) return done();
    child.once('exit', done);
    setTimeout(done, 5000);
  });
  assert.notEqual(child.exitCode, null, 'Native exit did not close the validation app');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child?.exitCode === null) child.kill();
}
