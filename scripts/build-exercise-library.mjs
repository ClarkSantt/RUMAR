// One-time authoring aid for migration 0012. Never regenerate an applied migration.
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exerciseSeeds } from './exercise-seed-v110.mjs';

const target = fileURLToPath(
  new URL('../src-tauri/migrations/0012_exercise_library.sql', import.meta.url),
);
if (existsSync(target))
  throw Error('Migration already exists; do not overwrite an applied migration.');
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = exerciseSeeds.map((exercise, index) => {
  const id = `builtin-v110-${String(index + 1).padStart(3, '0')}`;
  const fields = [
    id,
    exercise.name,
    exercise.muscle,
    exercise.equipment,
    exercise.load_type,
    JSON.stringify(exercise.aliases),
    '[]',
    '',
    '2026-09-27T00:00:00Z',
  ];
  return ` (${fields.map(quote).join(',')},0,'',${quote(fields.at(-1))})`;
});
const sql = `-- New metadata and curated local library. Existing exercises and session snapshots stay intact.
ALTER TABLE exercises ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(aliases_json) AND json_type(aliases_json)='array');
ALTER TABLE exercises ADD COLUMN secondary_muscles_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(secondary_muscles_json) AND json_type(secondary_muscles_json)='array');
ALTER TABLE exercises ADD COLUMN movement_pattern TEXT NOT NULL DEFAULT '';
CREATE INDEX exercises_alias_search ON exercises(archived_at,muscle_group,equipment);
INSERT OR IGNORE INTO exercises(id,name,muscle_group,equipment,load_type,aliases_json,secondary_muscles_json,movement_pattern,created_at,is_custom,notes,updated_at) VALUES
${rows.join(',\n')};
`;
writeFileSync(target, sql);
console.log(`Created ${target} with ${exerciseSeeds.length} additional exercises.`);
