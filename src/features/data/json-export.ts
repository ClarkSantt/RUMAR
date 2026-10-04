import type { SqlConnection } from '../../lib/database/connection';
import packageInfo from '../../../package.json';

// Explicit allowlist: internal migration bookkeeping, transient queues and
// backup settings are deliberately not part of the portable data format.
const domains = {
  organization: [
    'settings',
    'inbox_items',
    'tasks',
    'subtasks',
    'task_completions',
    'subtask_completions',
    'projects',
    'project_sections',
    'thoughts',
    'habits',
    'habit_entries',
    'routines',
    'routine_items',
    'routine_occurrences',
    'routine_item_completions',
  ],
  workouts: [
    'exercises',
    'workout_plans',
    'workout_days',
    'workout_day_weekdays',
    'workout_day_exercises',
    'workout_sessions',
    'workout_session_exercises',
    'workout_sets',
    'workout_day_energy',
    'workout_session_energy',
  ],
  nutrition: [
    'food_sources',
    'foods',
    'food_nutrients',
    'meals',
    'meal_items',
    'diet_plans',
    'diet_meals',
    'food_diary_entries',
    'nutrition_goals',
    'body_weight_entries',
    'body_measurement_records',
    'body_measurement_values',
    'daily_activity_entries',
    'energy_profile',
  ],
  finance: [
    'finance_accounts',
    'finance_categories',
    'finance_rules',
    'finance_import_batches',
    'finance_transactions',
    'finance_month_plans',
    'finance_category_budgets',
    'finance_recurring',
    'finance_goals',
    'finance_goal_contributions',
    'finance_assets',
    'finance_asset_valuations',
    'finance_preferences',
  ],
  planning: [
    'calendar_source_preferences',
    'calendar_visibility_overrides',
    'planner_time_blocks',
    'focus_sessions',
    'planner_preferences',
    'planner_task_actions',
    'planner_time_block_series',
    'planner_time_block_exceptions',
    'external_calendar_events',
  ],
  continuity: [
    'templates',
    'template_applications',
    'template_diary_applications',
    'notification_preferences',
    'notification_deliveries',
    'weekly_review_notes',
    'monthly_review_notes',
  ],
  objectives: [
    'objectives',
    'objective_links',
    'objective_updates',
    'objective_create_actions',
    'objective_milestones',
    'timeline_notes',
  ],
  automations: [
    'automation_rules',
    'automation_events',
    'automation_executions',
    'automation_origins',
    'automation_notification_queue',
  ],
  dataManagement: ['data_import_batches'],
  attachments: ['attachments'],
} as const;

type DomainName = keyof typeof domains;
type Row = Record<string, unknown>;

export interface PortableExport {
  format: 'RUMO portable data';
  exportVersion: 1;
  rumoVersion: string;
  exportedAt: string;
  schemaVersion: number;
  attachmentFilesIncluded: false;
  data: Record<DomainName, Record<string, Row[]>>;
}

export async function portableJson(db: SqlConnection): Promise<PortableExport> {
  const version = await db.select<{ version: number }[]>(
    'SELECT MAX(version) AS version FROM _sqlx_migrations WHERE success=1',
  );
  const schemaVersion = version[0]?.version;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 24)
    throw new Error('O banco precisa estar atualizado antes da exportação completa.');

  const data = {} as PortableExport['data'];
  for (const [domain, tables] of Object.entries(domains)) {
    const section: Record<string, Row[]> = {};
    for (const table of tables) {
      // Names come only from the compile-time allowlist above, never user input.
      section[table] = await db.select<Row[]>(`SELECT * FROM ${table}`);
    }
    data[domain as DomainName] = section;
  }
  return {
    format: 'RUMO portable data',
    exportVersion: 1,
    rumoVersion: packageInfo.version,
    exportedAt: new Date().toISOString(),
    schemaVersion,
    attachmentFilesIncluded: false,
    data,
  };
}
