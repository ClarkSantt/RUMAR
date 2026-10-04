import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Builds a disposable schema-19 database from the immutable migrations, not from any user profile.
const directory = resolve(process.argv[2] ?? 'artifacts/native-smoke/fixtures/legacy');
const commit = process.argv[3];
assert.match(commit ?? '', /^[0-9a-f]{40}$/i, 'Use the exact smoke artifact commit');
await mkdir(directory, { recursive: true });
const dbPath = join(directory, 'rumo.db');
const archivePath = join(directory, 'legacy-schema-19.zip');
const migrationDirectory = resolve('src-tauri/migrations');
const filenames = await readdir(migrationDirectory);
const fresh = !existsSync(dbPath);
const db = new DatabaseSync(dbPath, { readOnly: !fresh });
try {
  if (fresh) {
    db.exec(`CREATE TABLE _sqlx_migrations (
    version BIGINT PRIMARY KEY, description TEXT NOT NULL,
    installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL, checksum BLOB NOT NULL,
    execution_time BIGINT NOT NULL
  )`);
    const register = db.prepare(
      'INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(?,?,?,?,0)',
    );
    for (let version = 1; version <= 19; version++) {
      const prefix = `${String(version).padStart(4, '0')}_`;
      const matches = filenames.filter((name) => name.startsWith(prefix) && name.endsWith('.sql'));
      assert.equal(matches.length, 1, `Expected exactly one migration ${prefix}`);
      // CI compiles the committed LF-normalized bytes. A Windows worktree can
      // contain different line endings and would otherwise fail SQLx checksums.
      const source = execFileSync('git', ['show', `${commit}:src-tauri/migrations/${matches[0]}`]);
      db.exec(source.toString('utf8'));
      register.run(
        version,
        matches[0].slice(prefix.length, -'.sql'.length),
        1,
        createHash('sha384').update(source).digest(),
      );
    }
    const now = new Date().toISOString();
    const projectId = randomUUID();
    db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(
      projectId,
      'Legacy Smoke Project',
      now,
      now,
    );
    db.prepare(
      'INSERT INTO tasks(id,title,project_id,created_at,updated_at) VALUES(?,?,?,?,?)',
    ).run(randomUUID(), 'Legacy Smoke Task', projectId, now, now);
  }
  assert.equal(db.prepare('SELECT MAX(version) version FROM _sqlx_migrations').get().version, 19);
  for (let version = 1; version <= 19; version++) {
    const prefix = `${String(version).padStart(4, '0')}_`;
    const filename = filenames.find((name) => name.startsWith(prefix) && name.endsWith('.sql'));
    assert(filename);
    const source = execFileSync('git', ['show', `${commit}:src-tauri/migrations/${filename}`]);
    const expected = createHash('sha384').update(source).digest('hex').toUpperCase();
    const actual = db
      .prepare('SELECT hex(checksum) checksum FROM _sqlx_migrations WHERE version=?')
      .get(version)?.checksum;
    assert.equal(actual, expected, `Legacy migration ${version} checksum differs from CI build`);
  }
  assert.equal(
    db.prepare("SELECT count(*) count FROM projects WHERE name='Legacy Smoke Project'").get().count,
    1,
  );
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
} finally {
  db.close();
}
const bytes = await readFile(dbPath);
const manifest = {
  app: 'RUMO',
  appVersion: 'synthetic-schema-19',
  schemaVersion: 19,
  createdAt: new Date().toISOString(),
  database: 'rumo.db',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  kind: 'manual',
};
await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
execFileSync('tar.exe', ['-a', '-c', '-f', archivePath, 'manifest.json', 'rumo.db'], {
  cwd: directory,
  stdio: 'pipe',
});
console.log(`Synthetic schema-19 backup: ${archivePath}`);
