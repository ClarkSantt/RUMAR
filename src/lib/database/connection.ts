export interface SqlConnection {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number }>;
  close?(): Promise<boolean>;
}
export async function closeDatabase(): Promise<void> {
  if (!connection) return;
  const database = await connection;
  if (!database.close) throw new Error('Não foi possível fechar a conexão SQLite.');
  await database.close();
  connection = undefined;
}
let connection: Promise<SqlConnection> | undefined;
export function getDatabase(): Promise<SqlConnection> {
  connection ??= import('@tauri-apps/plugin-sql')
    .then(async ({ default: Database }) => {
      const database = await Database.load('sqlite:rumo.db');
      const calendarWrite =
        /\b(?:tasks|routines|planner_time_blocks|planner_time_block_series|planner_time_block_exceptions|workout_days|workout_day_weekdays|workout_plans|objectives|objective_milestones|calendar_visibility_overrides|calendar_source_preferences|google_calendar_item_preferences|automation_executions)\b/i;
      const wrapped: SqlConnection = {
        select: (query, bindValues) => database.select(query, bindValues),
        execute: async (query, bindValues) => {
          const result = await database.execute(query, bindValues);
          if (calendarWrite.test(query))
            window.dispatchEvent(new Event('rumo-local-calendar-write'));
          return result;
        },
        close: () => database.close(),
      };
      // Entity deletion queues file cleanup in SQLite. Drain it only after migrations finish.
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('attachment_cleanup'))
        .catch(() => {});
      return wrapped;
    })
    .catch((error) => {
      connection = undefined;
      throw error;
    });
  return connection;
}
