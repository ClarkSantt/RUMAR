import type { SqlConnection } from '../../lib/database/connection';
export async function convertInboxTo(
  db: SqlConnection,
  id: string,
  target: 'project' | 'thought',
): Promise<string> {
  const table = target === 'project' ? 'projects' : 'thoughts';
  const fields = target === 'project' ? 'name,description' : 'title,content';
  await db.execute(
    `INSERT INTO ${table}(id,${fields},source_inbox_id,created_at,updated_at) SELECT $1,substr(content,1,500),content,id,$3,$3 FROM inbox_items WHERE id=$2 AND status='pending' ON CONFLICT(source_inbox_id) DO NOTHING`,
    [crypto.randomUUID(), id, new Date().toISOString()],
  );
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM ${table} WHERE source_inbox_id=$1`,
    [id],
  );
  if (!rows.length) throw new Error('Este item já foi processado ou não está disponível.');
  return rows[0].id;
}
