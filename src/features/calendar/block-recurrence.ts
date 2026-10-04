import { addDays, localDate, parseDate, validDate } from '../../lib/dates';
export interface BlockRecurrence {
  frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly';
  interval: number;
  weekdays: number[];
  until: string | null;
  count: number | null;
}
export const defaultBlockRecurrence = (): BlockRecurrence => ({
  frequency: 'weekly',
  interval: 1,
  weekdays: [],
  until: null,
  count: null,
});
export function validateBlockRecurrence(rule: BlockRecurrence) {
  if (
    !['daily', 'weekdays', 'weekly', 'monthly'].includes(rule.frequency) ||
    !Number.isInteger(rule.interval) ||
    rule.interval < 1 ||
    rule.interval > 52 ||
    !Array.isArray(rule.weekdays) ||
    rule.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    new Set(rule.weekdays).size !== rule.weekdays.length ||
    (rule.until !== null && !validDate(rule.until)) ||
    (rule.count !== null &&
      (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > 10000)) ||
    (rule.until !== null && rule.count !== null)
  )
    throw Error('Recorrência inválida.');
}
const dayNumber = (date: string) =>
  Math.floor(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8))) /
      86400000,
  );
function matches(start: string, date: string, rule: BlockRecurrence) {
  const delta = dayNumber(date) - dayNumber(start),
    d = parseDate(date);
  if (delta < 0) return false;
  if (rule.frequency === 'daily') return delta % rule.interval === 0;
  if (rule.frequency === 'weekdays') return d.getDay() !== 0 && d.getDay() !== 6;
  if (rule.frequency === 'weekly') {
    const anchor = dayNumber(start) - ((parseDate(start).getDay() + 6) % 7);
    return (
      Math.floor((dayNumber(date) - anchor) / 7) % rule.interval === 0 &&
      (rule.weekdays.length ? rule.weekdays : [parseDate(start).getDay()]).includes(d.getDay())
    );
  }
  const origin = parseDate(start),
    months = (d.getFullYear() - origin.getFullYear()) * 12 + d.getMonth() - origin.getMonth();
  return (
    months % rule.interval === 0 &&
    d.getDate() ===
      Math.min(origin.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())
  );
}
function occurrencesBefore(start: string, before: string, rule: BlockRecurrence) {
  const first = dayNumber(start),
    limit = dayNumber(before);
  if (limit <= first) return 0;
  if (rule.frequency === 'daily') return Math.ceil((limit - first) / rule.interval);
  if (rule.frequency === 'weekly' || rule.frequency === 'weekdays') {
    const anchor = first - ((parseDate(start).getDay() + 6) % 7),
      period = rule.frequency === 'weekdays' ? 7 : 7 * rule.interval;
    const selected =
      rule.frequency === 'weekdays'
        ? [1, 2, 3, 4, 5]
        : rule.weekdays.length
          ? rule.weekdays
          : [parseDate(start).getDay()];
    return selected.reduce((total, weekday) => {
      let date = anchor + ((weekday + 6) % 7);
      if (date < first) date += period;
      return total + Math.max(0, Math.ceil((limit - date) / period));
    }, 0);
  }
  const origin = parseDate(start),
    end = parseDate(before),
    months = (end.getFullYear() - origin.getFullYear()) * 12 + end.getMonth() - origin.getMonth();
  let total = Math.ceil(months / rule.interval);
  if (
    months % rule.interval === 0 &&
    end.getDate() >
      Math.min(origin.getDate(), new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate())
  )
    total++;
  return total;
}
/** The returned list is bounded by the requested range; monthly dates clamp to month end. */
export function expandBlockDates(
  start: string,
  from: string,
  to: string,
  rule: BlockRecurrence,
  archivedFrom: string | null = null,
) {
  validateBlockRecurrence(rule);
  if (!validDate(start) || !validDate(from) || !validDate(to) || from > to)
    throw Error('Período inválido.');
  if (dayNumber(to) - dayNumber(from) > 370) throw Error('Consulte no máximo um ano por vez.');
  const result: string[] = [];
  let cursor = start > from ? start : from;
  let ordinal = rule.count === null ? 0 : occurrencesBefore(start, cursor, rule);
  for (; cursor <= to; cursor = addDays(cursor, 1)) {
    if ((rule.until && cursor > rule.until) || (archivedFrom && cursor >= archivedFrom)) break;
    if (!matches(start, cursor, rule)) continue;
    ordinal++;
    if (rule.count !== null && ordinal > rule.count) break;
    if (cursor >= from) result.push(cursor);
  }
  return result;
}
export function recurrenceSummary(rule: BlockRecurrence) {
  const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return rule.frequency === 'daily'
    ? 'Todos os dias'
    : rule.frequency === 'weekdays'
      ? 'Dias úteis'
      : rule.frequency === 'monthly'
        ? 'Todo mês (último dia quando necessário)'
        : `${rule.interval > 1 ? `A cada ${rule.interval} semanas · ` : ''}${rule.weekdays.map((d) => labels[d]).join(', ') || 'Toda semana'}`;
}
export function recurringBlockId(seriesId: string, date: string) {
  return `series:${seriesId}:${date}`;
}
export function parseRecurringBlockId(id: string) {
  const match = /^series:(.+):(\d{4}-\d{2}-\d{2})$/.exec(id);
  return match && validDate(match[2]) ? { seriesId: match[1], date: match[2] } : null;
}
export function currentArchiveDate() {
  return localDate(new Date());
}
