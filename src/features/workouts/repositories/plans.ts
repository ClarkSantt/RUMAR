import type { SqlConnection } from '../../../lib/database/connection';
import type {
  WorkoutPlan,
  PlanInput,
  WorkoutDay,
  DayInput,
  DayExercise,
  DayExerciseInput,
} from '../types';
import { requiredName } from './catalog';
export class PlansRepository {
  constructor(private db: SqlConnection) {}
  list(includeArchived = false) {
    return this.db.select<WorkoutPlan[]>(
      'SELECT * FROM workout_plans WHERE $1=1 OR archived_at IS NULL ORDER BY active DESC,created_at DESC,id',
      [Number(includeArchived)],
    );
  }
  async save(input: PlanInput, id?: string) {
    const key = id ?? crypto.randomUUID(),
      now = new Date().toISOString();
    await this.db.execute(
      id
        ? 'UPDATE workout_plans SET name=$1,description=$2,habit_id=$3,updated_at=$4 WHERE id=$5'
        : 'INSERT INTO workout_plans(name,description,habit_id,created_at,updated_at,id,active) VALUES($1,$2,$3,$4,$4,$5,$6)',
      id
        ? [requiredName(input.name), input.description, input.habit_id, now, key]
        : [
            requiredName(input.name),
            input.description,
            input.habit_id,
            now,
            key,
            Number(input.activate ?? false),
          ],
    );
    return key;
  }
  async activate(id: string) {
    const result = await this.db.execute(
      'UPDATE workout_plans SET active=1,updated_at=$2 WHERE id=$1 AND archived_at IS NULL',
      [id, new Date().toISOString()],
    );
    if (!result.rowsAffected) throw Error('Plano não disponível.');
  }
  async archive(id: string) {
    await this.db.execute(
      'UPDATE workout_plans SET archived_at=$2,updated_at=$2,active=0 WHERE id=$1',
      [id, new Date().toISOString()],
    );
  }
  async days(planId: string) {
    const rows = await this.db.select<WorkoutDay[]>(
      'SELECT d.*, (SELECT COUNT(*) FROM workout_day_exercises x JOIN exercises e ON e.id=x.exercise_id WHERE x.workout_day_id=d.id AND e.archived_at IS NULL) exercise_count FROM workout_days d WHERE workout_plan_id=$1 ORDER BY sort_order,created_at,id',
      [planId],
    );
    const links = await this.db.select<{ workout_day_id: string; weekday: number }[]>(
      'SELECT w.* FROM workout_day_weekdays w JOIN workout_days d ON d.id=w.workout_day_id WHERE d.workout_plan_id=$1 ORDER BY weekday',
      [planId],
    );
    return rows.map((row) => ({
      ...row,
      weekdays: links.filter((w) => w.workout_day_id === row.id).map((w) => w.weekday),
    }));
  }
  async saveDay(planId: string, input: DayInput, id?: string) {
    const weekdays = [
      ...new Set(input.weekdays ?? (input.weekday === null ? [] : [input.weekday])),
    ];
    if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
      throw Error('Dia da semana inválido.');
    if (
      input.weekday !== null &&
      (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6)
    )
      throw Error('Dia da semana inválido.');
    const key = id ?? crypto.randomUUID(),
      now = new Date().toISOString();
    await this.db.execute(
      id
        ? 'UPDATE workout_days SET name=$1,weekday=$2,notes=$3,updated_at=$4,pending_weekdays=$7 WHERE id=$5 AND workout_plan_id=$6'
        : 'INSERT INTO workout_days(name,weekday,notes,created_at,updated_at,id,workout_plan_id,sort_order,pending_weekdays) VALUES($1,$2,$3,$4,$4,$5,$6,(SELECT COALESCE(MAX(sort_order),0)+1 FROM workout_days WHERE workout_plan_id=$6),$7)',
      [
        requiredName(input.name),
        weekdays[0] ?? null,
        input.notes,
        now,
        key,
        planId,
        JSON.stringify(weekdays),
      ],
    );
    return key;
  }
  async removeDay(id: string) {
    await this.db.execute('DELETE FROM workout_days WHERE id=$1', [id]);
  }
  exercises(dayId: string) {
    return this.db.select<DayExercise[]>(
      'SELECT d.*,e.name exercise_name,e.load_type FROM workout_day_exercises d JOIN exercises e ON e.id=d.exercise_id WHERE workout_day_id=$1 ORDER BY sort_order,d.created_at,d.id',
      [dayId],
    );
  }
  async saveExercise(dayId: string, input: DayExerciseInput, id?: string) {
    if (
      !Number.isInteger(input.target_sets) ||
      input.target_sets < 1 ||
      input.target_sets > 50 ||
      !Number.isInteger(input.min_reps) ||
      input.min_reps < 0 ||
      !Number.isInteger(input.max_reps) ||
      input.max_reps < input.min_reps ||
      input.max_reps > 1000 ||
      (input.rest_seconds !== null &&
        (!Number.isInteger(input.rest_seconds) ||
          input.rest_seconds < 0 ||
          input.rest_seconds > 3600))
    )
      throw Error('Informe séries, repetições e descanso válidos.');
    const key = id ?? crypto.randomUUID(),
      now = new Date().toISOString();
    const result = await this.db.execute(
      id
        ? 'UPDATE workout_day_exercises SET exercise_id=$1,target_sets=$2,min_reps=$3,max_reps=$4,rest_seconds=$5,notes=$6,updated_at=$7 WHERE id=$8 AND workout_day_id=$9 AND EXISTS(SELECT 1 FROM exercises WHERE id=$1 AND archived_at IS NULL)'
        : 'INSERT INTO workout_day_exercises(exercise_id,target_sets,min_reps,max_reps,rest_seconds,notes,created_at,updated_at,id,workout_day_id,sort_order) SELECT $1,$2,$3,$4,$5,$6,$7,$7,$8,$9,(SELECT COALESCE(MAX(sort_order),0)+1 FROM workout_day_exercises WHERE workout_day_id=$9) WHERE EXISTS(SELECT 1 FROM exercises WHERE id=$1 AND archived_at IS NULL)',
      [
        input.exercise_id,
        input.target_sets,
        input.min_reps,
        input.max_reps,
        input.rest_seconds,
        input.notes,
        now,
        key,
        dayId,
      ],
    );
    if (!result.rowsAffected) throw Error('Exercício não disponível.');
    return key;
  }
  async removeExercise(id: string) {
    await this.db.execute('DELETE FROM workout_day_exercises WHERE id=$1', [id]);
  }
  async duplicateExercise(id: string) {
    const rows = await this.db.select<DayExercise[]>(
      'SELECT * FROM workout_day_exercises WHERE id=$1',
      [id],
    );
    if (!rows[0]) throw Error('Exercício não encontrado.');
    return this.saveExercise(rows[0].workout_day_id, rows[0]);
  }
  async moveDay(id: string, direction: -1 | 1) {
    await this.move('workout_days', 'workout_plan_id', id, direction);
  }
  async moveExercise(id: string, direction: -1 | 1) {
    await this.move('workout_day_exercises', 'workout_day_id', id, direction);
  }
  private async move(
    table: 'workout_days' | 'workout_day_exercises',
    parent: 'workout_plan_id' | 'workout_day_id',
    id: string,
    direction: -1 | 1,
  ) {
    const rows = await this.db.select<{ id: string; sort_order: number }[]>(
      `SELECT id,sort_order FROM ${table} WHERE ${parent}=(SELECT ${parent} FROM ${table} WHERE id=$1) ORDER BY sort_order,created_at,id`,
      [id],
    );
    const at = rows.findIndex((r) => r.id === id),
      other = rows[at + direction];
    if (at < 0 || !other) return;
    await this.db.execute(
      `UPDATE ${table} SET sort_order=CASE WHEN id=$1 THEN $2 ELSE $4 END,updated_at=$5 WHERE id IN($1,$3)`,
      [id, other.sort_order, other.id, rows[at].sort_order, new Date().toISOString()],
    );
  }
}
