import type { SqlConnection } from '../../lib/database/connection';
import { addDays, localDate } from '../../lib/dates';
import { WorkoutScheduleRepository } from '../workouts/repositories/schedule';
import {
  automaticStepAdjustment,
  BASELINE_STEPS,
  civilDate,
  ageOn,
  desiredBalance,
  macroGoals,
  restingEnergy,
  stepAdjustment,
  validateProfile,
  workoutCalories,
  type EnergyProfile,
  type WorkoutEnergy,
} from './domain';
export interface EnergyDay {
  day: string;
  weight: number | null;
  steps: number | null;
  workout_steps: number;
  estimated_steps: number;
  step_adjustment_withheld: boolean;
  consumed: number | null;
  resting: number | null;
  base: number | null;
  step_adjustment: number;
  planned_workout: number;
  completed_workout: number;
  planned_target: number | null;
  target: number | null;
  expenditure: number | null;
  balance: number | null;
  goals: ReturnType<typeof macroGoals> | null;
}
export class EnergyRepository {
  constructor(private db: SqlConnection) {}
  async profile() {
    const rows = await this.db.select<{ settings_json: string }[]>(
      'SELECT settings_json FROM energy_profile WHERE id=1',
    );
    return rows[0] ? (JSON.parse(rows[0].settings_json) as EnergyProfile) : null;
  }
  async saveProfile(p: EnergyProfile) {
    validateProfile(p, localDate());
    await this.db.execute(
      'INSERT INTO energy_profile(id,settings_json,updated_at) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at',
      [JSON.stringify(p), new Date().toISOString()],
    );
  }
  async activity(day: string, steps: number, notes = '', workoutSteps = 0) {
    civilDate(day);
    if (!Number.isInteger(steps) || steps < 0 || steps > 200000)
      throw Error('Informe passos inteiros entre 0 e 200.000.');
    if (!Number.isInteger(workoutSteps) || workoutSteps < 0 || workoutSteps > steps)
      throw Error('Passos do treino devem estar entre zero e os passos totais.');
    await this.db.execute(
      'INSERT INTO daily_activity_entries(entry_date,steps,notes,created_at,updated_at,workout_steps) VALUES($1,$2,$3,$4,$4,$5) ON CONFLICT(entry_date) DO UPDATE SET steps=excluded.steps,notes=excluded.notes,workout_steps=excluded.workout_steps,updated_at=excluded.updated_at',
      [day, steps, notes, new Date().toISOString(), workoutSteps],
    );
  }
  async activityEntry(day: string) {
    civilDate(day);
    return (
      (
        await this.db.select<{ steps: number; notes: string; workout_steps: number }[]>(
          'SELECT steps,notes,workout_steps FROM daily_activity_entries WHERE entry_date=$1',
          [day],
        )
      )[0] ?? null
    );
  }
  async averages(day: string) {
    civilDate(day);
    return this.db.select<{ days: number; average: number | null; period: number }[]>(
      `SELECT COUNT(*) days,AVG(steps) average,7 period FROM daily_activity_entries WHERE entry_date BETWEEN $1 AND $3 UNION ALL SELECT COUNT(*),AVG(steps),30 FROM daily_activity_entries WHERE entry_date BETWEEN $2 AND $3`,
      [addDays(day, -6), addDays(day, -29), day],
    );
  }
  async energy(kind: 'day' | 'session', id: string) {
    const table = kind === 'day' ? 'workout_day_energy' : 'workout_session_energy',
      key = kind === 'day' ? 'workout_day_id' : 'session_id';
    return (
      await this.db.select<WorkoutEnergy[]>(
        `SELECT method,minutes,met,calories FROM ${table} WHERE ${key}=$1`,
        [id],
      )
    )[0];
  }
  async saveEnergy(kind: 'day' | 'session', id: string, e: WorkoutEnergy) {
    if (
      !['off', 'manual', 'estimated'].includes(e.method) ||
      (e.calories !== null &&
        (!Number.isFinite(e.calories) || e.calories < 0 || e.calories > 20000)) ||
      (e.minutes !== null && (!Number.isFinite(e.minutes) || e.minutes <= 0 || e.minutes > 1440)) ||
      (e.met !== null && ![3.5, 6].includes(e.met)) ||
      (e.method === 'manual' && e.calories === null) ||
      (e.method === 'estimated' && (e.met === null || (kind === 'day' && e.minutes === null)))
    )
      throw Error('Confira método, duração e energia.');
    const table = kind === 'day' ? 'workout_day_energy' : 'workout_session_energy',
      key = kind === 'day' ? 'workout_day_id' : 'session_id';
    await this.db.execute(
      `INSERT INTO ${table}(${key},method,minutes,met,calories) VALUES($1,$2,$3,$4,$5) ON CONFLICT(${key}) DO UPDATE SET method=excluded.method,minutes=excluded.minutes,met=excluded.met,calories=excluded.calories`,
      [id, e.method, e.minutes, e.met, e.calories],
    );
  }
  async range(from: string, to: string): Promise<EnergyDay[]> {
    civilDate(from);
    civilDate(to);
    if (to < from || to > addDays(from, 30)) throw Error('Consulte no máximo 31 dias por vez.');
    const [p, weights, activity, diary, planned, templates, sessions, plannedMinutes] =
      await Promise.all([
        this.profile(),
        this.db.select<{ date: string; value: number }[]>(
          `SELECT record_date date,value FROM body_measurement_values WHERE metric_key='weight' AND record_date BETWEEN $1 AND $2 UNION ALL SELECT record_date,value FROM body_measurement_values WHERE metric_key='weight' AND record_date=(SELECT MAX(record_date) FROM body_measurement_values WHERE metric_key='weight' AND record_date<$1) ORDER BY date DESC`,
          [from, to],
        ),
        this.db.select<{ entry_date: string; steps: number; workout_steps: number }[]>(
          'SELECT entry_date,steps,workout_steps FROM daily_activity_entries WHERE entry_date BETWEEN $1 AND $2',
          [addDays(from, -30), to],
        ),
        this.db.select<{ day: string; calories: number | null }[]>(
          `SELECT entry_date day,SUM(CAST(json_extract(nutrients_json,'$.energy_kcal') AS REAL)) calories FROM food_diary_entries WHERE entry_date BETWEEN $1 AND $2 GROUP BY entry_date`,
          [from, to],
        ),
        new WorkoutScheduleRepository(this.db).range(from, to),
        this.db.select<(WorkoutEnergy & { workout_day_id: string })[]>(
          'SELECT e.* FROM workout_day_energy e JOIN workout_days d ON d.id=e.workout_day_id JOIN workout_plans p ON p.id=d.workout_plan_id WHERE p.active=1 AND p.archived_at IS NULL',
        ),
        this.db.select<
          (WorkoutEnergy & {
            session_date: string;
            started_at: string;
            finished_at: string;
            id: string;
          })[]
        >(
          `SELECT s.id,s.session_date,s.started_at,s.finished_at,e.method,e.minutes,e.met,e.calories FROM workout_sessions s LEFT JOIN workout_session_energy e ON e.session_id=s.id WHERE s.status='completed' AND s.session_date BETWEEN $1 AND $2`,
          [from, to],
        ),
        this.db.select<{ workout_day_id: string; minutes: number }[]>(
          `SELECT d.workout_day_id,MAX(30,SUM(d.target_sets*(2+COALESCE(d.rest_seconds,90)/60.0))) minutes
         FROM workout_day_exercises d JOIN exercises e ON e.id=d.exercise_id
         WHERE e.archived_at IS NULL GROUP BY d.workout_day_id`,
        ),
      ]);
    const rows: EnergyDay[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const weight = weights.find((w) => w.date <= day)?.value ?? null,
        activityToday = activity.find((a) => a.entry_date === day),
        steps = activityToday?.steps ?? null,
        workout_steps = activityToday?.workout_steps ?? 0,
        prior = activity.filter((a) => a.entry_date < day && a.entry_date >= addDays(day, -30)),
        estimated_steps =
          prior.length >= 3
            ? Math.round(
                prior.reduce((sum, a) => sum + a.steps - a.workout_steps, 0) / prior.length,
              )
            : BASELINE_STEPS,
        consumed = diary.find((d) => d.day === day)?.calories ?? null;
      const resting =
          p && weight !== null && ageOn(p.birth_date, day) >= 18
            ? restingEnergy(p, weight, day)
            : null,
        base = resting !== null && p ? resting * p.base_factor : null;
      const done =
        weight === null
          ? 0
          : sessions
              .filter((s) => s.session_date === day)
              .reduce(
                (sum, s) =>
                  sum +
                  workoutCalories(
                    s.method ? s : undefined,
                    weight,
                    Math.min(240, (Date.parse(s.finished_at) - Date.parse(s.started_at)) / 60000),
                  ),
                0,
              );
      const projected =
        weight === null
          ? 0
          : planned
              .filter((w) => w.date === day && !w.session_id)
              .reduce(
                (sum, w) =>
                  sum +
                  workoutCalories(
                    templates.find((t) => t.workout_day_id === w.day_id),
                    weight,
                    plannedMinutes.find((t) => t.workout_day_id === w.day_id)?.minutes,
                  ),
                0,
              ) + done;
      const step_adjustment_withheld = Boolean(
          p?.automatic && done > 0 && steps !== null && workout_steps === 0,
        ),
        adjustment = p?.automatic
          ? weight === null || step_adjustment_withheld
            ? 0
            : automaticStepAdjustment(
                weight,
                steps === null ? estimated_steps : steps - workout_steps,
              )
          : p
            ? stepAdjustment(p, steps === null ? null : steps - workout_steps)
            : 0;
      const expenditure = base === null ? null : Math.max(0, base + adjustment + done),
        target = expenditure === null || !p ? null : Math.max(0, expenditure + desiredBalance(p));
      rows.push({
        day,
        weight,
        steps,
        workout_steps,
        estimated_steps,
        step_adjustment_withheld,
        consumed,
        resting,
        base,
        step_adjustment: adjustment,
        planned_workout: projected,
        completed_workout: done,
        planned_target:
          base === null || !p ? null : Math.max(0, base + projected + desiredBalance(p)),
        target,
        expenditure,
        balance: consumed === null || expenditure === null ? null : consumed - expenditure,
        goals: p && weight !== null && target !== null ? macroGoals(p, target, weight) : null,
      });
    }
    return rows;
  }
  async day(day: string) {
    return (await this.range(day, day))[0];
  }
  async sessionEstimate(id: string) {
    const rows = await this.db.select<
      {
        method: WorkoutEnergy['method'] | null;
        minutes: number | null;
        met: number | null;
        calories: number | null;
        started_at: string;
        finished_at: string | null;
        session_date: string;
        weight: number | null;
      }[]
    >(
      `SELECT e.method,e.minutes,e.met,e.calories,s.started_at,s.finished_at,s.session_date,
       (SELECT v.value FROM body_measurement_values v WHERE v.metric_key='weight' AND v.record_date<=s.session_date ORDER BY v.record_date DESC LIMIT 1) weight
       FROM workout_sessions s LEFT JOIN workout_session_energy e ON e.session_id=s.id WHERE s.id=$1`,
      [id],
    );
    const row = rows[0];
    if (!row || !row.finished_at || row.weight === null) return null;
    return workoutCalories(
      row.method
        ? { method: row.method, minutes: row.minutes, met: row.met, calories: row.calories }
        : undefined,
      row.weight,
      Math.min(240, (Date.parse(row.finished_at) - Date.parse(row.started_at)) / 60000),
    );
  }
}
