import type { SqlConnection } from '../../lib/database/connection';
import { calendarRange } from '../calendar/repository';
import { PlannerRepository } from '../calendar/planner-repository';
import { nutrientInfo, type Nutrients } from '../nutrition/domain';

export type CsvDataset =
  'tasks' | 'finance' | 'workouts' | 'body' | 'activity' | 'nutrition' | 'objectives';
export const csvOptions: { value: CsvDataset; label: string }[] = [
  { value: 'tasks', label: 'Tarefas' },
  { value: 'finance', label: 'Transações financeiras' },
  { value: 'workouts', label: 'Séries de treinos' },
  { value: 'body', label: 'Progresso corporal' },
  { value: 'activity', label: 'Atividade diária' },
  { value: 'nutrition', label: 'Diário alimentar' },
  { value: 'objectives', label: 'Objetivos' },
];

type Cell = string | number | null | undefined;
export function csvCell(value: Cell): string {
  let text = value == null ? '' : String(value);
  // Excel may evaluate cells beginning with formula sigils, including after whitespace.
  if (/^[=+@-]/.test(text.trimStart()) || (text.length > 0 && text.charCodeAt(0) < 32))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function csv(headers: string[], rows: Cell[][]): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

const money = (cents: number | null) =>
  cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',');
const number = (value: number | null) => (value == null ? '' : String(value).replace('.', ','));

export async function exportCsv(
  db: SqlConnection,
  dataset: CsvDataset,
  from: string,
  to: string,
): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from)
    throw new Error('Período inválido.');
  switch (dataset) {
    case 'tasks': {
      const rows = await db.select<
        {
          id: string;
          title: string;
          status: string;
          due_date: string | null;
          due_time: string | null;
          project: string | null;
          created_at: string;
          completed_at: string | null;
        }[]
      >(
        `SELECT t.id,t.title,t.status,t.due_date,t.due_time,p.name project,t.created_at,t.completed_at
         FROM tasks t LEFT JOIN projects p ON p.id=t.project_id
         WHERE COALESCE(t.due_date,substr(t.created_at,1,10)) BETWEEN $1 AND $2 ORDER BY COALESCE(t.due_date,substr(t.created_at,1,10)),t.id`,
        [from, to],
      );
      return csv(
        ['id', 'title', 'status', 'due_date', 'due_time', 'project', 'created_at', 'completed_at'],
        rows.map((r) => [
          r.id,
          r.title,
          r.status,
          r.due_date,
          r.due_time,
          r.project,
          r.created_at,
          r.completed_at,
        ]),
      );
    }
    case 'finance': {
      const rows = await db.select<
        {
          date: string;
          description: string;
          transaction_type: string;
          account: string;
          category: string | null;
          amount_cents: number;
          notes: string;
          created_at: string;
        }[]
      >(
        `SELECT t.date,t.description,t.transaction_type,a.name account,c.name category,t.amount_cents,t.notes,t.created_at
         FROM finance_transactions t JOIN finance_accounts a ON a.id=t.account_id
         LEFT JOIN finance_categories c ON c.id=t.category_id WHERE t.date BETWEEN $1 AND $2 ORDER BY t.date,t.id`,
        [from, to],
      );
      return csv(
        [
          'date',
          'description',
          'type',
          'account',
          'category',
          'amount_brl',
          'currency',
          'notes',
          'created_at',
        ],
        rows.map((r) => [
          r.date,
          r.description,
          r.transaction_type,
          r.account,
          r.category,
          money(r.amount_cents),
          'BRL',
          r.notes,
          r.created_at,
        ]),
      );
    }
    case 'workouts': {
      const rows = await db.select<
        {
          session_date: string;
          day_name: string;
          exercise_name: string;
          set_number: number;
          set_type: string;
          reps: number | null;
          load_value: number | null;
          load_type: string;
          completed: number;
          duration_minutes: number | null;
        }[]
      >(
        `SELECT s.session_date,s.day_name,e.exercise_name,w.set_number,w.set_type,w.reps,w.load_value,w.load_type,w.completed,
           CASE WHEN s.finished_at IS NOT NULL THEN CAST((julianday(s.finished_at)-julianday(s.started_at))*1440 AS INTEGER) END duration_minutes
         FROM workout_sessions s JOIN workout_session_exercises e ON e.workout_session_id=s.id
         JOIN workout_sets w ON w.session_exercise_id=e.id
         WHERE s.session_date BETWEEN $1 AND $2 AND s.status<>'discarded'
         ORDER BY s.session_date,s.id,e.sort_order,w.set_number`,
        [from, to],
      );
      return csv(
        [
          'date',
          'session',
          'exercise',
          'set',
          'set_type',
          'reps',
          'load',
          'load_type',
          'completed',
          'duration_minutes',
        ],
        rows.map((r) => [
          r.session_date,
          r.day_name,
          r.exercise_name,
          r.set_number,
          r.set_type,
          r.reps,
          number(r.load_value),
          r.load_type,
          r.completed,
          r.duration_minutes,
        ]),
      );
    }
    case 'body': {
      const rows = await db.select<Record<string, string | number | null>[]>(
        `SELECT r.measurement_date date,
           MAX(CASE WHEN v.metric_key='weight' THEN v.value END) weight_kg,
           MAX(CASE WHEN v.metric_key='body_fat' THEN v.value END) body_fat_pct,
           MAX(CASE WHEN v.metric_key='waist' THEN v.value END) waist_cm,
           MAX(CASE WHEN v.metric_key='chest' THEN v.value END) chest_cm,
           MAX(CASE WHEN v.metric_key='left_arm' THEN v.value END) left_arm_cm,
           MAX(CASE WHEN v.metric_key='right_arm' THEN v.value END) right_arm_cm,
           r.notes notes FROM body_measurement_records r LEFT JOIN body_measurement_values v ON v.record_date=r.measurement_date
         WHERE r.measurement_date BETWEEN $1 AND $2 GROUP BY r.measurement_date ORDER BY r.measurement_date`,
        [from, to],
      );
      const headers = [
        'date',
        'weight_kg',
        'body_fat_pct',
        'waist_cm',
        'chest_cm',
        'left_arm_cm',
        'right_arm_cm',
        'notes',
      ];
      return csv(
        headers,
        rows.map((r) =>
          headers.map((key) => (typeof r[key] === 'number' ? number(r[key] as number) : r[key])),
        ),
      );
    }
    case 'activity': {
      const rows = await db.select<{ entry_date: string; steps: number; notes: string }[]>(
        'SELECT entry_date,steps,notes FROM daily_activity_entries WHERE entry_date BETWEEN $1 AND $2 ORDER BY entry_date',
        [from, to],
      );
      return csv(
        ['date', 'steps', 'notes'],
        rows.map((r) => [r.entry_date, r.steps, r.notes]),
      );
    }
    case 'nutrition': {
      const rows = await db.select<
        {
          entry_date: string;
          meal_label: string;
          food_name: string;
          quantity: number;
          unit: string;
          grams_equivalent: number;
          nutrients_json: string;
        }[]
      >(
        `SELECT entry_date,meal_label,food_name,quantity,unit,grams_equivalent,nutrients_json
         FROM food_diary_entries WHERE entry_date BETWEEN $1 AND $2 ORDER BY entry_date,meal_label,id`,
        [from, to],
      );
      const keys = Object.keys(nutrientInfo) as (keyof Nutrients)[];
      return csv(
        ['date', 'meal', 'food', 'quantity', 'unit', 'grams', ...keys],
        rows.map((r) => {
          const nutrients = JSON.parse(r.nutrients_json) as Nutrients;
          return [
            r.entry_date,
            r.meal_label,
            r.food_name,
            number(r.quantity),
            r.unit,
            number(r.grams_equivalent),
            ...keys.map((key) => number(nutrients[key] ?? null)),
          ];
        }),
      );
    }
    case 'objectives': {
      const rows = await db.select<
        {
          name: string;
          status: string;
          category: string;
          start_date: string;
          target_date: string | null;
          progress_mode: string;
          description: string;
        }[]
      >(
        'SELECT name,status,category,start_date,target_date,progress_mode,description FROM objectives WHERE start_date BETWEEN $1 AND $2 ORDER BY start_date,id',
        [from, to],
      );
      return csv(
        [
          'objective',
          'status',
          'category',
          'start_date',
          'target_date',
          'progress_mode',
          'description',
        ],
        rows.map((r) => [
          r.name,
          r.status,
          r.category,
          r.start_date,
          r.target_date,
          r.progress_mode,
          r.description,
        ]),
      );
    }
  }
}

export function icsText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}
export function calendarIcs(
  events: { uid: string; summary: string; start: string; end?: string; description?: string }[],
): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RUMO//EN', 'CALSCALE:GREGORIAN'];
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}@rumo.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART${event.start.length === 8 ? ';VALUE=DATE' : ''}:${event.start}`,
    );
    if (event.end) lines.push(`DTEND${event.end.length === 8 ? ';VALUE=DATE' : ''}:${event.end}`);
    lines.push(`SUMMARY:${icsText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export async function exportCalendar(db: SqlConnection, from: string, to: string): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from)
    throw new Error('Período inválido.');
  const days = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days > 366)
    throw new Error('Exporte no máximo um ano por arquivo ICS.');
  const [items, blocks] = await Promise.all([
    calendarRange(db, from, to),
    new PlannerRepository(db).visibleRange(from, to),
  ]);
  const events = items.map((item) => {
    const day = item.date.replaceAll('-', '');
    const time = item.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) ? item.time : null;
    const start = time ? `${day}T${time.replace(':', '')}00` : day;
    const next = new Date(`${item.date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return {
      uid: `${item.kind}-${item.id}-${day}`.replace(/[^A-Za-z0-9_-]/g, '_'),
      summary: item.name,
      start,
      end: time ? undefined : next.toISOString().slice(0, 10).replaceAll('-', ''),
      description: item.completed ? 'Concluído no RUMO' : undefined,
    };
  });
  for (const block of blocks) {
    const day = block.block_date.replaceAll('-', '');
    const next = new Date(`${block.block_date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const endDay =
      block.end_time === '24:00' ? next.toISOString().slice(0, 10).replaceAll('-', '') : day;
    events.push({
      uid: `block-${block.id}-${day}`.replace(/[^A-Za-z0-9_-]/g, '_'),
      summary: block.name,
      start: `${day}T${block.start_time.replace(':', '')}00`,
      end: `${endDay}T${block.end_time === '24:00' ? '0000' : block.end_time.replace(':', '')}00`,
      description: block.notes || undefined,
    });
  }
  return calendarIcs(events);
}
