import { addDays, parseDate, validDate } from '../../lib/dates';
export interface HabitInput {
  name: string;
  description: string;
  frequency: 'daily' | 'weekdays' | 'weekly_target';
  weekdays: number[];
  weekly_target: number;
  kind: 'boolean' | 'quantity';
  tracking_type?: 'check' | 'quantity' | 'duration' | 'frequency';
  target_value: number;
  unit: string;
  start_date: string;
  end_date: string | null;
  project_id: string | null;
  active: number;
}
export interface Habit extends HabitInput {
  id: string;
  archived_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface HabitEntry {
  habit_id: string;
  entry_date: string;
  value: number;
  updated_at: string;
}
export function habitEligible(h: HabitInput & { archived_at?: string | null }, day: string) {
  return (
    !!h.active &&
    !h.archived_at &&
    day >= h.start_date &&
    (!h.end_date || day <= h.end_date) &&
    (h.frequency !== 'weekdays' || h.weekdays.includes(parseDate(day).getDay()))
  );
}
export function weekStart(day: string) {
  return addDays(day, -((parseDate(day).getDay() + 6) % 7));
}
export function habitReached(h: HabitInput, value: number) {
  return value >= (h.kind === 'boolean' ? 1 : h.target_value);
}
export function habitProgress(h: Habit, entries: HabitEntry[], day: string) {
  const relevant = entries.filter((e) => e.habit_id === h.id),
    start = weekStart(day);
  const eligible = (date: string) => habitEligible({ ...h, active: 1, archived_at: null }, date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter(eligible);
  const achieved = (dates: string[]) =>
    relevant.filter((e) => dates.includes(e.entry_date) && habitReached(h, e.value)).length;
  const target =
    h.frequency === 'weekly_target' ? Math.min(h.weekly_target, weekDays.length) : weekDays.length;
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(day, -i)).filter(eligible);
  let expected = last30.length,
    done = achieved(last30);
  if (h.frequency === 'weekly_target') {
    const weeks = new Map<string, string[]>();
    for (const d of last30) {
      const w = weekStart(d);
      weeks.set(w, [...(weeks.get(w) ?? []), d]);
    }
    expected = 0;
    done = 0;
    for (const dates of weeks.values()) {
      const count = Math.min(h.weekly_target, dates.length);
      expected += count;
      done += Math.min(count, achieved(dates));
    }
  }
  return {
    weekDone: achieved(weekDays),
    weekTarget: target,
    consistency: expected ? Math.round((done / expected) * 100) : 0,
    expected,
    done,
  };
}
export function validateHabit(input: HabitInput): HabitInput {
  const trackingType =
    input.tracking_type ??
    (input.kind === 'quantity'
      ? 'quantity'
      : input.frequency === 'weekly_target'
        ? 'frequency'
        : 'check');
  const h = {
    ...input,
    name: input.name.trim(),
    unit: input.unit.trim(),
    weekdays: [...new Set(input.weekdays)].sort(),
    tracking_type: trackingType,
  };
  if (!h.name || h.name.length > 500) throw Error('Informe um nome de até 500 caracteres.');
  if (
    !['daily', 'weekdays', 'weekly_target'].includes(h.frequency) ||
    !['boolean', 'quantity'].includes(h.kind) ||
    !['check', 'quantity', 'duration', 'frequency'].includes(trackingType)
  )
    throw Error('Tipo de hábito inválido.');
  if (
    !validDate(h.start_date) ||
    (h.end_date && (!validDate(h.end_date) || h.end_date < h.start_date))
  )
    throw Error('Período inválido.');
  if (
    h.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    (h.frequency === 'weekdays' && !h.weekdays.length)
  )
    throw Error('Escolha os dias da semana.');
  if (
    !Number.isInteger(h.weekly_target) ||
    h.weekly_target < 1 ||
    h.weekly_target > 7 ||
    !Number.isFinite(h.target_value) ||
    h.target_value <= 0
  )
    throw Error('Meta inválida.');
  const quantitative = trackingType === 'quantity' || trackingType === 'duration';
  if (quantitative && !h.unit) throw Error('Informe a unidade da meta.');
  return {
    ...h,
    frequency: trackingType === 'frequency' ? 'weekly_target' : h.frequency,
    kind: quantitative ? 'quantity' : 'boolean',
    target_value: quantitative ? h.target_value : 1,
    unit: trackingType === 'frequency' ? 'vezes' : h.unit,
    active: h.active ? 1 : 0,
  };
}
