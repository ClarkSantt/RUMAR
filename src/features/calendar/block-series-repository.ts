import type { SqlConnection } from '../../lib/database/connection';
import type { BlockDraft, TimeBlock } from './planner-repository';
import { validateBlock } from './planner-domain';
import { validDate } from '../../lib/dates';
import {
  currentArchiveDate,
  expandBlockDates,
  parseRecurringBlockId,
  recurringBlockId,
  validateBlockRecurrence,
  type BlockRecurrence,
} from './block-recurrence';
export interface BlockSeries extends Omit<BlockDraft, 'block_date' | 'occurrence_date'> {
  id: string;
  start_date: string;
  recurrence_json: string;
  archived_from: string | null;
  created_at: string;
  updated_at: string;
  name: string;
  project_name: string | null;
}
interface Exception extends BlockDraft {
  series_id: string;
  cancelled: number;
  updated_at: string;
}
const seriesSelect = `SELECT s.*,coalesce(t.title,r.name,w.name,h.name,s.title) name,p.name project_name FROM planner_time_block_series s LEFT JOIN tasks t ON s.entity_type='task' AND t.id=s.entity_id LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN routines r ON s.entity_type='routine' AND r.id=s.entity_id LEFT JOIN workout_days w ON s.entity_type='workout' AND w.id=s.entity_id LEFT JOIN habits h ON s.entity_type='habit' AND h.id=s.entity_id`;
export class BlockSeriesRepository {
  constructor(private db: SqlConnection) {}
  async save(d: BlockDraft, rule: BlockRecurrence, id?: string) {
    validateBlock(d.block_date, d.start_time, d.end_time);
    validateBlockRecurrence(rule);
    if (
      (!d.entity_type && !d.title.trim()) ||
      d.title.length > 500 ||
      d.notes.length > 4000 ||
      (rule.until && rule.until < d.block_date)
    )
      throw Error('Dados da série inválidos.');
    if (d.entity_type) {
      const table = {
        task: 'tasks',
        routine: 'routines',
        workout: 'workout_days',
        habit: 'habits',
      }[d.entity_type];
      if (
        !(
          await this.db.select<{ id: string }[]>(`SELECT id FROM ${table} WHERE id=$1`, [
            d.entity_id,
          ])
        ).length
      )
        throw Error('Origem não encontrada.');
    }
    const next = id ?? crypto.randomUUID(),
      now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO planner_time_block_series(id,start_date,start_time,end_time,entity_type,entity_id,title,notes,remind_minutes_before,recurrence_json,created_at,updated_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) ON CONFLICT(id) DO UPDATE SET start_date=excluded.start_date,start_time=excluded.start_time,end_time=excluded.end_time,title=excluded.title,notes=excluded.notes,remind_minutes_before=excluded.remind_minutes_before,recurrence_json=excluded.recurrence_json,updated_at=excluded.updated_at`,
      [
        next,
        d.block_date,
        d.start_time,
        d.end_time,
        d.entity_type,
        d.entity_id,
        d.title.trim(),
        d.notes.trim(),
        d.remind_minutes_before,
        JSON.stringify(rule),
        now,
      ],
    );
    return next;
  }
  async get(id: string) {
    return (await this.db.select<BlockSeries[]>(`${seriesSelect} WHERE s.id=$1`, [id]))[0] ?? null;
  }
  async range(from: string, to: string): Promise<TimeBlock[]> {
    const [series, exceptions] = await Promise.all([
      this.db.select<BlockSeries[]>(
        `${seriesSelect} WHERE (s.start_date<=$2 AND (s.archived_from IS NULL OR s.archived_from>$1)) OR EXISTS(SELECT 1 FROM planner_time_block_exceptions e WHERE e.series_id=s.id AND e.cancelled=0 AND e.block_date BETWEEN $1 AND $2 AND (s.archived_from IS NULL OR e.occurrence_date<s.archived_from))`,
        [from, to],
      ),
      this.db.select<Exception[]>(
        'SELECT * FROM planner_time_block_exceptions WHERE occurrence_date BETWEEN $1 AND $2 OR block_date BETWEEN $1 AND $2',
        [from, to],
      ),
    ]);
    const result: TimeBlock[] = [];
    for (const s of series) {
      const rule = JSON.parse(s.recurrence_json) as BlockRecurrence;
      const dates = expandBlockDates(s.start_date, from, to, rule, s.archived_from);
      const own = exceptions.filter((e) => e.series_id === s.id);
      for (const e of own)
        if (
          !e.cancelled &&
          (!s.archived_from || e.occurrence_date! < s.archived_from) &&
          e.block_date >= from &&
          e.block_date <= to &&
          !dates.includes(e.occurrence_date!)
        )
          dates.push(e.occurrence_date!);
      for (const date of dates) {
        const e = own.find((e) => e.occurrence_date === date);
        if (e?.cancelled) continue;
        const target = e?.block_date ?? date;
        if (target < from || target > to) continue;
        result.push({
          ...s,
          ...e,
          id: recurringBlockId(s.id, date),
          block_date: target,
          occurrence_date: date,
          name: e?.title && !s.entity_type ? e.title : s.name,
          completed: 0,
          series_id: s.id,
          series_date: date,
          recurrence: rule,
        });
      }
    }
    if (!result.length) return result;
    const min = result.reduce((d, b) => (b.occurrence_date! < d ? b.occurrence_date! : d), from),
      max = result.reduce((d, b) => (b.occurrence_date! > d ? b.occurrence_date! : d), to);
    const [tasks, completions, routines, workouts] = await Promise.all([
      this.db.select<{ id: string; status: string; recurrence: string | null }[]>(
        "SELECT id,status,recurrence FROM tasks WHERE id IN(SELECT entity_id FROM planner_time_block_series WHERE entity_type='task')",
      ),
      this.db.select<{ task_id: string; occurrence_date: string }[]>(
        'SELECT task_id,occurrence_date FROM task_completions WHERE occurrence_date BETWEEN $1 AND $2',
        [min, max],
      ),
      this.db.select<{ routine_id: string; occurrence_date: string }[]>(
        'SELECT routine_id,occurrence_date FROM routine_occurrences WHERE completed_at IS NOT NULL AND occurrence_date BETWEEN $1 AND $2',
        [min, max],
      ),
      this.db.select<{ workout_day_id: string; session_date: string }[]>(
        "SELECT workout_day_id,session_date FROM workout_sessions WHERE status='completed' AND session_date BETWEEN $1 AND $2",
        [min, max],
      ),
    ]);
    for (const b of result) {
      const t = tasks.find((t) => t.id === b.entity_id);
      b.completed = Number(
        b.entity_type === 'task'
          ? t?.recurrence
            ? completions.some(
                (c) => c.task_id === b.entity_id && c.occurrence_date === b.occurrence_date,
              )
            : t?.status === 'completed'
          : b.entity_type === 'routine'
            ? routines.some(
                (r) => r.routine_id === b.entity_id && r.occurrence_date === b.occurrence_date,
              )
            : b.entity_type === 'workout'
              ? workouts.some(
                  (w) => w.workout_day_id === b.entity_id && w.session_date === b.occurrence_date,
                )
              : false,
      );
    }
    return result.sort(
      (a, b) =>
        a.block_date.localeCompare(b.block_date) || a.start_time.localeCompare(b.start_time),
    );
  }
  async override(id: string, d: BlockDraft, cancelled = false) {
    const parsed = parseRecurringBlockId(id);
    if (!parsed) throw Error('Ocorrência inválida.');
    validateBlock(d.block_date, d.start_time, d.end_time);
    if (d.title.length > 500 || d.notes.length > 4000)
      throw Error('Dados da ocorrência inválidos.');
    const s = await this.get(parsed.seriesId);
    if (
      !s ||
      !expandBlockDates(
        s.start_date,
        parsed.date,
        parsed.date,
        JSON.parse(s.recurrence_json),
        s.archived_from,
      ).length
    )
      throw Error('Ocorrência fora da série.');
    await this.db.execute(
      `INSERT INTO planner_time_block_exceptions(series_id,occurrence_date,cancelled,block_date,start_time,end_time,title,notes,remind_minutes_before,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(series_id,occurrence_date) DO UPDATE SET cancelled=excluded.cancelled,block_date=excluded.block_date,start_time=excluded.start_time,end_time=excluded.end_time,title=excluded.title,notes=excluded.notes,remind_minutes_before=excluded.remind_minutes_before,updated_at=excluded.updated_at`,
      [
        parsed.seriesId,
        parsed.date,
        Number(cancelled),
        d.block_date,
        d.start_time,
        d.end_time,
        d.title,
        d.notes,
        d.remind_minutes_before,
        new Date().toISOString(),
      ],
    );
  }
  async archive(id: string, from = currentArchiveDate()) {
    if (!validDate(from)) throw Error('Data inválida.');
    await this.db.execute(
      'UPDATE planner_time_block_series SET archived_from=$2,updated_at=$3 WHERE id=$1',
      [id, from, new Date().toISOString()],
    );
  }
}
