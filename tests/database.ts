import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SqlConnection } from '../src/lib/database/connection';
export function database(path = ':memory:', version = 31) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('CREATE TABLE IF NOT EXISTS test_migrations(version INTEGER PRIMARY KEY)');
  for (const [index, filename] of [
    '0001_foundation.sql',
    '0002_organization.sql',
    '0003_workouts.sql',
    '0004_nutrition.sql',
    '0005_nutrition_units.sql',
    '0006_finance.sql',
    '0007_finance_integrity.sql',
    '0008_release.sql',
    '0009_body_progress.sql',
    '0010_planning_energy.sql',
    '0011_activity_overlap.sql',
    '0012_exercise_library.sql',
    '0013_continuity.sql',
    '0014_objectives_timeline.sql',
    '0015_daily_planner.sql',
    '0016_focus_occurrence.sql',
    '0017_automations_recurrence.sql',
    '0018_objective_milestones_reviews.sql',
    '0019_automation_milestone_events.sql',
    '0020_attachments.sql',
    '0021_data_imports.sql',
    '0022_external_calendar_filters.sql',
    '0023_import_conflicts.sql',
    '0024_finance_csv_mapping.sql',
    '0025_google_calendar.sql',
    '0026_google_calendar_sources.sql',
    '0027_google_calendar_bootstrap.sql',
    '0028_financial_connections.sql',
    '0029_planning_foundation.sql',
    '0030_activity_home_reviews.sql',
    '0031_productivity_intelligence.sql',
  ].entries()) {
    if (
      index + 1 > version ||
      sqlite.prepare('SELECT version FROM test_migrations WHERE version=?').get(index + 1)
    )
      continue;
    sqlite.exec('BEGIN');
    sqlite.exec(readFileSync(resolve('src-tauri', 'migrations', filename), 'utf8'));
    sqlite.exec(`INSERT INTO test_migrations VALUES(${index + 1}); COMMIT`);
  }
  // Node's SQLite bindings accept named parameters. Preserve the production SQL verbatim.
  const bindings = (values: unknown[]) =>
    Object.fromEntries(values.map((value, i) => [`$${i + 1}`, value as string | number | null]));
  const connection: SqlConnection = {
    async select<T>(sql: string, values = []) {
      return sqlite.prepare(sql).all(bindings(values)) as T;
    },
    async execute(sql: string, values = []) {
      const result = sqlite.prepare(sql).run(bindings(values));
      return { rowsAffected: Number(result.changes) };
    },
  };
  return { sqlite, connection };
}
