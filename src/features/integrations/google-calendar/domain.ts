import { addDays, validDate } from '../../../lib/dates';
import type { BlockRecurrence } from '../../calendar/block-recurrence';

export const googleScope = 'https://www.googleapis.com/auth/calendar.app.created';
export type MirrorKind =
  | 'routine'
  | 'block'
  | 'block_series'
  | 'block_exception'
  | 'workout'
  | 'task'
  | 'objective'
  | 'milestone';
export interface MirrorKey {
  entityType: MirrorKind;
  entityId: string;
  occurrenceKey: string;
}
export interface GoogleEvent {
  id?: string;
  summary: string;
  description: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  extendedProperties: { private: Record<string, string> };
}
export interface MirrorCandidate extends MirrorKey {
  event: GoogleEvent;
}
export interface GoogleSettings {
  integration_id: string;
  client_id: string;
  calendar_id: string | null;
  calendar_name: string;
  state: 'disconnected' | 'connected' | 'reconnect';
  automatic: number;
  sync_routines: number;
  sync_time_blocks: number;
  sync_workouts: number;
  sync_tasks: number;
  sync_objectives: number;
  sync_milestones: number;
  untimed_mode: 'skip' | 'all_day';
  routine_minutes: number;
  sync_horizon_days: 30 | 90 | -1;
  sync_started: number;
  delete_remote: number;
  first_sync_from: string | null;
  last_sync_at: string | null;
  updated_at: string;
}
export function mirrorKey(key: MirrorKey) {
  return `${key.entityType}\u0000${key.entityId}\u0000${key.occurrenceKey}`;
}
export function timeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone || !isTimeZone(zone)) throw Error('Fuso horário do sistema indisponível.');
  return zone;
}
export function isTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
const weekdays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function utcUntil(date: string, zone: string) {
  if (!validDate(date) || !isTimeZone(zone)) throw Error('Término de recorrência inválido.');
  // Find the UTC instant corresponding to the end of the selected local civil date.
  const desired = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8), 23, 59, 59);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let instant = desired;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    const observed = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    );
    instant += desired - observed;
  }
  return new Date(instant)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}
export function blockRrule(rule: BlockRecurrence, startDate: string, zone: string) {
  if (!validDate(startDate) || !isTimeZone(zone)) throw Error('Recorrência inválida.');
  const fields =
    rule.frequency === 'weekdays'
      ? ['FREQ=WEEKLY', 'BYDAY=MO,TU,WE,TH,FR']
      : rule.frequency === 'weekly'
        ? [
            'FREQ=WEEKLY',
            `INTERVAL=${rule.interval}`,
            `BYDAY=${(rule.weekdays.length ? rule.weekdays : [new Date(`${startDate}T12:00:00Z`).getUTCDay()]).map((day) => weekdays[day]).join(',')}`,
          ]
        : rule.frequency === 'monthly'
          ? ['FREQ=MONTHLY', `INTERVAL=${rule.interval}`, `BYMONTHDAY=${+startDate.slice(8)}`]
          : ['FREQ=DAILY', `INTERVAL=${rule.interval}`];
  if (rule.frequency === 'monthly' && +startDate.slice(8) > 28)
    throw Error(
      'Recorrência mensal que ajusta meses curtos ainda não pode ser espelhada fielmente.',
    );
  if (rule.count !== null) fields.push(`COUNT=${rule.count}`);
  else if (rule.until) fields.push(`UNTIL=${utcUntil(rule.until, zone)}`);
  return `RRULE:${fields.join(';')}`;
}
export function routineRrule(frequency: 'daily' | 'weekdays', days: number[]) {
  return frequency === 'daily'
    ? 'RRULE:FREQ=DAILY'
    : `RRULE:FREQ=WEEKLY;BYDAY=${[...days]
        .sort()
        .map((day) => weekdays[day])
        .join(',')}`;
}
export function eventFor(
  key: MirrorKey,
  title: string,
  date: string,
  startTime: string | null,
  endTime: string | null,
  zone: string,
  recurrence?: string[],
): GoogleEvent {
  if (!validDate(date) || !title.trim() || !isTimeZone(zone)) throw Error('Evento inválido.');
  const timed = startTime !== null && endTime !== null;
  if (
    timed &&
    (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime!) ||
      !/^([01]\d|2[0-7]):[0-5]\d$/.test(endTime!) ||
      endTime! <= startTime!)
  )
    throw Error('Horário do evento inválido.');
  const event: GoogleEvent = {
    summary: title.trim().slice(0, 500),
    description: 'Gerenciado pelo RUMO. Edite no RUMO para manter a sincronização.',
    start: timed ? { dateTime: `${date}T${startTime}:00`, timeZone: zone } : { date },
    end: timed
      ? {
          dateTime:
            Number(endTime!.slice(0, 2)) >= 24
              ? `${addDays(date, 1)}T${String(Number(endTime!.slice(0, 2)) - 24).padStart(2, '0')}${endTime!.slice(2)}:00`
              : `${date}T${endTime}:00`,
          timeZone: zone,
        }
      : { date: addDays(date, 1) },
    extendedProperties: {
      private: {
        rumo_entity_type: key.entityType,
        rumo_entity_id: key.entityId,
        rumo_occurrence_key: key.occurrenceKey,
        rumo_schema_version: '25',
      },
    },
  };
  if (recurrence?.length) event.recurrence = recurrence;
  return event;
}
export function retryDelayMs(attempt: number) {
  return Math.min(3_600_000, 15_000 * 2 ** Math.min(attempt, 8));
}
