import type { SqlConnection } from '../../lib/database/connection';
import { addDays } from '../../lib/dates';
import { habitEligible, habitReached, weekStart, type Habit } from '../habits/domain';
import { routineEligible, type Routine } from '../routines/domain';
import { WorkoutScheduleRepository } from '../workouts/repositories/schedule';
import { EnergyRepository } from '../energy/repository';
import { occursOn } from '../tasks/domain';
import type { Task } from '../../types/models';
import { ObjectivesRepository } from '../objectives/repository';
import { PlannerRepository, FocusRepository } from '../calendar/planner-repository';
import { MilestonesRepository, type Milestone } from '../objectives/milestones-repository';

type Count = { count: number };
export interface WeeklyReviewData {
  start: string;
  end: string;
  tasks: { completed: number; pending: number; overdue: number; pendingTitles: string[] };
  projects: {
    active: number;
    withActivity: number;
    withoutActivity: number;
    rows: { id: string; name: string; completed: number; total: number; completedWeek: number }[];
  };
  habits: {
    done: number;
    target: number;
    rows: { id: string; name: string; done: number; target: number; needsAttention: boolean }[];
  };
  routines: { id: string; name: string; done: number; target: number }[];
  workouts: { completed: number; planned: number; minutes: number; estimatedCalories: number };
  body: { firstWeight: number | null; lastWeight: number | null };
  activity: { days: number; steps: number; average: number };
  nutrition: {
    days: number;
    caloriesAverage: number;
    proteinAverage: number;
    estimatedBalance: number | null;
    balanceDays: number;
  };
  finance: {
    income: number;
    expense: number;
    hidden: boolean;
    expenseTrendPercent: number | null;
  };
  next: { tasks: number; workouts: number; bills: number; projectDeadlines: number };
  objectives: { id: string; name: string; activities: number }[];
  note: string;
  planning: {
    plannedSeconds: number;
    focusedSeconds: number;
    planned: number;
    completed: number;
    skipped: number;
    cancelled: number;
  };
  milestones: Milestone[];
  reflection: {
    workedWell: string;
    didNotWork: string;
    changeNext: string;
    prioritiesNext: string;
  };
  finalizedAt: string | null;
}

type SnapshotRow = {
  snapshot_json: string;
  worked_well: string;
  did_not_work: string;
  change_next: string;
  priorities_next: string;
  finalized_at: string | null;
};

export class WeeklyReviewRepository {
  constructor(private db: SqlConnection) {}

  async load(day: string, today = day): Promise<WeeklyReviewData> {
    const start = weekStart(day);
    const end = addDays(start, 6);
    const nextStart = addDays(start, 7);
    const nextEnd = addDays(start, 13);
    const [
      taskCompletions,
      pendingCounts,
      pendingTasks,
      projectRows,
      habits,
      habitEntries,
      routines,
      routineOccurrences,
      workoutRows,
      bodyRows,
      activityRows,
      nutritionRows,
      financeRows,
      previousFinanceRows,
      financePrivacy,
      upcomingTasks,
      upcomingRecurring,
      upcomingProjects,
      recurring,
      noteRows,
      scheduled,
      upcomingWorkouts,
      energy,
      objectiveRows,
      plannedSeconds,
      focusedSeconds,
      milestones,
      planningStatuses,
      snapshotRows,
    ] = await Promise.all([
      this.db.select<Count[]>(
        `SELECT (SELECT COUNT(*) FROM task_completions c JOIN tasks t ON t.id=c.task_id WHERE c.occurrence_date BETWEEN $1 AND $2 AND t.deleted_at IS NULL)+(SELECT COUNT(*) FROM tasks WHERE recurrence IS NULL AND deleted_at IS NULL AND status='completed' AND date(completed_at,'localtime') BETWEEN $1 AND $2) count`,
        [start, end],
      ),
      this.db.select<{ pending: number; overdue: number }[]>(
        `SELECT COUNT(*) pending,SUM(CASE WHEN due_date<$1 AND recurrence IS NULL THEN 1 ELSE 0 END) overdue FROM tasks WHERE archived_at IS NULL AND deleted_at IS NULL AND status='pending'`,
        [today],
      ),
      this.db.select<{ title: string; due_date: string | null }[]>(
        `SELECT title,due_date FROM tasks WHERE archived_at IS NULL AND deleted_at IS NULL AND status='pending' AND recurrence IS NULL AND due_date<=$1 ORDER BY due_date LIMIT 5`,
        [end],
      ),
      this.db.select<
        {
          name: string;
          id: string;
          total: number;
          completed: number;
          completedWeek: number;
          activeWeek: number;
        }[]
      >(
        `SELECT p.id,p.name,COUNT(t.id) total,SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) completed,SUM(CASE WHEN date(t.completed_at,'localtime') BETWEEN $1 AND $2 THEN 1 ELSE 0 END) completedWeek,MAX(CASE WHEN date(t.updated_at,'localtime') BETWEEN $1 AND $2 THEN 1 ELSE 0 END) activeWeek FROM projects p LEFT JOIN tasks t ON t.project_id=p.id AND t.archived_at IS NULL AND t.deleted_at IS NULL WHERE p.archived_at IS NULL AND p.deleted_at IS NULL AND p.status='active' GROUP BY p.id ORDER BY activeWeek DESC,p.name`,
        [start, end],
      ),
      this.db.select<(Omit<Habit, 'weekdays'> & { weekdays: string })[]>(
        `SELECT * FROM habits WHERE active=1 AND archived_at IS NULL AND start_date<=$1 AND (end_date IS NULL OR end_date>=$2)`,
        [end, start],
      ),
      this.db.select<{ habit_id: string; entry_date: string; value: number }[]>(
        `SELECT habit_id,entry_date,value FROM habit_entries WHERE entry_date BETWEEN $1 AND $2`,
        [start, end],
      ),
      this.db.select<(Omit<Routine, 'weekdays'> & { weekdays: string })[]>(
        `SELECT * FROM routines WHERE active=1 AND archived_at IS NULL`,
      ),
      this.db.select<
        { routine_id: string; occurrence_date: string; completed_at: string | null }[]
      >(
        `SELECT routine_id,occurrence_date,completed_at FROM routine_occurrences WHERE occurrence_date BETWEEN $1 AND $2`,
        [start, end],
      ),
      this.db.select<{ started_at: string; finished_at: string; calories: number | null }[]>(
        `SELECT s.started_at,s.finished_at,e.calories FROM workout_sessions s LEFT JOIN workout_session_energy e ON e.session_id=s.id WHERE s.status='completed' AND s.session_date BETWEEN $1 AND $2`,
        [start, end],
      ),
      this.db.select<{ value: number }[]>(
        `SELECT value FROM body_measurement_values WHERE metric_key='weight' AND record_date BETWEEN $1 AND $2 ORDER BY record_date`,
        [start, end],
      ),
      this.db.select<{ steps: number }[]>(
        `SELECT steps FROM daily_activity_entries WHERE entry_date BETWEEN $1 AND $2`,
        [start, end],
      ),
      this.db.select<{ entry_date: string; calories: number; protein: number }[]>(
        `SELECT entry_date,SUM(COALESCE(CAST(json_extract(nutrients_json,'$.energy_kcal') AS REAL),0)) calories,SUM(COALESCE(CAST(json_extract(nutrients_json,'$.protein_g') AS REAL),0)) protein FROM food_diary_entries WHERE entry_date BETWEEN $1 AND $2 GROUP BY entry_date`,
        [start, end],
      ),
      this.db.select<{ transaction_type: string; amount: number }[]>(
        `SELECT transaction_type,SUM(amount_cents) amount FROM finance_transactions WHERE date BETWEEN $1 AND $2 AND transaction_type!='transfer' GROUP BY transaction_type`,
        [start, end],
      ),
      this.db.select<{ amount: number }[]>(
        `SELECT coalesce(sum(amount_cents),0) amount FROM finance_transactions
         WHERE date BETWEEN $1 AND $2 AND transaction_type='expense'`,
        [addDays(start, -7), addDays(end, -7)],
      ),
      this.db.select<{ hide_values: number }[]>(
        `SELECT hide_values FROM finance_preferences WHERE id=1`,
      ),
      this.db.select<Count[]>(
        `SELECT COUNT(*) count FROM tasks WHERE recurrence IS NULL AND due_date BETWEEN $1 AND $2 AND status='pending' AND archived_at IS NULL AND deleted_at IS NULL`,
        [nextStart, nextEnd],
      ),
      this.db.select<(Omit<Task, 'recurrence'> & { recurrence: string })[]>(
        `SELECT * FROM tasks WHERE recurrence IS NOT NULL AND due_date<=$1 AND status='pending' AND archived_at IS NULL AND deleted_at IS NULL`,
        [nextEnd],
      ),
      this.db.select<Count[]>(
        `SELECT COUNT(*) count FROM projects WHERE target_date BETWEEN $1 AND $2 AND archived_at IS NULL AND deleted_at IS NULL`,
        [nextStart, nextEnd],
      ),
      this.db.select<{ day_of_month: number }[]>(
        `SELECT day_of_month FROM finance_recurring WHERE active=1`,
      ),
      this.db.select<{ content: string }[]>(
        `SELECT content FROM weekly_review_notes WHERE week_start=$1`,
        [start],
      ),
      new WorkoutScheduleRepository(this.db).range(start, end),
      new WorkoutScheduleRepository(this.db).range(nextStart, nextEnd),
      new EnergyRepository(this.db).range(start, end),
      new ObjectivesRepository(this.db).weekActivity(start, end),
      new PlannerRepository(this.db).plannedSeconds(start, end),
      new FocusRepository(this.db).seconds(start, end),
      new MilestonesRepository(this.db).completedRange(start, end),
      this.db.select<{ planned: number; completed: number; skipped: number; cancelled: number }[]>(
        `SELECT COUNT(*) planned,
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
          SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) skipped,
          SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled
         FROM planner_time_blocks WHERE block_date BETWEEN $1 AND $2`,
        [start, end],
      ),
      this.db.select<SnapshotRow[]>(
        'SELECT snapshot_json,worked_well,did_not_work,change_next,priorities_next,finalized_at FROM weekly_review_snapshots WHERE week_start=$1',
        [start],
      ),
    ]);
    const effectiveEnd = today < end ? today : end;
    let habitDone = 0,
      habitTarget = 0;
    const habitRows = habits
      .map((raw) => {
        const h: Habit = { ...raw, weekdays: JSON.parse(raw.weekdays) as number[] };
        const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter(
          (d) => d <= effectiveEnd && habitEligible(h, d),
        );
        const target =
          h.frequency === 'weekly_target' ? Math.min(h.weekly_target, dates.length) : dates.length;
        const done = Math.min(
          target,
          habitEntries.filter(
            (e) => e.habit_id === h.id && dates.includes(e.entry_date) && habitReached(h, e.value),
          ).length,
        );
        habitDone += done;
        habitTarget += target;
        return {
          id: h.id,
          name: h.name,
          done,
          target,
          needsAttention: target >= 2 && done / target < 0.5,
        };
      })
      .filter((row) => row.target > 0);
    const routineRows = routines
      .map((raw) => {
        const r: Routine = { ...raw, weekdays: JSON.parse(raw.weekdays) as number[] };
        const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter(
          (d) => d <= effectiveEnd && routineEligible(r, d),
        );
        return {
          id: r.id,
          name: r.name,
          target: dates.length,
          done: routineOccurrences.filter(
            (o) => o.routine_id === r.id && !!o.completed_at && dates.includes(o.occurrence_date),
          ).length,
        };
      })
      .filter((row) => row.target > 0);
    const steps = activityRows.reduce((sum, row) => sum + row.steps, 0);
    const balanceRows = energy.filter((row) => row.day <= effectiveEnd && row.balance !== null);
    const income = financeRows.find((row) => row.transaction_type === 'income')?.amount ?? 0;
    const expense = financeRows.find((row) => row.transaction_type === 'expense')?.amount ?? 0;
    const recurringTaskCount = upcomingRecurring.reduce((sum, row) => {
      const task: Task = { ...row, recurrence: JSON.parse(row.recurrence) as Task['recurrence'] };
      return (
        sum +
        Array.from({ length: 7 }, (_, i) => addDays(nextStart, i)).filter((date) =>
          occursOn(task, date),
        ).length
      );
    }, 0);
    const billCount = Array.from({ length: 7 }, (_, i) => addDays(nextStart, i)).reduce(
      (sum, date) => {
        const last = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
        return (
          sum +
          recurring.filter((r) => Math.min(r.day_of_month, last) === Number(date.slice(8))).length
        );
      },
      0,
    );
    const snapshot = snapshotRows[0];
    const reflection = {
      workedWell: snapshot?.worked_well ?? noteRows[0]?.content ?? '',
      didNotWork: snapshot?.did_not_work ?? '',
      changeNext: snapshot?.change_next ?? '',
      prioritiesNext: snapshot?.priorities_next ?? '',
    };
    const live: WeeklyReviewData = {
      planning: {
        plannedSeconds,
        focusedSeconds,
        planned: planningStatuses[0]?.planned ?? 0,
        completed: planningStatuses[0]?.completed ?? 0,
        skipped: planningStatuses[0]?.skipped ?? 0,
        cancelled: planningStatuses[0]?.cancelled ?? 0,
      },
      milestones,
      start,
      end,
      tasks: {
        completed: taskCompletions[0]?.count ?? 0,
        pending: pendingCounts[0]?.pending ?? 0,
        overdue: pendingCounts[0]?.overdue ?? 0,
        pendingTitles: pendingTasks.map((t) => t.title),
      },
      projects: {
        active: projectRows.length,
        withActivity: projectRows.filter((p) => p.activeWeek).length,
        withoutActivity: projectRows.filter((p) => !p.activeWeek).length,
        rows: projectRows
          .filter((p) => p.activeWeek)
          .slice(0, 5)
          .map((p) => ({
            id: p.id,
            name: p.name,
            total: p.total,
            completed: p.completed ?? 0,
            completedWeek: p.completedWeek ?? 0,
          })),
      },
      habits: { done: habitDone, target: habitTarget, rows: habitRows.slice(0, 5) },
      routines: routineRows.slice(0, 5),
      workouts: {
        completed: workoutRows.length,
        planned: scheduled.length,
        minutes: workoutRows.reduce(
          (sum, row) =>
            sum + Math.max(0, (Date.parse(row.finished_at) - Date.parse(row.started_at)) / 60000),
          0,
        ),
        estimatedCalories: workoutRows.reduce((sum, row) => sum + (row.calories ?? 0), 0),
      },
      body: {
        firstWeight: bodyRows.length > 1 ? bodyRows[0].value : null,
        lastWeight: bodyRows.length > 1 ? bodyRows.at(-1)!.value : null,
      },
      activity: {
        days: activityRows.length,
        steps,
        average: activityRows.length ? Math.round(steps / activityRows.length) : 0,
      },
      nutrition: {
        days: nutritionRows.length,
        caloriesAverage: nutritionRows.length
          ? nutritionRows.reduce((sum, row) => sum + row.calories, 0) / nutritionRows.length
          : 0,
        proteinAverage: nutritionRows.length
          ? nutritionRows.reduce((sum, row) => sum + row.protein, 0) / nutritionRows.length
          : 0,
        estimatedBalance: balanceRows.length
          ? balanceRows.reduce((sum, row) => sum + row.balance!, 0)
          : null,
        balanceDays: balanceRows.length,
      },
      finance: {
        income,
        expense,
        hidden: !!financePrivacy[0]?.hide_values,
        expenseTrendPercent:
          (previousFinanceRows[0]?.amount ?? 0) > 0
            ? Math.round(
                ((expense - previousFinanceRows[0].amount) / previousFinanceRows[0].amount) * 1000,
              ) / 10
            : null,
      },
      next: {
        tasks: (upcomingTasks[0]?.count ?? 0) + recurringTaskCount,
        workouts: upcomingWorkouts.filter((row) => !row.session_id).length,
        bills: billCount,
        projectDeadlines: upcomingProjects[0]?.count ?? 0,
      },
      note: noteRows[0]?.content ?? '',
      objectives: objectiveRows,
      reflection,
      finalizedAt: snapshot?.finalized_at ?? null,
    };
    if (!snapshot?.finalized_at) return live;
    try {
      const frozen = JSON.parse(snapshot.snapshot_json) as WeeklyReviewData;
      return {
        ...frozen,
        reflection,
        finalizedAt: snapshot.finalized_at,
        finance: {
          ...frozen.finance,
          hidden: live.finance.hidden,
          income: live.finance.hidden ? 0 : frozen.finance.income,
          expense: live.finance.hidden ? 0 : frozen.finance.expense,
        },
      };
    } catch {
      return live;
    }
  }

  async saveNote(week: string, content: string) {
    const start = weekStart(week);
    await this.db.execute(
      `INSERT INTO weekly_review_notes(week_start,content,updated_at) VALUES($1,$2,$3) ON CONFLICT(week_start) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at`,
      [start, content, new Date().toISOString()],
    );
  }

  async saveReflection(week: string, reflection: WeeklyReviewData['reflection']): Promise<void> {
    const start = weekStart(week);
    const end = addDays(start, 6);
    const now = new Date().toISOString();
    for (const value of Object.values(reflection))
      if (value.length > 4000) throw Error('Cada resposta deve ter até 4.000 caracteres.');
    await this.db.execute(
      `INSERT INTO weekly_review_snapshots(
        week_start,week_end,worked_well,did_not_work,change_next,priorities_next,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT(week_start) DO UPDATE SET worked_well=excluded.worked_well,
        did_not_work=excluded.did_not_work,change_next=excluded.change_next,
        priorities_next=excluded.priorities_next,updated_at=excluded.updated_at`,
      [
        start,
        end,
        reflection.workedWell.trim(),
        reflection.didNotWork.trim(),
        reflection.changeNext.trim(),
        reflection.prioritiesNext.trim(),
        now,
      ],
    );
  }

  async finalize(week: string, data: WeeklyReviewData): Promise<void> {
    const start = weekStart(week);
    const end = addDays(start, 6);
    const now = new Date().toISOString();
    const frozen = { ...data, finalizedAt: now };
    await this.db.execute(
      `INSERT INTO weekly_review_snapshots(
        week_start,week_end,snapshot_json,worked_well,did_not_work,change_next,priorities_next,
        finalized_at,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8)
       ON CONFLICT(week_start) DO UPDATE SET snapshot_json=excluded.snapshot_json,
        worked_well=excluded.worked_well,did_not_work=excluded.did_not_work,
        change_next=excluded.change_next,priorities_next=excluded.priorities_next,
        finalized_at=excluded.finalized_at,updated_at=excluded.updated_at`,
      [
        start,
        end,
        JSON.stringify(frozen),
        data.reflection.workedWell.trim(),
        data.reflection.didNotWork.trim(),
        data.reflection.changeNext.trim(),
        data.reflection.prioritiesNext.trim(),
        now,
      ],
    );
  }
}
