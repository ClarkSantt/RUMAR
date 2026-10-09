import type { SqlConnection } from '../../lib/database/connection';
import { localDate } from '../../lib/dates';
import { minuteOf, timeOf } from '../calendar/planner-domain';
import { parseNaturalSchedule } from '../quick-add/parser';

export type InboxTarget = 'project' | 'thought' | 'planning' | 'event' | 'habit';

export async function convertInboxTo(
  db: SqlConnection,
  id: string,
  target: InboxTarget,
): Promise<string> {
  const now = new Date().toISOString();
  if (target === 'project' || target === 'thought') {
    const table = target === 'project' ? 'projects' : 'thoughts';
    const fields = target === 'project' ? 'name,description' : 'title,content';
    await db.execute(
      `INSERT INTO ${table}(id,${fields},source_inbox_id,created_at,updated_at)
       SELECT $1,substr(content,1,500),CASE WHEN trim(notes)<>'' THEN notes ELSE content END,id,$3,$3
       FROM inbox_items WHERE id=$2 AND status='pending' ON CONFLICT(source_inbox_id) DO NOTHING`,
      [crypto.randomUUID(), id, now],
    );
    const rows = await db.select<{ id: string }[]>(
      `SELECT id FROM ${table} WHERE source_inbox_id=$1`,
      [id],
    );
    if (!rows.length) throw new Error('Este item já foi processado ou não está disponível.');
    await db.execute('UPDATE inbox_items SET capture_type=$2 WHERE id=$1', [id, target]);
    return rows[0].id;
  }
  const [item] = await db.select<{ content: string; notes: string }[]>(
    "SELECT content,notes FROM inbox_items WHERE id=$1 AND status='pending'",
    [id],
  );
  if (!item) throw new Error('Este item já foi processado ou não está disponível.');
  const key = crypto.randomUUID();
  if (target === 'habit') {
    await db.execute(
      `INSERT INTO habits(id,name,description,frequency,weekdays,weekly_target,kind,tracking_type,
       target_value,unit,start_date,active,source_inbox_id,created_at,updated_at)
       VALUES($1,$2,$3,'daily','[]',1,'boolean','check',1,'',$4,1,$5,$6,$6)`,
      [key, item.content.slice(0, 500), item.notes, localDate(), id, now],
    );
    return key;
  }
  const parsed = parseNaturalSchedule(item.content, localDate());
  const date = parsed.date ?? localDate();
  const start = parsed.time ?? '09:00';
  const end = timeOf(Math.min(1440, minuteOf(start) + 30));
  await db.execute("UPDATE inbox_items SET capture_type=$2 WHERE id=$1 AND status='pending'", [
    id,
    target,
  ]);
  await db.execute(
    `INSERT INTO planner_time_blocks(
      id,block_date,start_time,end_time,title,notes,remind_minutes_before,created_at,updated_at,
      schedule_kind,day_period,title_snapshot,source_type,source_id,source_inbox_id)
     SELECT $1,$2,$3,$4,$5,$6,NULL,$7,$7,$8,$9,$5,'standalone',NULL,id
     FROM inbox_items WHERE id=$10 AND status='pending'`,
    [
      key,
      date,
      start,
      end,
      (parsed.title || item.content).slice(0, 500),
      item.notes,
      now,
      parsed.time ? 'fixed' : parsed.dayPeriod ? 'period' : 'flexible',
      parsed.dayPeriod,
      id,
    ],
  );
  const rows = await db.select<{ id: string }[]>(
    'SELECT id FROM planner_time_blocks WHERE source_inbox_id=$1',
    [id],
  );
  if (!rows.length) throw new Error('Não foi possível criar o item planejado.');
  return rows[0].id;
}

export function inboxSuggestion(content: string, today = localDate()) {
  const parsed = parseNaturalSchedule(content, today);
  return { ...parsed, hasSchedule: Boolean(parsed.date || parsed.time || parsed.dayPeriod) };
}
