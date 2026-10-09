import type { SqlConnection } from '../../../lib/database/connection';
import { addDays, localDate, validDate } from '../../../lib/dates';
import type { LoadType, WorkoutSet } from '../types';
import { weeklyMuscleFrequency, type MetricSet } from '../domain';
export type HistorySet = WorkoutSet & MetricSet & { finished_at: string; exercise_name: string };
export class WorkoutHistoryRepository {
  constructor(private readonly db: SqlConnection) {}
  exerciseOptions() {
    return this.db.select<{ id: string; name: string; archived_at: string | null }[]>(
      'SELECT id,name,archived_at FROM exercises ORDER BY name,id',
    );
  }
  async lifetimeRecords(exerciseId: string, loadType: LoadType, excludeSessionId?: string) {
    const values = [exerciseId, loadType, excludeSessionId ?? null];
    const where =
      "w.exercise_id=$1 AND w.load_type=$2 AND ($3 IS NULL OR s.id<>$3) AND s.status='completed' AND w.completed=1 AND w.set_type<>'warmup' AND w.reps IS NOT NULL";
    const [loads, volumes] = await Promise.all([
      this.db.select<{ load: number; reps: number }[]>(
        `SELECT COALESCE(w.load_value,0) AS load,MAX(w.reps) AS reps FROM workout_sets w JOIN workout_sessions s ON s.id=w.workout_session_id WHERE ${where} GROUP BY COALESCE(w.load_value,0)`,
        values,
      ),
      ['total', 'per_side', 'per_dumbbell'].includes(loadType)
        ? this.db.select<{ volume: number | null }[]>(
            `SELECT MAX(volume) AS volume FROM (SELECT SUM(w.load_value*w.reps) AS volume FROM workout_sets w JOIN workout_sessions s ON s.id=w.workout_session_id WHERE ${where} GROUP BY s.id)`,
            values,
          )
        : Promise.resolve([]),
    ]);
    return {
      maxLoad: loadType === 'none' || !loads.length ? null : Math.max(...loads.map((r) => r.load)),
      repsByLoad: new Map(loads.map((r) => [r.load, r.reps])),
      maxSessionVolume: volumes[0]?.volume ?? null,
    };
  }
  exercise(exerciseId: string, options: { from?: string; to?: string; loadType?: LoadType } = {}) {
    const to = options.to ?? localDate(),
      from = options.from ?? addDays(to, -89);
    if (!validDate(from) || !validDate(to) || from > to) throw Error('Período inválido.');
    return this.db.select<HistorySet[]>(
      `SELECT w.*,s.session_date,s.status AS session_status,s.finished_at,e.exercise_name FROM workout_sets w JOIN workout_sessions s ON s.id=w.workout_session_id JOIN workout_session_exercises e ON e.id=w.session_exercise_id WHERE w.exercise_id=$1 AND s.session_date BETWEEN $2 AND $3 AND s.status='completed' AND w.completed=1 ${options.loadType ? 'AND w.load_type=$4' : ''} ORDER BY s.session_date,s.started_at,w.set_number,w.id`,
      options.loadType ? [exerciseId, from, to, options.loadType] : [exerciseId, from, to],
    );
  }
  async muscleFrequency(from = addDays(localDate(), -6), to = localDate()) {
    if (!validDate(from) || !validDate(to) || from > to) throw Error('Período inválido.');
    const rows = await this.db.select<MetricSet[]>(
      `SELECT w.exercise_id,w.workout_session_id,w.load_type,w.load_value,w.reps,w.completed,w.set_type,
       s.status AS session_status,s.session_date,x.muscle_group
       FROM workout_sets w
       JOIN workout_sessions s ON s.id=w.workout_session_id
       JOIN exercises x ON x.id=w.exercise_id
       WHERE s.session_date BETWEEN $1 AND $2 AND s.status='completed' AND w.completed=1
       ORDER BY s.session_date,s.id,w.id`,
      [from, to],
    );
    return weeklyMuscleFrequency(rows).sort(
      (a, b) => b.sessions - a.sessions || a.muscleGroup.localeCompare(b.muscleGroup, 'pt-BR'),
    );
  }
  previousSession(
    exerciseId: string,
    beforeStartedAt: string,
    excludeSessionId?: string,
    loadType?: LoadType,
  ) {
    return this.db.select<HistorySet[]>(
      `SELECT w.*,s.session_date,s.status AS session_status,s.finished_at,e.exercise_name FROM workout_sets w JOIN workout_sessions s ON s.id=w.workout_session_id JOIN workout_session_exercises e ON e.id=w.session_exercise_id WHERE w.exercise_id=$1 AND w.completed=1 AND ($4 IS NULL OR w.load_type=$4) AND s.id=(SELECT p.id FROM workout_sessions p WHERE p.status='completed' AND p.started_at<=$2 AND ($3 IS NULL OR p.id<>$3) AND EXISTS(SELECT 1 FROM workout_sets x WHERE x.workout_session_id=p.id AND x.exercise_id=$1 AND x.completed=1 AND ($4 IS NULL OR x.load_type=$4)) ORDER BY p.started_at DESC,p.id DESC LIMIT 1) ORDER BY w.set_number,w.id`,
      [exerciseId, beforeStartedAt, excludeSessionId ?? null, loadType ?? null],
    );
  }
}
