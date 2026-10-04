import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const identifier = 'com.rumo.validation.native.v180';
const directory = resolve(process.argv[2] ?? 'artifacts/native-smoke');
const expectedHash = process.argv[3]?.toUpperCase();
assert.match(expectedHash ?? '', /^[0-9A-F]{64}$/);
execFileSync(process.execPath, ['scripts/native-smoke-preflight.mjs', directory, expectedHash], {
  stdio: 'inherit',
});
const executable = join(directory, 'RUMO-Smoke.exe');
const fingerprint = () =>
  readFile(executable).then((bytes) =>
    createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  );
assert.equal(await fingerprint(), expectedHash);
const artifactManifest = JSON.parse(
  await readFile(join(directory, 'native-smoke-build.json'), 'utf8'),
);

function png() {
  const crc = (buffer) => {
    let value = 0xffffffff;
    for (const byte of buffer) {
      value ^= byte;
      for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, content) => {
    const tag = Buffer.from(type);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(content.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(Buffer.concat([tag, content])));
    return Buffer.concat([size, tag, content, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 32, 96, 192, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}

async function open() {
  assert.equal(await fingerprint(), expectedHash, 'Smoke executable changed after preflight');
  const endpoint = 'http://127.0.0.1:9231';
  try {
    await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(800) });
    throw new Error('CDP port 9231 occupied');
  } catch (error) {
    if (error.message.includes('occupied')) throw error;
  }
  const child = spawn(executable, [], {
    windowsHide: false,
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9231' },
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
    assert(page, 'Smoke WebView page missing');
    await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__), undefined, {
      timeout: 10000,
    });
    const invoke = (command, args = {}) =>
      page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
        command,
        args,
      });
    assert.equal(await invoke('plugin:app|identifier'), identifier);
    const info = await invoke('data_info');
    assert.match(
      info.databasePath.replaceAll('\\', '/'),
      /com\.rumo\.validation\.native\.v180\/rumo\.db$/,
    );
    assert.doesNotMatch(info.databasePath, /com\.rumo\.desktop/i);
    await invoke('plugin:sql|load', { db: 'sqlite:rumo.db' });
    return { child, browser, page, invoke, info };
  } catch (error) {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill();
    throw error;
  }
}

async function close(app) {
  try {
    void app.invoke('native_exit').catch(() => {});
    await new Promise((done) => {
      if (app.child.exitCode !== null) return done();
      app.child.once('exit', done);
      setTimeout(done, 5000);
    });
    assert.notEqual(app.child.exitCode, null, 'Smoke app did not exit');
  } finally {
    await app.browser.close().catch(() => {});
    if (app.child.exitCode === null) app.child.kill();
  }
}

const fixture = join(directory, 'fixtures');
await mkdir(fixture, { recursive: true });
const pdfPath = join(fixture, 'smoke-test.pdf');
const pngPath = join(fixture, 'smoke-test.png');
await writeFile(pdfPath, pdf());
await writeFile(pngPath, png());
const invalidPath = join(fixture, 'invalid-backup.zip');
await writeFile(invalidPath, 'not a RUMO backup');
const backupPath = join(fixture, 'with-attachments.zip');
let projectId = randomUUID();
let taskId = randomUUID();
const timestamp = new Date().toISOString();
async function run() {
  let app = await open();
  try {
    const select = (query, values = []) =>
      app.invoke('plugin:sql|select', { db: 'sqlite:rumo.db', query, values });
    const execute = (query, values = []) =>
      app.invoke('plugin:sql|execute', { db: 'sqlite:rumo.db', query, values });
    async function checkLegacy(schema, currentBackupPath, currentProjectId) {
      const legacyDirectory = join(fixture, `legacy-${artifactManifest.commit.slice(0, 8)}`);
      execFileSync(
        process.execPath,
        ['scripts/native-smoke-legacy-backup.mjs', legacyDirectory, artifactManifest.commit],
        { stdio: 'inherit' },
      );
      const legacyPath = join(legacyDirectory, 'legacy-schema-19.zip');
      const legacy = await app.invoke('inspect_backup', { source: legacyPath });
      assert.equal(legacy.schemaVersion, 19);
      assert.equal(legacy.attachments.length, 0);
      await app.invoke('plugin:sql|close', { db: 'sqlite:rumo.db' });
      await app.invoke('restore_backup', { source: legacyPath });
      await close(app);
      app = await open();
      assert.equal(
        (await select('SELECT MAX(version) version FROM _sqlx_migrations WHERE success=1'))[0]
          .version,
        schema,
      );
      assert.equal(
        (await select("SELECT count(*) n FROM projects WHERE name='Legacy Smoke Project'"))[0].n,
        1,
      );
      assert.equal((await select('SELECT count(*) n FROM attachments'))[0].n, 0);
      assert.match(await app.invoke('check_integrity'), /integrity_check: ok/);
      console.log('Synthetic schema-19 backup restored and migrated to current schema PASS');

      await app.invoke('plugin:sql|close', { db: 'sqlite:rumo.db' });
      await app.invoke('restore_backup', { source: currentBackupPath });
      await close(app);
      app = await open();
      assert.equal(
        (await select('SELECT name FROM projects WHERE id=$1', [currentProjectId]))[0].name,
        'Smoke Project',
      );
      assert.equal(
        (
          await app.invoke('attachment_list', {
            entityType: 'project',
            entityId: currentProjectId,
          })
        ).length,
        2,
      );
      assert.match(await app.invoke('check_integrity'), /integrity_check: ok/);
      console.log('Current synthetic state restored after legacy upgrade PASS');
    }
    if (process.argv.includes('--restore-modern')) {
      assert.equal(
        (await select("SELECT count(*) n FROM projects WHERE name='Legacy Smoke Project'"))[0].n,
        1,
      );
      await app.invoke('plugin:sql|close', { db: 'sqlite:rumo.db' });
      await app.invoke('restore_backup', { source: backupPath });
      await close(app);
      app = await open();
      assert.equal(
        (await select('SELECT MAX(version) version FROM _sqlx_migrations'))[0].version,
        28,
      );
      assert.equal(
        (await select("SELECT count(*) n FROM projects WHERE name='Smoke Project'"))[0].n,
        1,
      );
      assert.equal((await select('SELECT count(*) n FROM attachments'))[0].n, 2);
      assert.match(await app.invoke('check_integrity'), /integrity_check: ok/);
      console.log('Synthetic modern state recovered from existing backup PASS');
      return;
    }
    const schema = (
      await select('SELECT MAX(version) version FROM _sqlx_migrations WHERE success=1')
    )[0].version;
    assert.equal(schema, 28);
    if (process.argv.includes('--legacy-only')) {
      const rows = await select("SELECT id FROM projects WHERE name='Smoke Project'");
      assert.equal(rows.length, 1);
      assert.equal((await select('SELECT count(*) n FROM attachments'))[0].n, 2);
      await checkLegacy(schema, backupPath, rows[0].id);
      return;
    }
    const existingProjects = await select('SELECT id,name FROM projects');
    assert(existingProjects.every((row) => row.name === 'Smoke Project'));
    assert(existingProjects.length <= 1, 'Unexpected projects in the smoke profile');
    if (existingProjects.length) {
      projectId = existingProjects[0].id;
      const existingTasks = await select('SELECT id,title FROM tasks WHERE project_id=$1', [
        projectId,
      ]);
      assert.equal(existingTasks.length, 1);
      assert.equal(existingTasks[0].title, 'Smoke Task');
      taskId = existingTasks[0].id;
      assert.equal(
        (await app.invoke('attachment_list', { entityType: 'project', entityId: projectId }))
          .length,
        0,
      );
    } else {
      await execute('INSERT INTO projects(id,name,created_at,updated_at) VALUES($1,$2,$3,$3)', [
        projectId,
        'Smoke Project',
        timestamp,
      ]);
      await execute(
        'INSERT INTO tasks(id,title,project_id,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
        [taskId, 'Smoke Task', projectId, timestamp],
      );
    }
    const pdfRow = await app.invoke('attachment_add', {
      entityType: 'project',
      entityId: projectId,
      source: pdfPath,
    });
    const pngRow = await app.invoke('attachment_add', {
      entityType: 'project',
      entityId: projectId,
      source: pngPath,
    });
    assert.equal(
      (await app.invoke('attachment_list', { entityType: 'project', entityId: projectId })).length,
      2,
    );
    await app.invoke('attachment_open', { id: pdfRow.id, reveal: false });
    await app.invoke('attachment_open', { id: pngRow.id, reveal: true });
    const report = await app.invoke('attachment_check');
    assert.equal(report.attachment_count, 2);
    assert.equal(report.missing, 0);
    assert.equal(report.mismatched, 0);
    console.log('Synthetic Project/Task, PDF/PNG attachment and open/reveal command PASS');
    await close(app);

    app = await open();
    assert.equal(
      (await select('SELECT name FROM projects WHERE id=$1', [projectId]))[0].name,
      'Smoke Project',
    );
    assert.equal(
      (await app.invoke('attachment_list', { entityType: 'project', entityId: projectId })).length,
      2,
    );
    console.log('Restart persistence PASS');
    const manifest = await app.invoke('create_backup', { destination: backupPath });
    assert.equal(manifest.schemaVersion, schema);
    assert.equal(manifest.attachments.length, 2);
    await execute('UPDATE projects SET name=$2 WHERE id=$1', [projectId, 'Smoke Project modified']);
    await app.invoke('attachment_remove', { id: pdfRow.id });
    await assert.rejects(app.invoke('restore_backup', { source: invalidPath }));
    assert.equal(
      (await select('SELECT name FROM projects WHERE id=$1', [projectId]))[0].name,
      'Smoke Project modified',
    );
    assert.equal(
      (await app.invoke('attachment_list', { entityType: 'project', entityId: projectId })).length,
      1,
    );
    console.log('Invalid restore preserves current data and attachment PASS');
    await app.invoke('plugin:sql|close', { db: 'sqlite:rumo.db' });
    const preventive = await app.invoke('restore_backup', { source: backupPath });
    await app.page.reload();
    await app.page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__), undefined, {
      timeout: 10000,
    });
    await app.invoke('plugin:sql|load', { db: 'sqlite:rumo.db' });
    assert.equal(
      (await select('SELECT name FROM projects WHERE id=$1', [projectId]))[0].name,
      'Smoke Project',
    );
    assert.equal(
      (await select('SELECT title FROM tasks WHERE id=$1', [taskId]))[0].title,
      'Smoke Task',
    );
    assert.equal(
      (await app.invoke('attachment_list', { entityType: 'project', entityId: projectId })).length,
      2,
    );
    const restored = await app.invoke('attachment_check');
    assert.equal(restored.missing, 0);
    assert.equal(restored.mismatched, 0);
    assert.match(await app.invoke('check_integrity'), /integrity_check: ok/);
    const preventiveManifest = await app.invoke('inspect_backup', { source: preventive });
    assert.equal(preventiveManifest.kind, 'pre_restore');
    assert.equal(preventiveManifest.attachments.length, 1);
    console.log('Backup with attachments, restore and pre-restore snapshot PASS');

    await checkLegacy(schema, backupPath, projectId);
  } finally {
    if (app.child.exitCode === null) await close(app);
  }
}
await run();
