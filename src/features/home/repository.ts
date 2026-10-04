import type { SqlConnection } from '../../lib/database/connection';
import type { ProjectSummary } from '../projects/types';
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
