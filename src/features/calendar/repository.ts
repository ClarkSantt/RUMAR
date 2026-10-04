import type { SqlConnection } from '../../lib/database/connection';
import { addDays } from '../../lib/dates';
import type { Task } from '../../types/models';
import { occursOn } from '../tasks/domain';
import { HabitsRepository } from '../habits/repository';
import { habitEligible, habitReached } from '../habits/domain';
import { RoutinesRepository } from '../routines/repository';
import { routineEligible } from '../routines/domain';
import { WorkoutScheduleRepository } from '../workouts/repositories/schedule';
import { CalendarPreferences } from './preferences';
import { MilestonesRepository } from '../objectives/milestones-repository';
export interface CalendarItem {
  id: string;
  kind:
    'task' | 'habit' | 'routine' | 'project' | 'workout' | 'objective' | 'milestone' | 'external';
  name: string;
  date: string;
  time?: string | null;
  completed: boolean;
  task?: Task;
  objectiveId?: string;
  description?: string;
}
export async function calendarRange(
  db: SqlConnection,
  from: string,
  to: string,
): Promise<CalendarItem[]> {
  const habitsRepo = new HabitsRepository(db),
    routinesRepo = new RoutinesRepository(db);
  const [
    raw,
    ticks,
    habits,
    entries,
    routines,
    occurrences,
    projects,
    workouts,
    objectives,
    milestones,
    external,
  ] = await Promise.all([
    db.select<(Omit<Task, 'recurrence'> & { recurrence: string | null })[]>(
      'SELECT * FROM tasks WHERE archived_at IS NULL AND (due_date BETWEEN $1 AND $2 OR (recurrence IS NOT NULL AND due_date<=$2))',
      [from, to],
    ),
    db.select<{ task_id: string; occurrence_date: string }[]>(
      'SELECT task_id,occurrence_date FROM task_completions WHERE occurrence_date BETWEEN $1 AND $2',
      [from, to],
    ),
    habitsRepo.list(),
    habitsRepo.entries(from, to),
    routinesRepo.list(),
    routinesRepo.occurrences(from, to),
    db.select<{ id: string; name: string; target_date: string; status: string }[]>(
      'SELECT id,name,target_date,status FROM projects WHERE archived_at IS NULL AND target_date BETWEEN $1 AND $2',
      [from, to],
    ),
    new WorkoutScheduleRepository(db).range(from, to),
    db.select<{ id: string; name: string; target_date: string; status: string }[]>(
      'SELECT id,name,target_date,status FROM objectives WHERE archived_at IS NULL AND target_date BETWEEN $1 AND $2',
      [from, to],
    ),
    new MilestonesRepository(db).deadlines(from, to),
    db.select<
      {
        id: string;
        summary: string;
        description: string;
        start_date: string;
        start_time: string | null;
      }[]
    >(
      'SELECT id,summary,description,start_date,start_time FROM external_calendar_events WHERE start_date BETWEEN $1 AND $2 ORDER BY start_date,start_time,id',
      [from, to],
    ),
  ]);
  const tasks = raw.map(
      (t) => ({ ...t, recurrence: t.recurrence ? JSON.parse(t.recurrence) : null }) as Task,
    ),
    items: CalendarItem[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    for (const task of tasks)
      if (occursOn(task, day))
        items.push({
          id: task.id,
          kind: 'task',
          name: task.title,
          date: day,
          time: task.due_time,
          completed: task.recurrence
            ? ticks.some((c) => c.task_id === task.id && c.occurrence_date === day)
            : task.status === 'completed',
          task,
        });
    for (const h of habits)
      if (habitEligible(h, day))
        items.push({
          id: h.id,
          kind: 'habit',
          name: h.name,
          date: day,
          completed: habitReached(
            h,
            entries.find((e) => e.habit_id === h.id && e.entry_date === day)?.value ?? 0,
          ),
        });
    for (const r of routines)
      if (routineEligible(r, day))
        items.push({
          id: r.id,
          kind: 'routine',
          name: r.name,
          date: day,
          time: r.time_of_day,
          completed: !!occurrences.find((o) => o.routine_id === r.id && o.occurrence_date === day)
            ?.completed_at,
        });
  }
  for (const p of projects)
    items.push({
      id: p.id,
      kind: 'project',
      name: p.name,
      date: p.target_date,
      completed: p.status === 'completed',
    });
  for (const workout of workouts)
    items.push({
      id: workout.id,
      kind: 'workout',
      name: workout.name,
      date: workout.date,
      completed: workout.completed,
    });
  for (const objective of objectives)
    items.push({
      id: objective.id,
      kind: 'objective',
      name: objective.name,
      date: objective.target_date,
      completed: objective.status === 'completed',
    });
  for (const m of milestones)
    items.push({
      id: m.id,
      kind: 'milestone',
      name: m.title,
      date: m.target_date!,
      completed: m.effective_status === 'completed',
      objectiveId: m.objective_id,
    });
  for (const event of external)
    items.push({
      id: event.id,
      kind: 'external',
      name: event.summary,
      description: event.description,
      date: event.start_date,
      time: event.start_time,
      completed: false,
    });
  const preferences = new CalendarPreferences(db);
  const [sources, overrides] = await Promise.all([preferences.sources(), preferences.overrides()]);
  return items
    .filter(
      (item) =>
        sources.find((s) => s.source_type === item.kind)?.visible !== 0 &&
        overrides.find((o) => o.entity_type === item.kind && o.entity_id === item.id)?.visible !==
          0,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99'));
}
