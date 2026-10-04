import type { SqlConnection } from '../../lib/database/connection';
import { addDays, localDate, parseDate, validDate } from '../../lib/dates';
import { habitEligible, habitReached, weekStart, type Habit } from '../habits/domain';
import { PlannerRepository, FocusRepository } from '../calendar/planner-repository';
import { EnergyRepository } from '../energy/repository';
import { workoutCalories, type WorkoutEnergy } from '../energy/domain';
import { ObjectivesRepository } from '../objectives/repository';
import { MilestonesRepository, type Milestone } from '../objectives/milestones-repository';

export function monthStart(day: string) {
  if (!validDate(day)) throw Error('Mês inválido.');
  return `${day.slice(0, 7)}-01`;
}
export function adjacentMonth(day: string, delta: number) {
  const d = parseDate(monthStart(day));
  d.setMonth(d.getMonth() + delta);
  return localDate(d);
}
export interface MonthlyReviewData {
  start: string;
  end: string;
  effectiveEnd: string;
  elapsedDays: number;
  monthDays: number;
  privateMode: boolean;
  tasks: { completed: number; pending: number };
  projects: { completed: number; withActivity: number };
  objectives: {
    active: number;
    completed: number;
    withActivity: number;
    updates: { id: string; name: string; activities: number }[];
  };
  milestones: Milestone[];
  habits: { done: number; target: number };
  routines: number;
  workouts: {
    sessions: number;
    minutes: number;
    estimatedCalories: number;
    volumes: { load_type: string; volume: number }[];
  };
  focus: { sessions: number; seconds: number };
  planningSeconds: number;
  activity: { days: number; steps: number; average: number };
  body: { metric_key: string; unit: string; first: number; last: number; records: number }[];
  nutrition: {
    days: number;
    caloriesAverage: number;
    proteinAverage: number;
    balance: number | null;
    balanceDays: number;
  };
  finance: {
    hidden: boolean;
    income: number;
    expense: number;
    categories: { name: string; amount: number }[];
  };
  moments: { id: string; title: string; date: string; objectiveId: string | null }[];
  note: string;
  previous: { month: string; workouts: number; averageSteps: number; registeredDays: number };
}
export class MonthlyReviewRepository {
  constructor(private db: SqlConnection) {}
  async load(month: string, today = localDate()): Promise<MonthlyReviewData> {
    const start = monthStart(month),
      end = addDays(adjacentMonth(start, 1), -1);
    if (start > today) throw Error('A revisão está disponível até o mês atual.');
    const effectiveEnd = today < end ? today : end,
      dates: string[] = [];
    for (let d = start; d <= effectiveEnd; d = addDays(d, 1)) dates.push(d);
    const previousStart = adjacentMonth(start, -1),
      previousEnd = addDays(start, -1);
    const [
      taskCounts,
      projects,
      objectiveCounts,
      objectiveUpdates,
      milestones,
      habits,
      entries,
      routines,
      workouts,
      volumes,
      focusCount,
      focusedSeconds,
      planningSeconds,
      steps,
      body,
      nutrition,
      energy,
      finance,
      categoryRows,
      privacy,
      moments,
      notes,
      previous,
    ] = await Promise.all([
      this.db.select<{ completed: number; pending: number }[]>(
        `SELECT
   (SELECT COUNT(*) FROM task_completions WHERE occurrence_date BETWEEN $1 AND $2)+(SELECT COUNT(*) FROM tasks WHERE recurrence IS NULL AND status='completed' AND date(completed_at,'localtime') BETWEEN $1 AND $2) completed,
   (SELECT COUNT(*) FROM tasks WHERE recurrence IS NULL AND date(created_at,'localtime')<=$2 AND (due_date IS NULL OR due_date<=$2) AND (completed_at IS NULL OR date(completed_at,'localtime')>$2) AND (archived_at IS NULL OR date(archived_at,'localtime')>$2)) pending`,
        [start, effectiveEnd],
      ),
      this.db.select<{ completed: number; withActivity: number }[]>(
        `SELECT SUM(CASE WHEN date(p.completed_at,'localtime') BETWEEN $1 AND $2 THEN 1 ELSE 0 END) completed,SUM(CASE WHEN date(p.updated_at,'localtime') BETWEEN $1 AND $2 OR EXISTS(SELECT 1 FROM tasks t WHERE t.project_id=p.id AND date(t.updated_at,'localtime') BETWEEN $1 AND $2) OR EXISTS(SELECT 1 FROM tasks t JOIN task_completions c ON c.task_id=t.id WHERE t.project_id=p.id AND c.occurrence_date BETWEEN $1 AND $2) THEN 1 ELSE 0 END) withActivity FROM projects p`,
        [start, effectiveEnd],
      ),
      this.db.select<{ active: number; completed: number }[]>(
        `SELECT SUM(CASE WHEN start_date<=$2 AND (completed_at IS NULL OR date(completed_at,'localtime')>$2) AND (archived_at IS NULL OR date(archived_at,'localtime')>$2) AND status!='paused' THEN 1 ELSE 0 END) active,SUM(CASE WHEN date(completed_at,'localtime') BETWEEN $1 AND $2 THEN 1 ELSE 0 END) completed FROM objectives`,
        [start, effectiveEnd],
      ),
      new ObjectivesRepository(this.db).weekActivity(start, effectiveEnd, 1000),
      new MilestonesRepository(this.db).completedRange(start, effectiveEnd),
      this.db.select<(Omit<Habit, 'weekdays'> & { weekdays: string })[]>(
        'SELECT * FROM habits WHERE start_date<=$2 AND (end_date IS NULL OR end_date>=$1)',
        [start, effectiveEnd],
      ),
      this.db.select<{ habit_id: string; entry_date: string; value: number }[]>(
        'SELECT habit_id,entry_date,value FROM habit_entries WHERE entry_date BETWEEN $1 AND $2',
        [start, effectiveEnd],
      ),
      this.db.select<{ count: number }[]>(
        'SELECT COUNT(*) count FROM routine_occurrences WHERE completed_at IS NOT NULL AND occurrence_date BETWEEN $1 AND $2',
        [start, effectiveEnd],
      ),
      this.db.select<
        {
          started_at: string;
          finished_at: string;
          weight: number | null;
          method: WorkoutEnergy['method'] | null;
          minutes: number | null;
          met: number | null;
          calories: number | null;
        }[]
      >(
        `SELECT s.started_at,s.finished_at,e.method,e.minutes,e.met,e.calories,(SELECT v.value FROM body_measurement_values v WHERE v.metric_key='weight' AND v.record_date<=s.session_date ORDER BY v.record_date DESC LIMIT 1) weight FROM workout_sessions s LEFT JOIN workout_session_energy e ON e.session_id=s.id WHERE s.status='completed' AND s.session_date BETWEEN $1 AND $2`,
        [start, effectiveEnd],
      ),
      this.db.select<{ load_type: string; volume: number }[]>(
        `SELECT w.load_type,SUM(w.load_value*w.reps) volume FROM workout_sets w JOIN workout_sessions s ON s.id=w.workout_session_id WHERE s.status='completed' AND s.session_date BETWEEN $1 AND $2 AND w.completed=1 AND w.set_type='normal' AND w.load_type NOT IN('bodyweight','none') GROUP BY w.load_type`,
        [start, effectiveEnd],
      ),
      this.db.select<{ count: number }[]>(
        `SELECT COUNT(*) count FROM focus_sessions WHERE status='completed' AND date(ended_at,'localtime') BETWEEN $1 AND $2`,
        [start, effectiveEnd],
      ),
      new FocusRepository(this.db).seconds(start, effectiveEnd),
      new PlannerRepository(this.db).plannedSeconds(start, end),
      this.db.select<{ steps: number }[]>(
        'SELECT steps FROM daily_activity_entries WHERE entry_date BETWEEN $1 AND $2',
        [start, effectiveEnd],
      ),
      this.db.select<
        { metric_key: string; unit: string; first: number; last: number; records: number }[]
      >(
        `WITH ranked AS(SELECT metric_key,unit,value,ROW_NUMBER() OVER(PARTITION BY metric_key ORDER BY record_date) first_order,ROW_NUMBER() OVER(PARTITION BY metric_key ORDER BY record_date DESC) last_order FROM body_measurement_values WHERE record_date BETWEEN $1 AND $2) SELECT metric_key,unit,MAX(CASE WHEN first_order=1 THEN value END) first,MAX(CASE WHEN last_order=1 THEN value END) last,COUNT(*) records FROM ranked GROUP BY metric_key,unit HAVING COUNT(*)>=2`,
        [start, effectiveEnd],
      ),
      this.db.select<{ entry_date: string; calories: number; protein: number }[]>(
        `SELECT entry_date,SUM(COALESCE(CAST(json_extract(nutrients_json,'$.energy_kcal') AS REAL),0)) calories,SUM(COALESCE(CAST(json_extract(nutrients_json,'$.protein_g') AS REAL),0)) protein FROM food_diary_entries WHERE entry_date BETWEEN $1 AND $2 GROUP BY entry_date`,
        [start, effectiveEnd],
      ),
      new EnergyRepository(this.db).range(start, effectiveEnd),
      this.db.select<{ transaction_type: string; amount: number }[]>(
        `SELECT transaction_type,SUM(amount_cents) amount FROM finance_transactions WHERE date BETWEEN $1 AND $2 AND transaction_type!='transfer' GROUP BY transaction_type`,
        [start, effectiveEnd],
      ),
      this.db.select<{ name: string; amount: number }[]>(
        `SELECT COALESCE(c.name,'Sem categoria') name,SUM(t.amount_cents) amount FROM finance_transactions t LEFT JOIN finance_categories c ON c.id=t.category_id WHERE t.date BETWEEN $1 AND $2 AND t.transaction_type='expense' GROUP BY t.category_id ORDER BY amount DESC LIMIT 3`,
        [start, effectiveEnd],
      ),
      this.db.select<{ privateMode: number; hideFinance: number }[]>(
        `SELECT CASE WHEN (SELECT value FROM settings WHERE key='timeline_private')='1' THEN 1 ELSE 0 END privateMode,COALESCE((SELECT hide_values FROM finance_preferences WHERE id=1),0) hideFinance`,
      ),
      this.db.select<{ id: string; title: string; date: string; objectiveId: string | null }[]>(
        `SELECT * FROM(SELECT id,title,event_date date,objective_id objectiveId FROM timeline_notes WHERE event_date BETWEEN $1 AND $2 UNION ALL SELECT id,'Objetivo concluído: '||name,date(completed_at,'localtime'),id FROM objectives WHERE date(completed_at,'localtime') BETWEEN $1 AND $2 UNION ALL SELECT id,'Projeto concluído: '||name,date(completed_at,'localtime'),NULL FROM projects WHERE date(completed_at,'localtime') BETWEEN $1 AND $2) ORDER BY date DESC LIMIT 8`,
        [start, effectiveEnd],
      ),
      this.db.select<{ content: string }[]>(
        'SELECT content FROM monthly_review_notes WHERE month_start=$1',
        [start],
      ),
      this.db.select<{ workouts: number; averageSteps: number; registeredDays: number }[]>(
        `SELECT (SELECT COUNT(*) FROM workout_sessions WHERE status='completed' AND session_date BETWEEN $1 AND $2) workouts,COALESCE((SELECT ROUND(AVG(steps)) FROM daily_activity_entries WHERE entry_date BETWEEN $1 AND $2),0) averageSteps,(SELECT COUNT(*) FROM daily_activity_entries WHERE entry_date BETWEEN $1 AND $2) registeredDays`,
        [previousStart, previousEnd],
      ),
    ]);
    let habitDone = 0,
      habitTarget = 0;
    for (const raw of habits) {
      const h: Habit = { ...raw, active: 1, archived_at: null, weekdays: JSON.parse(raw.weekdays) };
      const eligible = dates.filter(
        (d) =>
          habitEligible(h, d) && (raw.archived_at === null || d < raw.archived_at.slice(0, 10)),
      );
      const groups = new Map<string, string[]>();
      for (const d of eligible) {
        const key = h.frequency === 'weekly_target' ? weekStart(d) : start;
        groups.set(key, [...(groups.get(key) ?? []), d]);
      }
      for (const group of groups.values()) {
        const target =
          h.frequency === 'weekly_target' ? Math.min(h.weekly_target, group.length) : group.length;
        habitTarget += target;
        habitDone += Math.min(
          target,
          entries.filter(
            (e) => e.habit_id === h.id && group.includes(e.entry_date) && habitReached(h, e.value),
          ).length,
        );
      }
    }
    const privateMode = Boolean(privacy[0]?.privateMode),
      hidden = privateMode || Boolean(privacy[0]?.hideFinance),
      totalSteps = steps.reduce((sum, r) => sum + r.steps, 0),
      balances = energy.filter((d) => d.balance !== null);
    return {
      start,
      end,
      effectiveEnd,
      elapsedDays: dates.length,
      monthDays: Number(end.slice(8)),
      privateMode,
      tasks: taskCounts[0],
      projects: {
        completed: projects[0]?.completed ?? 0,
        withActivity: projects[0]?.withActivity ?? 0,
      },
      objectives: {
        active: objectiveCounts[0]?.active ?? 0,
        completed: objectiveCounts[0]?.completed ?? 0,
        withActivity: objectiveUpdates.length,
        updates: privateMode ? [] : objectiveUpdates.slice(0, 5),
      },
      milestones,
      habits: { done: habitDone, target: habitTarget },
      routines: routines[0]?.count ?? 0,
      workouts: {
        sessions: workouts.length,
        minutes: workouts.reduce(
          (sum, w) =>
            sum + Math.max(0, (Date.parse(w.finished_at) - Date.parse(w.started_at)) / 60000),
          0,
        ),
        estimatedCalories: workouts.reduce(
          (sum, w) =>
            sum +
            (w.weight === null && w.method !== 'manual'
              ? 0
              : workoutCalories(
                  w.method
                    ? { method: w.method, minutes: w.minutes, met: w.met, calories: w.calories }
                    : undefined,
                  w.weight ?? 0,
                  Math.min(
                    240,
                    Math.max(0, (Date.parse(w.finished_at) - Date.parse(w.started_at)) / 60000),
                  ),
                )),
          0,
        ),
        volumes,
      },
      focus: { sessions: focusCount[0]?.count ?? 0, seconds: focusedSeconds },
      planningSeconds,
      activity: {
        days: steps.length,
        steps: totalSteps,
        average: steps.length ? Math.round(totalSteps / steps.length) : 0,
      },
      body: privateMode ? [] : body,
      nutrition: {
        days: nutrition.length,
        caloriesAverage: nutrition.length
          ? nutrition.reduce((sum, d) => sum + d.calories, 0) / nutrition.length
          : 0,
        proteinAverage: nutrition.length
          ? nutrition.reduce((sum, d) => sum + d.protein, 0) / nutrition.length
          : 0,
        balance: balances.length ? balances.reduce((sum, d) => sum + d.balance!, 0) : null,
        balanceDays: balances.length,
      },
      finance: {
        hidden,
        income: hidden ? 0 : (finance.find((f) => f.transaction_type === 'income')?.amount ?? 0),
        expense: hidden ? 0 : (finance.find((f) => f.transaction_type === 'expense')?.amount ?? 0),
        categories: hidden ? [] : categoryRows,
      },
      moments: privateMode ? [] : moments,
      note: privateMode ? '' : (notes[0]?.content ?? ''),
      previous: { month: previousStart, ...previous[0] },
    };
  }
  async saveNote(month: string, content: string) {
    if (content.length > 8000) throw Error('A nota deve ter até 8.000 caracteres.');
    const start = monthStart(month);
    if (!content.trim()) {
      await this.db.execute('DELETE FROM monthly_review_notes WHERE month_start=$1', [start]);
      return;
    }
    await this.db.execute(
      `INSERT INTO monthly_review_notes(month_start,content,updated_at) VALUES($1,$2,$3) ON CONFLICT(month_start) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at`,
      [start, content, new Date().toISOString()],
    );
  }
}
