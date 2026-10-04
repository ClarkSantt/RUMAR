import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Packaging fixture only: a closed, explicitly isolated schema-9 profile is
// converted into the schema-8 layout in artifacts, never in the live profile.
const source = join(process.env.APPDATA, 'com.rumo.validation.phase6', 'rumo.db');
assert.match(source.replaceAll('\\', '/'), /com\.rumo\.validation\.phase6\/rumo\.db$/);
const output = resolve('artifacts/phase6/schema8-fixture');
mkdirSync(output, { recursive: true });
const destination = join(output, 'rumo.db');
assert(!existsSync(destination), 'Fixture already exists');
const current = new DatabaseSync(source, { readOnly: true });
assert.equal(current.prepare('SELECT MAX(version) version FROM _sqlx_migrations').get().version, 9);
assert.equal(
  current.prepare("SELECT title FROM tasks WHERE title='Estado B'").get().title,
  'Estado B',
);
await backup(current, destination);
current.close();
const old = new DatabaseSync(destination);
old.exec(`BEGIN;
  INSERT INTO body_weight_entries(id,entry_date,weight_kg,notes,created_at,updated_at)
  SELECT record_id,measurement_date,value,notes,r.created_at,r.updated_at
  FROM body_measurement_records r JOIN body_measurement_values v ON v.record_date=r.measurement_date
  WHERE metric_key='weight';
  DROP TABLE body_measurement_values;
  DROP TABLE body_measurement_records;
  DELETE FROM _sqlx_migrations WHERE version=9;
  COMMIT;`);
assert.equal(old.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
const tables = [
  'tasks',
  'projects',
  'habits',
  'routines',
  'thoughts',
  'workout_plans',
  'workout_sessions',
  'meals',
  'food_diary_entries',
  'finance_transactions',
  'settings',
  'body_weight_entries',
];
const snapshot = Object.fromEntries(
  tables.map((table) => [table, old.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
);
writeFileSync(join(output, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
old.close();
console.log(JSON.stringify({ fixture: destination, schema: 8, tables: tables.length }));
