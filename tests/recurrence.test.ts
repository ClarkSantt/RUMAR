import { describe, expect, it } from 'vitest';
import {
  allTasks,
  occursOn,
  overdueTasks,
  todayTasks,
  upcomingTasks,
  validateTask,
  nextOccurrence,
} from '../src/features/tasks/domain';
import { addDays, formatDate, localDate, validDate } from '../src/lib/dates';
import type { Snapshot, Task } from '../src/types/models';
const base: Task = {
  id: '1',
  title: 'Estudar',
  description: '',
  priority: 'normal',
  due_date: '2026-09-01',
  due_time: '19:00',
  status: 'pending',
  recurrence: null,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
  completed_at: null,
  archived_at: null,
  sort_order: 0,
  source_inbox_id: null,
};
const snapshot = (tasks: Task[]): Snapshot => ({
  tasks,
  subtasks: [],
  completions: [],
  subtaskCompletions: [],
  inbox: [],
  settings: { name: 'Teste', theme: 'system' },
});
describe('recurrence in local civil dates', () => {
  it('daily starts at its anchor and has an inclusive end', () => {
    const task = { ...base, recurrence: { frequency: 'daily' as const, until: '2026-09-03' } };
    expect(occursOn(task, '2026-08-31')).toBe(false);
    expect(occursOn(task, '2026-09-01')).toBe(true);
    expect(occursOn(task, '2026-09-03')).toBe(true);
    expect(occursOn(task, '2026-09-04')).toBe(false);
  });
  it('weekly follows the anchor weekday', () => {
    const task = { ...base, recurrence: { frequency: 'weekly' as const } };
    expect(occursOn(task, '2026-09-08')).toBe(true);
    expect(occursOn(task, '2026-09-09')).toBe(false);
  });
  it('specific weekdays include Monday Wednesday Friday, exclude Saturday', () => {
    const task = { ...base, recurrence: { frequency: 'weekdays' as const, weekdays: [1, 3, 5] } };
    for (const day of ['2026-09-21', '2026-09-23', '2026-09-25'])
      expect(occursOn(task, day)).toBe(true);
    expect(occursOn(task, '2026-09-26')).toBe(false);
  });
  it('monthly clamps to shorter months and returns to original day', () => {
    const task = { ...base, due_date: '2026-01-31', recurrence: { frequency: 'monthly' as const } };
    expect(occursOn(task, '2026-02-28')).toBe(true);
    expect(occursOn(task, '2026-03-31')).toBe(true);
    expect(occursOn(task, '2026-03-28')).toBe(false);
    expect(occursOn(task, '2028-02-29')).toBe(true);
  });
  it('does not produce old recurring backlog', () => {
    const task = { ...base, due_date: '2020-01-01', recurrence: { frequency: 'daily' as const } };
    expect(overdueTasks(snapshot([task]), '2026-09-26')).toHaveLength(0);
    expect(todayTasks(snapshot([task]), '2026-09-26')).toHaveLength(1);
    expect(upcomingTasks(snapshot([task]), '2026-09-26')).toHaveLength(30);
  });
  it('filters today, upcoming, all pending and overdue nonrecurring tasks', () => {
    const data = snapshot([
      { ...base, id: 'old' },
      { ...base, id: 'today', due_date: '2026-09-26' },
      { ...base, id: 'future', due_date: '2026-09-27' },
      { ...base, id: 'undated', due_date: null },
      { ...base, id: 'complete', status: 'completed' },
      { ...base, id: 'archived', archived_at: '2026-09-25' },
    ]);
    expect(todayTasks(data, '2026-09-26').map((r) => r.task.id)).toEqual(['today']);
    expect(overdueTasks(data, '2026-09-26').map((r) => r.task.id)).toEqual(['old']);
    expect(upcomingTasks(data, '2026-09-26').map((r) => r.task.id)).toEqual(['future']);
    expect(allTasks(data, '2026-09-26')).toHaveLength(4);
  });
  it('finds the next occurrence and respects end date', () => {
    expect(
      nextOccurrence(
        { ...base, recurrence: { frequency: 'weekdays', weekdays: [1] } },
        '2026-09-26',
      ),
    ).toBe('2026-09-28');
    expect(
      nextOccurrence(
        { ...base, recurrence: { frequency: 'daily', until: '2026-09-25' } },
        '2026-09-26',
      ),
    ).toBeNull();
  });
  it('rejects empty weekdays and inverted date range', () => {
    expect(() =>
      validateTask({ ...base, recurrence: { frequency: 'weekdays', weekdays: [] } }),
    ).toThrow();
    expect(() =>
      validateTask({ ...base, recurrence: { frequency: 'daily', until: '2026-08-01' } }),
    ).toThrow();
  });
  it('uses local dates, pt-BR formatting, leap days and year transitions', () => {
    expect(localDate(new Date(2026, 8, 26, 23, 59))).toBe('2026-09-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(formatDate('2026-09-26')).toBe('26/09/2026');
    expect(validDate('2026-02-29')).toBe(false);
  });
});
