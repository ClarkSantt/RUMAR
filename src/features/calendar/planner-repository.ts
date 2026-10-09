import type { SqlConnection } from '../../lib/database/connection';
import { addDays, validDate } from '../../lib/dates';
import { calendarRange } from './repository';
import { CalendarPreferences } from './preferences';
import { minuteOf, timeOf, validateBlock, checkpointSeconds } from './planner-domain';
import { BlockSeriesRepository } from './block-series-repository';
import { parseRecurringBlockId, type BlockRecurrence } from './block-recurrence';
export type BlockSource = 'task' | 'routine' | 'workout' | 'habit';
export interface TimeBlock {
  series_id?: string;
  series_date?: string;
  recurrence?: BlockRecurrence;
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  entity_type: BlockSource | null;
  entity_id: string | null;
  occurrence_date: string | null;
  title: string;
  notes: string;
  remind_minutes_before: number | null;
  schedule_kind?: 'fixed' | 'period' | 'flexible';
  day_period?: 'morning' | 'afternoon' | 'evening' | null;
  position?: number;
  status?: 'planned' | 'completed' | 'skipped' | 'cancelled';
  completed_at?: string | null;
  title_snapshot?: string;
  source_type?: 'standalone' | 'task' | 'project' | 'habit' | 'workout' | 'event' | 'template';
  source_id?: string | null;
  created_at: string;
  updated_at: string;
  name: string;
  project_name: string | null;
  completed: number;
}
export type BlockDraft = Pick<
  TimeBlock,
  | 'block_date'
  | 'start_time'
  | 'end_time'
  | 'entity_type'
  | 'entity_id'
  | 'occurrence_date'
  | 'title'
  | 'notes'
  | 'remind_minutes_before'
>;
export interface PlannerPreferences {
  visual_start: number;
  visual_end: number;
  default_minutes: number;
  week_start: number;
}
export interface FocusSession {
  occurrence_date: string | null;
  id: string;
  task_id: string | null;
  time_block_id: string | null;
  objective_id: string | null;
  project_id: string | null;
  title: string;
  started_at: string;
  ended_at: string | null;
  focused_seconds: number;
  status: 'running' | 'paused' | 'completed';
  last_checkpoint: string;
}
export class PlannerRepository {
  constructor(private db: SqlConnection) {}
  async preferences() {
    return (
      await this.db.select<PlannerPreferences[]>('SELECT * FROM planner_preferences WHERE id=1')
    )[0];
  }
  async savePreferences(p: PlannerPreferences) {
    if (
      ![15, 30, 45, 60].includes(p.default_minutes) ||
      ![0, 1].includes(p.week_start) ||
      !Number.isInteger(p.visual_start) ||
      !Number.isInteger(p.visual_end) ||
      p.visual_start < 0 ||
      p.visual_end > 24 ||
      p.visual_end <= p.visual_start
    )
      throw Error('Preferências inválidas.');
    await this.db.execute(
      'UPDATE planner_preferences SET visual_start=$1,visual_end=$2,default_minutes=$3,week_start=$4 WHERE id=1',
      [p.visual_start, p.visual_end, p.default_minutes, p.week_start],
    );
  }
  async range(from: string, to: string) {
    const [individual, recurring] = await Promise.all([
      this.db.select<TimeBlock[]>(
        `SELECT b.*,coalesce(t.title,sp.name,r.name,w.name,h.name,pt.name,e.summary,nullif(b.title_snapshot,''),b.title) name,coalesce(p.name,sp.name) project_name,
 b.status='completed' completed
 FROM planner_time_blocks b LEFT JOIN tasks t ON b.source_type='task' AND t.id=b.source_id LEFT JOIN projects p ON p.id=t.project_id
 LEFT JOIN projects sp ON b.source_type='project' AND sp.id=b.source_id
 LEFT JOIN routines r ON b.entity_type='routine' AND r.id=b.entity_id
 LEFT JOIN workout_days w ON b.source_type='workout' AND w.id=b.source_id
 LEFT JOIN habits h ON b.source_type='habit' AND h.id=b.source_id
 LEFT JOIN planning_templates pt ON b.source_type='template' AND pt.id=b.source_id
 LEFT JOIN external_calendar_events e ON b.source_type='event' AND e.id=b.source_id
 WHERE b.block_date BETWEEN $1 AND $2 ORDER BY b.block_date,b.start_time,b.id`,
        [from, to],
      ),
      new BlockSeriesRepository(this.db).range(from, to),
    ]);
    return [...individual, ...recurring].sort(
      (a, b) =>
        a.block_date.localeCompare(b.block_date) || a.start_time.localeCompare(b.start_time),
    );
  }
  async visibleRange(from: string, to: string) {
    const [blocks, sources, overrides] = await Promise.all([
      this.range(from, to),
      new CalendarPreferences(this.db).sources(),
      new CalendarPreferences(this.db).overrides(),
    ]);
    return blocks.filter(
      (b) =>
        sources.find((s) => s.source_type === 'block')?.visible !== 0 &&
        sources.find((s) => s.source_type === b.entity_type)?.visible !== 0 &&
        !overrides.some(
          (o) =>
            ((o.entity_type === 'block' && o.entity_id === b.id) ||
              (o.entity_type === b.entity_type && o.entity_id === b.entity_id)) &&
            o.visible === 0,
        ),
    );
  }
  async save(d: BlockDraft, id?: string) {
    validateBlock(d.block_date, d.start_time, d.end_time);
    if ((!d.entity_type && !d.title.trim()) || d.title.length > 500 || d.notes.length > 4000)
      throw Error('Informe um título válido.');
    const now = new Date().toISOString();
    const next = id ?? crypto.randomUUID();
    if (id && parseRecurringBlockId(id)) {
      await new BlockSeriesRepository(this.db).override(id, d);
      return id;
    }
    // Source associations are immutable when editing; unlink by deleting only the block.
    if (id)
      await this.db.execute(
        'UPDATE planner_time_blocks SET block_date=$2,start_time=$3,end_time=$4,title=$5,title_snapshot=$5,notes=$6,remind_minutes_before=$7,updated_at=$8 WHERE id=$1',
        [
          id,
          d.block_date,
          d.start_time,
          d.end_time,
          d.title.trim(),
          d.notes.trim(),
          d.remind_minutes_before,
          now,
        ],
      );
    else
      await this.db.execute(
        `INSERT INTO planner_time_blocks(id,block_date,start_time,end_time,entity_type,entity_id,occurrence_date,title,notes,remind_minutes_before,created_at,updated_at,title_snapshot,source_type,source_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$8,CASE WHEN $5='routine' THEN 'template' ELSE coalesce($5,'standalone') END,$6)`,
        [
          next,
          d.block_date,
          d.start_time,
          d.end_time,
          d.entity_type,
          d.entity_id,
          d.occurrence_date,
          d.title.trim(),
          d.notes.trim(),
          d.remind_minutes_before,
          now,
        ],
      );
    return next;
  }
  async move(id: string, date: string, start: string, end: string) {
    validateBlock(date, start, end);
    const recurring = parseRecurringBlockId(id);
    if (recurring) {
      const original = (
        await new BlockSeriesRepository(this.db).range(recurring.date, recurring.date)
      ).find((b) => b.id === id);
      const [override] = await this.db.select<BlockDraft[]>(
        'SELECT * FROM planner_time_block_exceptions WHERE series_id=$1 AND occurrence_date=$2',
        [recurring.seriesId, recurring.date],
      );
      const series = await new BlockSeriesRepository(this.db).get(recurring.seriesId);
      if (!series) throw Error('Série não encontrada.');
      await new BlockSeriesRepository(this.db).override(id, {
        ...series,
        ...original,
        ...override,
        block_date: date,
        start_time: start,
        end_time: end,
        occurrence_date: recurring.date,
      });
      return;
    }
    await this.db.execute(
      'UPDATE planner_time_blocks SET block_date=$2,start_time=$3,end_time=$4,updated_at=$5 WHERE id=$1',
      [id, date, start, end, new Date().toISOString()],
    );
  }
  async remove(id: string) {
    const recurring = parseRecurringBlockId(id);
    if (recurring) {
      const s = await new BlockSeriesRepository(this.db).get(recurring.seriesId);
      if (s)
        await new BlockSeriesRepository(this.db).override(
          id,
          { ...s, block_date: recurring.date, occurrence_date: recurring.date },
          true,
        );
      return;
    }
    return this.db.execute('DELETE FROM planner_time_blocks WHERE id=$1', [id]);
  }
  duplicate(block: TimeBlock, date: string) {
    return this.save({ ...block, block_date: date });
  }
  async createTaskBlock(title: string, date: string, start: string, end: string) {
    validateBlock(date, start, end);
    if (!title.trim()) throw Error('Informe o título.');
    const id = crypto.randomUUID();
    await this.db.execute(
      'INSERT INTO planner_task_actions(id,title,block_date,start_time,end_time,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, title.trim(), date, start, end, new Date().toISOString()],
    );
    return id;
  }
  async candidates(day: string) {
    const [items, tasks] = await Promise.all([
      calendarRange(this.db, day, day),
      this.db.select<{ id: string; title: string; due_date: string | null }[]>(
        `SELECT id,title,due_date FROM tasks WHERE archived_at IS NULL AND status='pending' AND recurrence IS NULL AND (due_date IS NULL OR due_date<=$1) ORDER BY due_date IS NULL,due_date LIMIT 60`,
        [addDays(day, 7)],
      ),
    ]);
    const [sources, overrides] = await Promise.all([
      new CalendarPreferences(this.db).sources(),
      new CalendarPreferences(this.db).overrides(),
    ]);
    const allowed = (type: string, id: string) =>
      sources.find((s) => s.source_type === type)?.visible !== 0 &&
      !overrides.some((o) => o.entity_type === type && o.entity_id === id && o.visible === 0);
    const workoutDays = await this.db.select<{ id: string }[]>('SELECT id FROM workout_days');
    const result = items
      .filter(
        (i) =>
          ['task', 'routine', 'workout'].includes(i.kind) &&
          !i.completed &&
          !i.time &&
          (i.kind !== 'workout' || workoutDays.some((w) => w.id === i.id)),
      )
      .map((i) => ({ id: i.id, type: i.kind as BlockSource, name: i.name, date: i.date }));
    for (const t of tasks)
      if (allowed('task', t.id) && !result.some((i) => i.id === t.id && i.type === 'task'))
        result.push({ id: t.id, type: 'task', name: t.title, date: day });
    return result.slice(0, 60);
  }
  async plannedSeconds(from: string, to: string) {
    return (await this.range(from, to)).reduce(
      (total, b) => total + (minuteOf(b.end_time) - minuteOf(b.start_time)) * 60,
      0,
    );
  }
}
export class FocusRepository {
  constructor(private db: SqlConnection) {}
  async open() {
    return (
      (
        await this.db.select<FocusSession[]>(
          "SELECT * FROM focus_sessions WHERE status IN('running','paused') LIMIT 1",
        )
      )[0] ?? null
    );
  }
  async recover() {
    await this.db.execute(
      "UPDATE focus_sessions SET status='paused',last_checkpoint=$1 WHERE status='running'",
      [new Date().toISOString()],
    );
    return this.open();
  }
  async start(
    title: string,
    taskId: string | null = null,
    blockId: string | null = null,
    now = new Date().toISOString(),
    occurrenceDate: string | null = null,
    projectId: string | null = null,
  ) {
    if (occurrenceDate && !validDate(occurrenceDate)) throw Error('Ocorrência inválida.');
    const existing = await this.open();
    if (existing) throw Error('Você já possui uma sessão de foco. Continue ou encerre a atual.');
    const id = crypto.randomUUID();
    const recurring = blockId ? parseRecurringBlockId(blockId) : null;
    await this.db.execute(
      `INSERT INTO focus_sessions(id,task_id,time_block_id,objective_id,title,started_at,status,last_checkpoint,created_at,occurrence_date,time_block_series_id,time_block_series_date,project_id)
 VALUES($1,$2,$3,(SELECT l.objective_id FROM objective_links l WHERE (l.entity_type='task' AND l.entity_id=$2) OR (l.entity_type='project' AND l.entity_id=coalesce($9,(SELECT project_id FROM tasks WHERE id=$2))) ORDER BY l.created_at LIMIT 1),$4,$5,'running',$5,$5,CASE WHEN $2 IS NOT NULL OR $9 IS NOT NULL THEN coalesce($6,(SELECT coalesce(occurrence_date,block_date) FROM planner_time_blocks WHERE id=$3),date($5,'localtime')) ELSE NULL END,$7,$8,$9)`,
      [
        id,
        taskId,
        recurring ? null : blockId,
        title,
        now,
        occurrenceDate ?? recurring?.date ?? null,
        recurring?.seriesId ?? null,
        recurring?.date ?? null,
        projectId,
      ],
    );
    return (await this.open())!;
  }
  async checkpoint(id: string, now = new Date().toISOString()) {
    const [row] = await this.db.select<FocusSession[]>('SELECT * FROM focus_sessions WHERE id=$1', [
      id,
    ]);
    if (!row || row.status !== 'running') return;
    const seconds = checkpointSeconds(row.last_checkpoint, now);
    await this.db.execute(
      "UPDATE focus_sessions SET focused_seconds=focused_seconds+$2,last_checkpoint=$3 WHERE id=$1 AND status='running' AND last_checkpoint=$4",
      [id, seconds, now, row.last_checkpoint],
    );
  }
  async pause(id: string, now = new Date().toISOString()) {
    await this.checkpoint(id, now);
    await this.db.execute(
      "UPDATE focus_sessions SET status='paused',last_checkpoint=$2 WHERE id=$1 AND status='running'",
      [id, now],
    );
  }
  async resume(id: string, now = new Date().toISOString()) {
    await this.db.execute(
      "UPDATE focus_sessions SET status='running',last_checkpoint=$2 WHERE id=$1 AND status='paused'",
      [id, now],
    );
  }
  async finish(id: string, now = new Date().toISOString()) {
    await this.checkpoint(id, now);
    await this.db.execute(
      "UPDATE focus_sessions SET status='completed',ended_at=$2,last_checkpoint=$2 WHERE id=$1 AND status IN('running','paused')",
      [id, now],
    );
  }
  async seconds(from: string, to: string) {
    const [row] = await this.db.select<{ seconds: number }[]>(
      "SELECT coalesce(sum(focused_seconds),0) seconds FROM focus_sessions WHERE status='completed' AND date(ended_at,'localtime') BETWEEN $1 AND $2",
      [from, to],
    );
    return row.seconds;
  }
  async stats(from: string, to: string) {
    const totals = await this.db.select<
      {
        source_type: 'project' | 'task' | 'unlinked';
        source_id: string | null;
        title: string;
        seconds: number;
      }[]
    >(
      `SELECT CASE WHEN project_id IS NOT NULL THEN 'project' WHEN task_id IS NOT NULL THEN 'task' ELSE 'unlinked' END source_type,
       coalesce(project_id,task_id) source_id,
       CASE WHEN project_id IS NOT NULL THEN coalesce((SELECT name FROM projects WHERE id=project_id),title)
            WHEN task_id IS NOT NULL THEN coalesce((SELECT title FROM tasks WHERE id=task_id),title) ELSE title END title,
       sum(focused_seconds) seconds
       FROM focus_sessions WHERE status='completed' AND date(ended_at,'localtime') BETWEEN $1 AND $2
       GROUP BY source_type,source_id,title ORDER BY seconds DESC`,
      [from, to],
    );
    return {
      totalSeconds: totals.reduce((sum, row) => sum + row.seconds, 0),
      sources: totals,
    };
  }
  async objectiveSeconds(id: string) {
    const [row] = await this.db.select<{ seconds: number }[]>(
      `SELECT coalesce(sum(s.focused_seconds),0) seconds FROM focus_sessions s WHERE s.status='completed' AND (s.objective_id=$1 OR EXISTS(SELECT 1 FROM objective_links l WHERE l.objective_id=$1 AND ((l.entity_type='task' AND l.entity_id=s.task_id) OR (l.entity_type='project' AND l.entity_id=(SELECT project_id FROM tasks WHERE id=s.task_id)))))`,
      [id],
    );
    return row.seconds;
  }
}
export function defaultBlock(date: string, start = '09:00', minutes = 30): BlockDraft {
  return {
    block_date: date,
    start_time: start,
    end_time: timeOf(Math.min(1440, minuteOf(start) + minutes)),
    entity_type: null,
    entity_id: null,
    occurrence_date: null,
    title: '',
    notes: '',
    remind_minutes_before: null,
  };
}
