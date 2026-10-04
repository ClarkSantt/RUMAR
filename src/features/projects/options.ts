import type { SqlConnection } from '../../lib/database/connection';
export async function projectOptions(db: SqlConnection) {
  const [projects, sections] = await Promise.all([
    db.select<{ id: string; name: string }[]>(
      'SELECT id,name FROM projects ORDER BY sort_order,created_at',
    ),
    db.select<{ id: string; project_id: string; name: string }[]>(
      'SELECT id,project_id,name FROM project_sections ORDER BY sort_order,created_at',
    ),
  ]);
  return { projects, sections };
}
