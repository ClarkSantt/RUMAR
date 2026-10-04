import { validDate } from '../../lib/dates';
export function minuteOf(time: string): number {
  if (time === '24:00') return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('Horário inválido.');
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}
export function timeOf(minute: number) {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1440) throw Error('Horário inválido.');
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
export function validateBlock(date: string, start: string, end: string) {
  if (!validDate(date) || minuteOf(start) >= 1440 || minuteOf(end) <= minuteOf(start))
    throw Error('Blocos devem terminar no mesmo dia, depois do início.');
}
export function movedTimes(start: string, end: string, next: number) {
  const duration = minuteOf(end) - minuteOf(start);
  const safe = Math.max(0, Math.min(1440 - duration, Math.round(next / 15) * 15));
  return { start: timeOf(safe), end: timeOf(safe + duration) };
}
export function layoutOverlaps<T extends { id: string; start_time: string; end_time: string }>(
  blocks: T[],
) {
  const sorted = [...blocks].sort(
    (a, b) =>
      minuteOf(a.start_time) - minuteOf(b.start_time) ||
      minuteOf(a.end_time) - minuteOf(b.end_time),
  );
  const result: (T & { column: number; columns: number; conflict: boolean })[] = [];
  let group: typeof result = [];
  let maxEnd = -1;
  const flush = () => {
    const columns = Math.max(1, ...group.map((b) => b.column + 1));
    result.push(...group.map((b) => ({ ...b, columns, conflict: columns > 1 })));
    group = [];
  };
  for (const block of sorted) {
    const start = minuteOf(block.start_time);
    if (start >= maxEnd) {
      flush();
      maxEnd = -1;
    }
    let column = 0;
    while (group.some((b) => b.column === column && minuteOf(b.end_time) > start)) column++;
    group.push({ ...block, column, columns: 1, conflict: false });
    maxEnd = Math.max(maxEnd, minuteOf(block.end_time));
  }
  flush();
  return result;
}
export function checkpointSeconds(last: string, now: string) {
  // A delayed heartbeat must not credit suspension/offline time.
  const elapsed = Math.floor((Date.parse(now) - Date.parse(last)) / 1000);
  return elapsed >= 0 && elapsed <= 15 ? elapsed : 0;
}
export function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
    : `${minutes} min`;
}
