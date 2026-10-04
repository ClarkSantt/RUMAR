import type { SqlConnection } from '../../lib/database/connection';
export const calendarSources = [
  'task',
  'project',
  'objective',
  'habit',
  'routine',
  'workout',
  'block',
  'milestone',
  'external',
] as const;
export type CalendarSource = (typeof calendarSources)[number];
export class CalendarPreferences {
  constructor(private db: SqlConnection) {}
  sources() {
    return this.db.select<{ source_type: CalendarSource; visible: number }[]>(
      'SELECT * FROM calendar_source_preferences',
    );
  }
  overrides() {
    return this.db.select<{ entity_type: CalendarSource; entity_id: string; visible: number }[]>(
      'SELECT * FROM calendar_visibility_overrides',
    );
  }
  source(kind: CalendarSource, visible: boolean) {
    return this.db.execute(
      'INSERT INTO calendar_source_preferences VALUES($1,$2) ON CONFLICT(source_type) DO UPDATE SET visible=excluded.visible',
      [kind, Number(visible)],
    );
  }
  item(kind: CalendarSource, id: string, visible: boolean) {
    return this.db.execute(
      'INSERT INTO calendar_visibility_overrides VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET visible=excluded.visible',
      [kind, id, Number(visible)],
    );
  }
}
