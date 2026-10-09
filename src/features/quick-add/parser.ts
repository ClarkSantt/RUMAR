import { addDays, localDate, parseDate, validDate } from '../../lib/dates';
import { parseMoney } from '../finance/domain';
import { minuteOf, timeOf } from '../calendar/planner-domain';

export type QuickMode =
  | 'auto'
  | 'task'
  | 'thought'
  | 'steps'
  | 'weight'
  | 'finance'
  | 'objective'
  | 'moment'
  | 'block'
  | 'milestone'
  | 'inbox';
export type QuickSuggestion =
  | { kind: 'task'; title: string; date: string | null; time: string | null; endTime?: string }
  | { kind: 'block'; title: string; date: string; time: string; endTime: string }
  | { kind: 'thought'; content: string }
  | { kind: 'steps'; value: number; date: string }
  | { kind: 'weight'; value: number; date: string }
  | { kind: 'objective'; name: string }
  | { kind: 'milestone'; title: string }
  | { kind: 'moment'; title: string; date: string }
  | {
      kind: 'finance';
      description: string;
      cents: number;
      transactionType: 'income' | 'expense';
      confirmed: false;
    }
  | { kind: 'inbox'; content: string };

function decimal(value: string): number | null {
  if (!/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$|^\d+(?:[,.]\d{1,2})?$/.test(value)) return null;
  const normalized = value.includes(',') ? value.replaceAll('.', '').replace(',', '.') : value;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}
const weekdays = new Map([
  ['domingo', 0],
  ['segunda', 1],
  ['terça', 2],
  ['terca', 2],
  ['quarta', 3],
  ['quinta', 4],
  ['sexta', 5],
  ['sábado', 6],
  ['sabado', 6],
]);

export function parseNaturalSchedule(
  input: string,
  today: string,
): { title: string; date: string | null; time: string | null; dayPeriod: string | null } {
  let title = input.trim();
  let date: string | null = null;
  let time: string | null = null;
  let dayPeriod: string | null = null;
  const timeMatch = title.match(/(?:^|\s)((?:[01]?\d|2[0-3])(?::[0-5]\d)?h?)(?=\s|$)/i);
  if (timeMatch) {
    const clean = timeMatch[1].toLowerCase().replace('h', '');
    time = clean.includes(':') ? clean.padStart(5, '0') : `${clean.padStart(2, '0')}:00`;
    title = title.replace(timeMatch[0], ' ').trim();
  }
  const period = title.match(
    /(?:^|\s)(de manhã|pela manhã|à tarde|a tarde|à noite|a noite)(?=\s|$)/i,
  );
  if (period) {
    const token = period[1].toLowerCase();
    dayPeriod = token.includes('manhã')
      ? 'morning'
      : token.includes('tarde')
        ? 'afternoon'
        : 'evening';
    time ??= dayPeriod === 'morning' ? '09:00' : dayPeriod === 'afternoon' ? '14:00' : '19:00';
    title = title.replace(period[0], ' ').trim();
  }
  const relative = title.match(
    /(?:^|\s)(hoje|amanhã|amanha|domingo|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado)(?:-feira)?(?=\s|$)/i,
  );
  if (relative) {
    const token = relative[1].toLowerCase();
    if (token === 'hoje') date = today;
    else if (token.startsWith('amanh')) date = addDays(today, 1);
    else {
      const weekday = parseDate(today).getDay();
      const target = weekdays.get(token) ?? weekday;
      const delta = (target - weekday + 7) % 7 || 7;
      date = addDays(today, delta);
    }
    title = title.replace(relative[0], '').trim();
  }
  const numeric = title.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?=\s|$)/);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3]) : Number(today.slice(0, 4));
    let candidate = `${year}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
    if (!numeric[3] && candidate < today)
      candidate = `${year + 1}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
    if (validDate(candidate)) {
      date = candidate;
      title = title.replace(numeric[0], ' ').trim();
    }
  }
  return { title, date, time, dayPeriod };
}
export function parseQuickAdd(
  raw: string,
  mode: QuickMode = 'auto',
  today = localDate(),
): QuickSuggestion {
  const input = raw.trim();
  if (!input) return { kind: 'inbox', content: '' };
  const prefix = input.match(
    /^\/(t|task|pensamento|note|peso|passos|gasto|receita|objetivo|momento|bloco|marco)\s+(.+)$/i,
  );
  let text = prefix?.[2]?.trim() ?? input;
  const explicit = prefix?.[1]?.toLowerCase();
  const selected: QuickMode =
    mode !== 'auto'
      ? mode
      : explicit === 'marco'
        ? 'milestone'
        : explicit === 'bloco'
          ? 'block'
          : explicit === 't' || explicit === 'task'
            ? 'task'
            : explicit === 'pensamento' || explicit === 'note'
              ? 'thought'
              : explicit === 'peso'
                ? 'weight'
                : explicit === 'passos'
                  ? 'steps'
                  : explicit === 'gasto' || explicit === 'receita'
                    ? 'finance'
                    : explicit === 'objetivo'
                      ? 'objective'
                      : explicit === 'momento'
                        ? 'moment'
                        : 'auto';
  const duration = text.match(/(?:\s+por)?\s+(\d+)\s*(h|min)(?:\s*(\d{1,2})\s*(?:min)?)?$/i);
  const durationMinutes = duration
    ? Number(duration[1]) * (duration[2].toLowerCase() === 'h' ? 60 : 1) + Number(duration[3] ?? 0)
    : null;
  if (duration && (selected === 'task' || selected === 'block' || selected === 'auto'))
    text = text.slice(0, duration.index).trim();
  if (selected === 'block') {
    const parsed = parseNaturalSchedule(text, today);
    const start = parsed.time ? minuteOf(parsed.time) : -1;
    if (
      parsed.title &&
      start >= 0 &&
      durationMinutes &&
      durationMinutes > 0 &&
      start + durationMinutes <= 1440
    )
      return {
        kind: 'block',
        title: parsed.title,
        date: parsed.date ?? today,
        time: parsed.time!,
        endTime: timeOf(start + durationMinutes),
      };
    return { kind: 'inbox', content: input };
  }
  if (selected === 'objective' && text.length <= 160) return { kind: 'objective', name: text };
  if (selected === 'milestone' && text.length <= 160) return { kind: 'milestone', title: text };
  if (selected === 'moment' && text.length <= 160)
    return { kind: 'moment', title: text, date: today };
  const weightText =
    selected === 'weight' ? text.replace(/^peso\s*/i, '') : input.match(/^peso\s+(.+)$/i)?.[1];
  if (weightText && (selected === 'weight' || mode === 'auto')) {
    const value = decimal(weightText.replace(/\s*kg$/i, ''));
    if (value !== null && value >= 20 && value <= 500)
      return { kind: 'weight', value, date: today };
  }
  const stepsText =
    selected === 'steps'
      ? text.replace(/\s*passos?$/i, '')
      : input.match(/^([\d.]+)\s+passos?$/i)?.[1];
  if (stepsText && (selected === 'steps' || mode === 'auto')) {
    const value = Number(stepsText.replaceAll('.', ''));
    if (Number.isInteger(value) && value >= 0 && value <= 200000)
      return { kind: 'steps', value, date: today };
  }
  if (selected === 'thought' || (selected === 'auto' && /^ideia\s*:/i.test(text)))
    return { kind: 'thought', content: text.replace(/^ideia\s*:\s*/i, '') };
  if (selected === 'finance' || (selected === 'auto' && /^[^\d]+\s+\d[\d.,]*$/.test(text))) {
    const match = text.match(/^(.+?)\s+(\d[\d.,]*)$/);
    if (match) {
      try {
        const cents = parseMoney(match[2]);
        if (cents > 0)
          return {
            kind: 'finance',
            description: match[1].trim(),
            cents,
            transactionType: explicit === 'receita' ? 'income' : 'expense',
            confirmed: false,
          };
      } catch {
        /* Ambiguous input is kept in Inbox. */
      }
    }
  }
  if (
    selected === 'task' ||
    (selected === 'auto' &&
      /(?:^|\s)(?:hoje|amanhã|amanha|domingo|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado)(?:-feira)?(?=\s|$)|\d{1,2}\/\d{1,2}(?:\/\d{4})?/i.test(
        text,
      ))
  ) {
    const parsed = parseNaturalSchedule(text, today);
    if (parsed.title && (!parsed.time || parsed.date)) {
      const taskSchedule = { title: parsed.title, date: parsed.date, time: parsed.time };
      if (durationMinutes !== null) {
        if (
          !parsed.time ||
          !parsed.date ||
          durationMinutes <= 0 ||
          minuteOf(parsed.time) + durationMinutes > 1440
        )
          return { kind: 'inbox', content: input };
        return {
          kind: 'task',
          ...taskSchedule,
          endTime: timeOf(minuteOf(parsed.time) + durationMinutes),
        };
      }
      return { kind: 'task', ...taskSchedule };
    }
  }
  if (selected === 'inbox') return { kind: 'inbox', content: text };
  return { kind: 'inbox', content: input };
}
