import type { SqlConnection } from '../../../lib/database/connection';
import { addDays, localDate, parseDate } from '../../../lib/dates';
import {
  blockRrule,
  eventFor,
  routineRrule,
  type GoogleSettings,
  type MirrorCandidate,
  type MirrorKey,
} from './domain';
import { expandBlockDates, type BlockRecurrence } from '../../calendar/block-recurrence';
import { occursOn } from '../../tasks/domain';
import type { Recurrence, Task as RumoTask } from '../../../types/models';

type NamedBlock = {
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  name: string;
  notes: string;
};
type Series = {
  id: string;
  start_date: string;
  start_time: string;
  end_time: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  name: string;
  recurrence_json: string;
  archived_from: string | null;
};
type Exception = {
  series_id: string;
  occurrence_date: string;
  cancelled: number;
  block_date: string;
  start_time: string;
  end_time: string;
  title: string;
};
type Routine = {
  id: string;
  name: string;
  frequency: 'daily' | 'weekdays';
  weekdays: string;
  time_of_day: string | null;
  active: number;
  archived_at: string | null;
};
type Workout = { id: string; name: string; weekday: number };
type Task = Omit<RumoTask, 'recurrence'> & { recurrence: string | null };
type Deadline = { id: string; name: string; target_date: string };
type Visibility = { entity_type: string; entity_id: string; visible: number };
type Source = { source_type: string; visible: number };
type ItemPreference = { entity_type: string; entity_id: string; enabled: number };

function plusMinutes(time: string, minutes: number) {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function exdate(date: string, time: string | null, zone: string) {
  const compact = date.replaceAll('-', '');
  return time
    ? `EXDATE;TZID=${zone}:${compact}T${time.replace(':', '')}00`
    : `EXDATE;VALUE=DATE:${compact}`;
}
function exactOccurrenceDates(
  start: string,
  from: string,
  to: string,
  rule: BlockRecurrence,
  archivedFrom: string | null,
) {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    const end = addDays(cursor, 365) < to ? addDays(cursor, 365) : to;
    dates.push(...expandBlockDates(start, cursor, end, rule, archivedFrom));
    cursor = addDays(end, 1);
  }
  return dates;
}
function nextWeekday(date: string, weekday: number) {
  const delta = (weekday - parseDate(date).getDay() + 7) % 7;
  return addDays(date, delta);
}

/** One bounded scan, no per-item database requests or future occurrence materialization. */
export async function collectGoogleCandidates(
  db: SqlConnection,
  settings: GoogleSettings,
  zone: string,
  from = settings.first_sync_from ?? localDate(),
  to = settings.sync_horizon_days === -1
    ? '9999-12-31'
    : addDays(localDate(), settings.sync_horizon_days),
): Promise<MirrorCandidate[]> {
  const [
    blocks,
    series,
    exceptions,
    routines,
    workouts,
    tasks,
    objectives,
    milestones,
    sources,
    visibility,
    itemPreferences,
  ] = await Promise.all([
    db.select<NamedBlock[]>(
      `SELECT b.*,coalesce(t.title,r.name,w.name,h.name,b.title) name FROM planner_time_blocks b
      LEFT JOIN tasks t ON b.entity_type='task' AND b.entity_id=t.id
      LEFT JOIN routines r ON b.entity_type='routine' AND b.entity_id=r.id
      LEFT JOIN workout_days w ON b.entity_type='workout' AND b.entity_id=w.id
      LEFT JOIN habits h ON b.entity_type='habit' AND b.entity_id=h.id
      WHERE b.block_date BETWEEN $1 AND $2`,
      [from, to],
    ),
    db.select<Series[]>(
      `SELECT s.*,coalesce(t.title,r.name,w.name,h.name,s.title) name FROM planner_time_block_series s
      LEFT JOIN tasks t ON s.entity_type='task' AND s.entity_id=t.id
      LEFT JOIN routines r ON s.entity_type='routine' AND s.entity_id=r.id
      LEFT JOIN workout_days w ON s.entity_type='workout' AND s.entity_id=w.id
      LEFT JOIN habits h ON s.entity_type='habit' AND s.entity_id=h.id
      WHERE s.start_date<=$1 AND (s.archived_from IS NULL OR s.archived_from>=$2)`,
      [to, from],
    ),
    // Exceptions are explicit edits, not generated occurrences. Keep future edits on an RRULE
    // even when the initial candidate scan is limited to the next 30/90 days.
    db.select<Exception[]>('SELECT * FROM planner_time_block_exceptions'),
    db.select<Routine[]>(
      'SELECT id,name,frequency,weekdays,time_of_day,active,archived_at FROM routines WHERE archived_at IS NULL AND active=1',
    ),
    db.select<Workout[]>(
      `SELECT d.id,d.name,w.weekday FROM workout_day_weekdays w JOIN workout_days d ON d.id=w.workout_day_id JOIN workout_plans p ON p.id=d.workout_plan_id WHERE p.active=1 AND p.archived_at IS NULL`,
    ),
    db.select<Task[]>(
      'SELECT * FROM tasks WHERE due_date<=$2 AND archived_at IS NULL AND (due_date>=$1 OR recurrence IS NOT NULL)',
      [from, to],
    ),
    db.select<Deadline[]>(
      'SELECT id,name,target_date FROM objectives WHERE target_date BETWEEN $1 AND $2 AND archived_at IS NULL',
      [from, to],
    ),
    db.select<Deadline[]>(
      `SELECT m.id,m.title name,m.target_date FROM objective_milestones m JOIN objectives o ON o.id=m.objective_id WHERE m.target_date BETWEEN $1 AND $2 AND o.archived_at IS NULL`,
      [from, to],
    ),
    db.select<Source[]>('SELECT source_type,visible FROM calendar_source_preferences'),
    db.select<Visibility[]>(
      'SELECT entity_type,entity_id,visible FROM calendar_visibility_overrides',
    ),
    db.select<ItemPreference[]>(
      'SELECT entity_type,entity_id,enabled FROM google_calendar_item_preferences',
    ),
  ]);
  const sourceVisible = (type: string) =>
    sources.find((row) => row.source_type === type)?.visible !== 0;
  const visible = (type: string, id: string) =>
    sourceVisible(type) &&
    !visibility.some(
      (row) => row.entity_type === type && row.entity_id === id && row.visible === 0,
    );
  const enabled = (type: string, id: string) =>
    !itemPreferences.some(
      (row) => row.entity_type === type && row.entity_id === id && row.enabled === 0,
    );
  const candidates: MirrorCandidate[] = [];
  const ownership = new Set<string>();
  const anyBlockOwnership = new Set<string>();
  const seriesOwnership = new Set<string>();
  const eligibleBlocks = new Set<string>();
  const owned = (type: string | null, id: string | null, date: string) =>
    type && id && ownership.has(`${type}\u0000${id}\u0000${date}`);
  const ownedSeries = (type: string | null, id: string | null) =>
    type && id && seriesOwnership.has(`${type}\u0000${id}`);
  const add = (
    key: MirrorKey,
    title: string,
    date: string,
    start: string | null,
    end: string | null,
    recurrence?: string[],
  ) => {
    candidates.push({ ...key, event: eventFor(key, title, date, start, end, zone, recurrence) });
  };
  if (settings.sync_time_blocks) {
    for (const block of blocks) {
      if (
        !visible('block', block.id) ||
        !enabled('block', block.id) ||
        (block.entity_type && !visible(block.entity_type, block.entity_id!))
      )
        continue;
      add(
        { entityType: 'block', entityId: block.id, occurrenceKey: '' },
        block.name,
        block.block_date,
        block.start_time,
        block.end_time,
      );
      eligibleBlocks.add(block.id);
      if (block.entity_type && block.entity_id) {
        ownership.add(`${block.entity_type}\u0000${block.entity_id}\u0000${block.block_date}`);
        anyBlockOwnership.add(`${block.entity_type}\u0000${block.entity_id}`);
      }
    }
    for (const row of series) {
      if (
        !visible('block', row.id) ||
        !enabled('block_series', row.id) ||
        (row.entity_type && !visible(row.entity_type, row.entity_id!))
      )
        continue;
      const rule = JSON.parse(row.recurrence_json) as BlockRecurrence;
      const until = row.archived_from ? addDays(row.archived_from, -1) : null;
      if (until && until < row.start_date) continue;
      const actualRule =
        until && (!rule.until || until < rule.until) ? { ...rule, until, count: null } : rule;
      const ownExceptions = exceptions.filter((item) => item.series_id === row.id);
      const enumerated =
        rule.count !== null || (rule.frequency === 'monthly' && +row.start_date.slice(8) > 28);
      if (enumerated) {
        // COUNT shifted to a later DTSTART would overrun the source series. Also, RFC RRULE
        // skips short months for BYMONTHDAY=29–31 whereas RUMO clamps to month-end.
        // A bounded RDATE list preserves both semantics and extends on later scans.
        const through = settings.sync_horizon_days === -1 ? addDays(localDate(), 730) : to;
        const omitted = new Set(ownExceptions.map((item) => item.occurrence_date));
        const dates = exactOccurrenceDates(
          row.start_date,
          from,
          through,
          rule,
          row.archived_from,
        ).filter((date) => !omitted.has(date));
        if (dates.length) {
          const rest = dates
            .slice(1)
            .map((date) => `${date.replaceAll('-', '')}T${row.start_time.replace(':', '')}00`);
          const recurrence = rest.length ? [`RDATE;TZID=${zone}:${rest.join(',')}`] : undefined;
          add(
            { entityType: 'block_series', entityId: row.id, occurrenceKey: '' },
            row.name,
            dates[0],
            row.start_time,
            row.end_time,
            recurrence,
          );
        }
      } else {
        const probeEnd = addDays(from, 370) < to ? addDays(from, 370) : to;
        const first = exactOccurrenceDates(
          row.start_date,
          from,
          probeEnd,
          rule,
          row.archived_from,
        )[0];
        if (!first) continue;
        const recurrence = [
          blockRrule(actualRule, row.start_date, zone),
          ...ownExceptions.map((item) => exdate(item.occurrence_date, row.start_time, zone)),
        ];
        add(
          { entityType: 'block_series', entityId: row.id, occurrenceKey: '' },
          row.name,
          first,
          row.start_time,
          row.end_time,
          recurrence,
        );
      }
      if (row.entity_type && row.entity_id)
        seriesOwnership.add(`${row.entity_type}\u0000${row.entity_id}`);
      for (const exception of ownExceptions) {
        if (exception.cancelled || exception.block_date < from || exception.block_date > to)
          continue;
        const key: MirrorKey = {
          entityType: 'block_exception',
          entityId: row.id,
          occurrenceKey: exception.occurrence_date,
        };
        add(
          key,
          exception.title || row.name,
          exception.block_date,
          exception.start_time,
          exception.end_time,
        );
      }
    }
  }
  if (settings.sync_routines && sourceVisible('routine')) {
    for (const routine of routines) {
      if (
        !visible('routine', routine.id) ||
        !enabled('routine', routine.id) ||
        ownedSeries('routine', routine.id)
      )
        continue;
      if (!routine.time_of_day && settings.untimed_mode === 'skip') continue;
      const suppressed = blocks
        .filter(
          (block) =>
            eligibleBlocks.has(block.id) &&
            block.entity_type === 'routine' &&
            block.entity_id === routine.id,
        )
        .map((block) => block.block_date);
      const recurrence = [
        routineRrule(routine.frequency, JSON.parse(routine.weekdays) as number[]),
        ...suppressed.map((date) => exdate(date, routine.time_of_day, zone)),
      ];
      const start = routine.time_of_day;
      const end = start ? plusMinutes(start, settings.routine_minutes) : null;
      const days = JSON.parse(routine.weekdays) as number[];
      const first =
        routine.frequency === 'daily'
          ? from
          : [...days].map((day) => nextWeekday(from, day)).sort()[0];
      if (first)
        add(
          { entityType: 'routine', entityId: routine.id, occurrenceKey: '' },
          routine.name,
          first,
          start,
          end,
          recurrence,
        );
    }
  }
  if (settings.sync_workouts && sourceVisible('workout') && settings.untimed_mode === 'all_day') {
    const byWorkout = new Map<string, { name: string; days: number[] }>();
    for (const row of workouts) {
      const current = byWorkout.get(row.id) ?? { name: row.name, days: [] };
      current.days.push(row.weekday);
      byWorkout.set(row.id, current);
    }
    for (const [id, workout] of byWorkout) {
      if (!visible('workout', id) || !enabled('workout', id) || ownedSeries('workout', id))
        continue;
      const suppressed = blocks
        .filter(
          (block) =>
            eligibleBlocks.has(block.id) &&
            block.entity_type === 'workout' &&
            block.entity_id === id,
        )
        .map((block) => block.block_date);
      const recurrence = [
        routineRrule('weekdays', workout.days),
        ...suppressed.map((date) => exdate(date, null, zone)),
      ];
      const first = workout.days.map((day) => nextWeekday(from, day)).sort()[0];
      if (first)
        add(
          { entityType: 'workout', entityId: id, occurrenceKey: '' },
          workout.name,
          first,
          null,
          null,
          recurrence,
        );
    }
  }
  if (settings.sync_tasks && sourceVisible('task')) {
    for (const task of tasks) {
      if (
        !task.due_date ||
        !visible('task', task.id) ||
        !enabled('task', task.id) ||
        ownedSeries('task', task.id)
      )
        continue;
      if (!task.due_time && settings.untimed_mode === 'skip') continue;
      const end = task.due_time ? plusMinutes(task.due_time, 30) : null;
      const key: MirrorKey = { entityType: 'task', entityId: task.id, occurrenceKey: '' };
      if (!task.recurrence) {
        if (
          !owned('task', task.id, task.due_date) &&
          !anyBlockOwnership.has(`task\u0000${task.id}`)
        )
          add(key, task.title, task.due_date, task.due_time, end);
        continue;
      }
      const rule = JSON.parse(task.recurrence) as Recurrence;
      const starts = task.due_date > from ? task.due_date : from;
      let first: string | null = null;
      for (let date = starts, n = 0; n < 33; n++, date = addDays(date, 1)) {
        if (occursOn({ ...task, recurrence: rule }, date)) {
          first = date;
          break;
        }
      }
      if (!first) continue;
      const suppressed = blocks
        .filter(
          (block) =>
            eligibleBlocks.has(block.id) &&
            block.entity_type === 'task' &&
            block.entity_id === task.id,
        )
        .map((block) => block.block_date);
      const blockRule: BlockRecurrence = {
        frequency: rule.frequency === 'weekdays' ? 'weekly' : rule.frequency,
        interval: 1,
        weekdays: rule.weekdays ?? [],
        until: rule.until ?? null,
        count: null,
      };
      if (rule.frequency === 'monthly' && +task.due_date.slice(8) > 28) {
        const through = settings.sync_horizon_days === -1 ? addDays(localDate(), 730) : to;
        const dates = exactOccurrenceDates(task.due_date, from, through, blockRule, null).filter(
          (date) => !suppressed.includes(date),
        );
        if (dates.length) {
          const entries = dates
            .slice(1)
            .map((date) =>
              task.due_time
                ? `${date.replaceAll('-', '')}T${task.due_time!.replace(':', '')}00`
                : date.replaceAll('-', ''),
            );
          const recurrence = entries.length
            ? [
                task.due_time
                  ? `RDATE;TZID=${zone}:${entries.join(',')}`
                  : `RDATE;VALUE=DATE:${entries.join(',')}`,
              ]
            : undefined;
          add(key, task.title, dates[0], task.due_time, end, recurrence);
        }
      } else {
        const recurrence = [
          blockRrule(blockRule, task.due_date, zone),
          ...suppressed.map((date) => exdate(date, task.due_time, zone)),
        ];
        add(key, task.title, first, task.due_time, end, recurrence);
      }
    }
  }
  if (settings.sync_objectives && sourceVisible('objective'))
    for (const item of objectives)
      if (visible('objective', item.id) && enabled('objective', item.id))
        add(
          { entityType: 'objective', entityId: item.id, occurrenceKey: '' },
          `Prazo: ${item.name}`,
          item.target_date,
          null,
          null,
        );
  if (settings.sync_milestones && sourceVisible('milestone'))
    for (const item of milestones)
      if (visible('milestone', item.id) && enabled('milestone', item.id))
        add(
          { entityType: 'milestone', entityId: item.id, occurrenceKey: '' },
          `Marco: ${item.name}`,
          item.target_date,
          null,
          null,
        );
  return candidates;
}
