import { validDate } from '../../lib/dates';
import { minuteOf, timeOf } from '../calendar/planner-domain';

export type PlanningStatus = 'planned' | 'completed' | 'skipped' | 'cancelled';
export type PlanningSchedule = 'fixed' | 'period' | 'flexible';
export type DayPeriod = 'morning' | 'afternoon' | 'evening';
export type PlanningSource =
  'standalone' | 'task' | 'project' | 'habit' | 'workout' | 'event' | 'template';

export interface PlanningDraft {
  date: string;
  title: string;
  notes: string;
  schedule: PlanningSchedule;
  startTime: string | null;
  endTime: string | null;
  dayPeriod: DayPeriod | null;
  sourceType: PlanningSource;
  sourceId: string | null;
}

export interface PlanningItem {
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  schedule_kind: PlanningSchedule;
  day_period: DayPeriod | null;
  position: number;
  status: PlanningStatus;
  completed_at: string | null;
  title_snapshot: string;
  source_type: PlanningSource;
  source_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  display_title: string;
  project_name: string | null;
  source_active: number;
}

export interface PlanningSourceOption {
  id: string;
  name: string;
  detail: string;
  type: Exclude<PlanningSource, 'standalone'>;
}

const periodAnchors: Record<DayPeriod, [string, string]> = {
  morning: ['09:00', '09:30'],
  afternoon: ['14:00', '14:30'],
  evening: ['19:00', '19:30'],
};

export function scheduleTimes(draft: PlanningDraft): [string, string] {
  if (draft.schedule === 'period') return periodAnchors[draft.dayPeriod ?? 'morning'];
  if (draft.schedule === 'flexible') return ['23:00', '23:30'];
  const start = draft.startTime ?? '';
  const end = draft.endTime ?? '';
  if (minuteOf(start) >= 1440 || minuteOf(end) <= minuteOf(start))
    throw Error('O horário final deve ser posterior ao início.');
  return [start, end];
}

export function validatePlanningDraft(draft: PlanningDraft) {
  const next = { ...draft, title: draft.title.trim(), notes: draft.notes.trim() };
  if (!validDate(next.date)) throw Error('Data inválida.');
  if (!next.title || next.title.length > 500)
    throw Error('Informe um título de até 500 caracteres.');
  if (next.notes.length > 4000) throw Error('As notas devem ter até 4.000 caracteres.');
  if (!['fixed', 'period', 'flexible'].includes(next.schedule))
    throw Error('Forma de planejamento inválida.');
  if (next.schedule === 'period' && !next.dayPeriod) throw Error('Escolha um período.');
  if (next.schedule !== 'period') next.dayPeriod = null;
  if (next.sourceType === 'standalone') next.sourceId = null;
  else if (!next.sourceId) throw Error('Escolha a origem do item.');
  scheduleTimes(next);
  return next;
}

export function addMinutes(start: string, minutes: number) {
  return timeOf(Math.min(1440, minuteOf(start) + minutes));
}

export const periodLabels: Record<DayPeriod, string> = {
  morning: 'Manhã',
  afternoon: 'Tarde',
  evening: 'Noite',
};

export function planningTimeLabel(item: PlanningItem) {
  if (item.schedule_kind === 'fixed') return `${item.start_time}–${item.end_time}`;
  if (item.schedule_kind === 'period') return periodLabels[item.day_period ?? 'morning'];
  return 'Flexível';
}
