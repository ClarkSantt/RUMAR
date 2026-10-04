import { addDays, localDate, parseDate, validDate } from '../../lib/dates';
import type { Snapshot, Task, TaskInput, TaskOccurrence } from '../../types/models';

export function occursOn(task: Task, day: string): boolean {
  if (task.archived_at) return false;
  const rule = task.recurrence;
  if (!rule) return task.due_date === day;
  if (!task.due_date || day < task.due_date || (rule.until && day > rule.until)) return false;
  const date = parseDate(day),
    start = parseDate(task.due_date);
  switch (rule.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return date.getDay() === start.getDay();
    case 'weekdays':
      return Boolean(rule.weekdays?.includes(date.getDay()));
    case 'monthly': {
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      return date.getDate() === Math.min(start.getDate(), lastDay);
    }
  }
}
export function nextOccurrence(task: Task, from = localDate()): string | null {
  if (!task.recurrence) return task.due_date;
  const start = task.due_date && task.due_date > from ? task.due_date : from;
  // Every supported rule has at least one occurrence within 32 days.
  for (let i = 0; i < 32; i++) {
    const day = addDays(start, i);
    if (occursOn(task, day)) return day;
  }
  return null;
}
export function validateTask(input: TaskInput): TaskInput {
  const result = { ...input, title: input.title.trim() };
  if (!result.title) throw new Error('Digite um título para a tarefa.');
  if (Array.from(result.title).length > 500)
    throw new Error('O título pode ter até 500 caracteres.');
  if (result.due_date && !validDate(result.due_date)) throw new Error('Informe uma data válida.');
  if (result.due_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result.due_time))
    throw new Error('Informe um horário válido.');
  if (
    result.remind_minutes_before != null &&
    (!result.due_date ||
      !result.due_time ||
      ![0, 5, 15, 30, 60].includes(result.remind_minutes_before))
  )
    throw new Error('Defina data e horário para o lembrete.');
  if (!['low', 'normal', 'high'].includes(result.priority)) throw new Error('Prioridade inválida.');
  if (result.recurrence) {
    result.due_date ||= localDate();
    const rule = result.recurrence;
    if (!['daily', 'weekly', 'weekdays', 'monthly'].includes(rule.frequency))
      throw new Error('Recorrência inválida.');
    if (
      rule.frequency === 'weekdays' &&
      (!rule.weekdays?.length || rule.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    )
      throw new Error('Selecione ao menos um dia da semana.');
    if (rule.until && (!validDate(rule.until) || rule.until < result.due_date))
      throw new Error('O término deve ser igual ou posterior ao início.');
  }
  return result;
}
export function occurrence(task: Task, date: string | null, data: Snapshot): TaskOccurrence {
  const record = task.recurrence
    ? data.completions.find((c) => c.task_id === task.id && c.occurrence_date === date)
    : undefined;
  return {
    task,
    date,
    completed: task.recurrence ? Boolean(record) : task.status === 'completed',
    completedAt: record?.completed_at ?? task.completed_at ?? undefined,
  };
}
export function todayTasks(data: Snapshot, day: string): TaskOccurrence[] {
  return sortOccurrences(
    data.tasks.filter((t) => occursOn(t, day)).map((t) => occurrence(t, day, data)),
  );
}
export function overdueTasks(data: Snapshot, day: string): TaskOccurrence[] {
  return sortOccurrences(
    data.tasks
      .filter(
        (t) =>
          !t.archived_at &&
          !t.recurrence &&
          t.status === 'pending' &&
          t.due_date &&
          t.due_date < day,
      )
      .map((t) => occurrence(t, t.due_date, data)),
  );
}
export function allTasks(data: Snapshot, day: string): TaskOccurrence[] {
  return sortOccurrences(
    data.tasks
      .filter((t) => !t.archived_at && t.status === 'pending')
      .map((t) => occurrence(t, nextOccurrence(t, day), data)),
  );
}
export function upcomingTasks(data: Snapshot, day: string): TaskOccurrence[] {
  const rows: TaskOccurrence[] = [];
  for (const task of data.tasks.filter((t) => !t.archived_at && t.status === 'pending')) {
    if (!task.recurrence) {
      if (task.due_date && task.due_date > day) rows.push(occurrence(task, task.due_date, data));
      continue;
    }
    for (let i = 1; i <= 30; i++) {
      const date = addDays(day, i);
      if (occursOn(task, date)) rows.push(occurrence(task, date, data));
    }
  }
  return sortOccurrences(rows);
}
export function completedTasks(data: Snapshot): TaskOccurrence[] {
  const rows = data.tasks
    .filter((t) => !t.archived_at && t.status === 'completed')
    .map((t) => occurrence(t, t.due_date, data));
  const tasks = new Map(data.tasks.filter((t) => !t.archived_at).map((t) => [t.id, t]));
  for (const completion of data.completions) {
    const task = tasks.get(completion.task_id);
    if (task)
      rows.push({
        task,
        date: completion.occurrence_date,
        completed: true,
        completedAt: completion.completed_at,
        historical: true,
      });
  }
  return rows.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}
export function sortOccurrences(rows: TaskOccurrence[]): TaskOccurrence[] {
  const priorities = { high: 0, normal: 1, low: 2 };
  return rows.sort(
    (a, b) =>
      (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
      Number(a.completed) - Number(b.completed) ||
      (a.task.due_time ?? '99').localeCompare(b.task.due_time ?? '99') ||
      priorities[a.task.priority] - priorities[b.task.priority] ||
      a.task.sort_order - b.task.sort_order ||
      a.task.created_at.localeCompare(b.task.created_at),
  );
}
