import { parseDate } from '../../lib/dates';
export interface RoutineInput {
  name: string;
  description: string;
  frequency: 'daily' | 'weekdays';
  weekdays: number[];
  time_of_day: string | null;
  active: number;
}
export interface Routine extends RoutineInput {
  id: string;
  archived_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface RoutineItem {
  id: string;
  routine_id: string;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface RoutineOccurrence {
  id: string;
  routine_id: string;
  occurrence_date: string;
  started_at: string;
  completed_at: string | null;
}
export interface RoutineCompletion {
  occurrence_id: string;
  item_id: string;
  completed_at: string;
}
export function routineEligible(r: RoutineInput & { archived_at?: string | null }, day: string) {
  return (
    !!r.active &&
    !r.archived_at &&
    (r.frequency === 'daily' || r.weekdays.includes(parseDate(day).getDay()))
  );
}
export function validateRoutine(input: RoutineInput) {
  const r = { ...input, name: input.name.trim(), weekdays: [...new Set(input.weekdays)] };
  if (!r.name || r.name.length > 500) throw Error('Informe um nome de até 500 caracteres.');
  if (
    !['daily', 'weekdays'].includes(r.frequency) ||
    r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    (r.frequency === 'weekdays' && !r.weekdays.length)
  )
    throw Error('Escolha dias válidos.');
  if (r.time_of_day && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time_of_day))
    throw Error('Horário inválido.');
  return { ...r, active: r.active ? 1 : 0 };
}
