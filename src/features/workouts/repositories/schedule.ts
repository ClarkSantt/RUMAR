import type { SqlConnection } from '../../../lib/database/connection';
import { addDays, parseDate } from '../../../lib/dates';
import type { WorkoutDay, WorkoutSession } from '../types';

export interface ScheduledWorkout {
  id: string;
  day_id: string | null;
  session_id: string | null;
  name: string;
  date: string;
  completed: boolean;
  in_progress: boolean;
  exercise_count: number;
}
export class WorkoutScheduleRepository {
  constructor(private db: SqlConnection) {}
  async days(): Promise<(WorkoutDay & { exercise_count: number })[]> {
    const rows = await this.db.select<
      (WorkoutDay & { exercise_count: number })[]
    >(`SELECT d.*, COUNT(available.id) AS exercise_count
      FROM workout_days d JOIN workout_plans p ON p.id=d.workout_plan_id
      LEFT JOIN workout_day_exercises e ON e.workout_day_id=d.id
      LEFT JOIN exercises available ON available.id=e.exercise_id AND available.archived_at IS NULL
      WHERE p.active=1 AND p.archived_at IS NULL
      GROUP BY d.id ORDER BY d.sort_order,d.id`);
    const links = await this.db.select<{ workout_day_id: string; weekday: number }[]>(
      'SELECT w.* FROM workout_day_weekdays w JOIN workout_days d ON d.id=w.workout_day_id JOIN workout_plans p ON p.id=d.workout_plan_id WHERE p.active=1 AND p.archived_at IS NULL',
    );
    return rows.map((d) => ({
      ...d,
      weekdays: links.filter((w) => w.workout_day_id === d.id).map((w) => w.weekday),
    }));
  }
  async range(from: string, to: string): Promise<ScheduledWorkout[]> {
    const [days, sessions] = await Promise.all([
      this.days(),
      this.db.select<WorkoutSession[]>(
        `SELECT * FROM workout_sessions
        WHERE session_date BETWEEN $1 AND $2 AND status!='discarded'
        ORDER BY started_at`,
        [from, to],
      ),
    ]);
    const rows: ScheduledWorkout[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      for (const day of days) {
        if (!day.weekdays?.includes(parseDate(date).getDay())) continue;
        // A real session replaces its planned occurrence; extra sessions remain visible.
        if (sessions.some((s) => s.session_date === date && s.workout_day_id === day.id)) continue;
        rows.push({
          id: day.id,
          day_id: day.id,
          session_id: null,
          name: day.name,
          date,
          completed: false,
          in_progress: false,
          exercise_count: day.exercise_count,
        });
      }
    }
    for (const session of sessions)
      rows.push({
        id: session.id,
        day_id: session.workout_day_id,
        session_id: session.id,
        name: session.day_name,
        date: session.session_date,
        completed: session.status === 'completed',
        in_progress: session.status === 'in_progress',
        exercise_count: 0,
      });
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }
}
