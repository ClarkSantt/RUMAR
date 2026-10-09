import type { SqlConnection } from '../../lib/database/connection';
import { addDays } from '../../lib/dates';
import type { ProjectSummary } from '../projects/types';

export interface HomePlanningItem {
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  schedule_kind: 'fixed' | 'period' | 'flexible';
  day_period: 'morning' | 'afternoon' | 'evening' | null;
  status: 'planned' | 'completed' | 'skipped' | 'cancelled';
  source_type: string;
  source_id: string | null;
  title: string;
}

export interface HomeDayData {
  planning: {
    now: HomePlanningItem | null;
    next: HomePlanningItem[];
    total: number;
    completed: number;
    pending: number;
    skipped: number;
  };
  overdue: { count: number; rows: { id: string; title: string; due_date: string }[] };
  habits: {
    id: string;
    name: string;
    value: number;
    target: number;
    unit: string;
    tracking_type: string;
    reached: number;
  }[];
  workout: { id: string; name: string; finished_at: string } | null;
  nutrition: { calories: number; protein: number; calorieGoal: number | null };
  finance: { hidden: boolean; expense: number };
  projects: ProjectSummary[];
}

const planningTitle = `coalesce(nullif(b.title_snapshot,''),nullif(b.title,''),
 CASE b.source_type
  WHEN 'task' THEN (SELECT title FROM tasks WHERE id=b.source_id)
  WHEN 'project' THEN (SELECT name FROM projects WHERE id=b.source_id)
  WHEN 'habit' THEN (SELECT name FROM habits WHERE id=b.source_id)
  WHEN 'workout' THEN (SELECT name FROM workout_days WHERE id=b.source_id)
  WHEN 'template' THEN (SELECT name FROM planning_templates WHERE id=b.source_id)
 END,'Planejamento')`;

export class HomeRepository {
  constructor(private db: SqlConnection) {}

  async day(day: string, time: string): Promise<HomeDayData> {
    const tomorrow = addDays(day, 1);
    const [
      todayPlanning,
      nextPlanning,
      overdueCount,
      overdueRows,
      habits,
      workout,
      nutrition,
      goals,
      finance,
      projects,
    ] = await Promise.all([
      this.db.select<HomePlanningItem[]>(
        `SELECT b.id,b.block_date,b.start_time,b.end_time,b.schedule_kind,b.day_period,b.status,
                  b.source_type,b.source_id,${planningTitle} title
           FROM planner_time_blocks b WHERE b.block_date=$1
           ORDER BY CASE b.schedule_kind WHEN 'fixed' THEN 0 WHEN 'period' THEN 1 ELSE 2 END,
                    b.start_time,b.position,b.created_at LIMIT 80`,
        [day],
      ),
      this.db.select<HomePlanningItem[]>(
        `SELECT b.id,b.block_date,b.start_time,b.end_time,b.schedule_kind,b.day_period,b.status,
                  b.source_type,b.source_id,${planningTitle} title
           FROM planner_time_blocks b
           WHERE b.status='planned' AND (
             (b.block_date=$1 AND (b.schedule_kind!='fixed' OR b.start_time>$2)) OR b.block_date=$3)
           ORDER BY b.block_date,CASE b.schedule_kind WHEN 'fixed' THEN 0 WHEN 'period' THEN 1 ELSE 2 END,
                    b.start_time,b.position,b.created_at LIMIT 4`,
        [day, time, tomorrow],
      ),
      this.db.select<{ count: number }[]>(
        `SELECT COUNT(*) count FROM tasks
           WHERE archived_at IS NULL AND status='pending' AND recurrence IS NULL AND due_date<$1`,
        [day],
      ),
      this.db.select<{ id: string; title: string; due_date: string }[]>(
        `SELECT id,title,due_date FROM tasks
           WHERE archived_at IS NULL AND status='pending' AND recurrence IS NULL AND due_date<$1
           ORDER BY priority='high' DESC,due_date,created_at LIMIT 4`,
        [day],
      ),
      this.db.select<HomeDayData['habits']>(
        `SELECT h.id,h.name,coalesce(e.value,0) value,h.target_value target,h.unit,h.tracking_type,
                  CASE WHEN coalesce(e.value,0)>=h.target_value THEN 1 ELSE 0 END reached
           FROM habits h LEFT JOIN habit_entries e ON e.habit_id=h.id AND e.entry_date=$1
           WHERE h.archived_at IS NULL AND h.active=1 AND h.start_date<=$1
             AND (h.end_date IS NULL OR h.end_date>=$1)
           ORDER BY reached,h.sort_order,h.created_at LIMIT 4`,
        [day],
      ),
      this.db.select<{ id: string; name: string; finished_at: string }[]>(
        `SELECT id,day_name name,finished_at FROM workout_sessions
           WHERE status='completed' AND session_date=$1 ORDER BY finished_at DESC LIMIT 1`,
        [day],
      ),
      this.db.select<{ calories: number; protein: number }[]>(
        `SELECT coalesce(SUM(CAST(json_extract(nutrients_json,'$.energy_kcal') AS REAL)),0) calories,
                  coalesce(SUM(CAST(json_extract(nutrients_json,'$.protein_g') AS REAL)),0) protein
           FROM food_diary_entries WHERE entry_date=$1`,
        [day],
      ),
      this.db.select<{ calories: number | null }[]>(
        'SELECT calories FROM nutrition_goals WHERE id=1',
      ),
      this.db.select<{ hidden: number; expense: number }[]>(
        `SELECT p.hide_values hidden,coalesce((SELECT SUM(amount_cents) FROM finance_transactions
             WHERE date=$1 AND transaction_type='expense'),0) expense
           FROM finance_preferences p WHERE p.id=1`,
        [day],
      ),
      this.db.select<ProjectSummary[]>(
        `SELECT p.*,
            (SELECT count(*) FROM tasks WHERE project_id=p.id AND archived_at IS NULL) task_count,
            (SELECT count(*) FROM tasks WHERE project_id=p.id AND archived_at IS NULL AND status='completed') completed_count,
            NULL next_task
           FROM projects p WHERE status='active' AND archived_at IS NULL
           ORDER BY p.updated_at DESC,p.sort_order LIMIT 2`,
      ),
    ]);
    const activeNow = todayPlanning.find(
      (item) =>
        item.status === 'planned' &&
        item.schedule_kind === 'fixed' &&
        item.start_time <= time &&
        item.end_time > time,
    );
    const fallback = todayPlanning.find(
      (item) =>
        item.status === 'planned' && item.schedule_kind === 'fixed' && item.start_time > time,
    );
    return {
      planning: {
        now: activeNow ?? fallback ?? nextPlanning[0] ?? null,
        next: nextPlanning.filter((item) => item.id !== (activeNow ?? fallback)?.id).slice(0, 4),
        total: todayPlanning.filter((item) => item.status !== 'cancelled').length,
        completed: todayPlanning.filter((item) => item.status === 'completed').length,
        pending: todayPlanning.filter((item) => item.status === 'planned').length,
        skipped: todayPlanning.filter((item) => item.status === 'skipped').length,
      },
      overdue: { count: overdueCount[0]?.count ?? 0, rows: overdueRows },
      habits,
      workout: workout[0] ?? null,
      nutrition: {
        calories: nutrition[0]?.calories ?? 0,
        protein: nutrition[0]?.protein ?? 0,
        calorieGoal: goals[0]?.calories ?? null,
      },
      finance: {
        hidden: Boolean(finance[0]?.hidden),
        expense: finance[0]?.expense ?? 0,
      },
      projects,
    };
  }
}

// Kept for small existing consumers; the new Home uses HomeRepository.day.
export async function homeOverview(db: SqlConnection, day: string, end: string) {
  const [projects, deadlines] = await Promise.all([
    db.select<ProjectSummary[]>(
      "SELECT p.*,(SELECT count(*) FROM tasks WHERE project_id=p.id AND archived_at IS NULL) task_count,(SELECT count(*) FROM tasks WHERE project_id=p.id AND archived_at IS NULL AND status='completed') completed_count,NULL next_task FROM projects p WHERE status='active' AND archived_at IS NULL ORDER BY sort_order,created_at LIMIT 3",
    ),
    db.select<{ id: string; name: string; date: string }[]>(
      "SELECT id,title name,due_date date FROM tasks WHERE archived_at IS NULL AND status='pending' AND recurrence IS NULL AND due_date>$1 AND due_date<=$2 UNION ALL SELECT id,name,target_date date FROM projects WHERE archived_at IS NULL AND status IN('active','paused') AND target_date>$1 AND target_date<=$2 ORDER BY date LIMIT 5",
      [day, end],
    ),
  ]);
  return { projects, deadlines };
}
