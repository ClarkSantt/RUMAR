import { normalizeDescription } from '../finance/domain';

const MAX_ROWS = 10_000;
export interface FinanceColumns {
  date: number;
  description: number;
  amount: number;
  type?: number;
  account?: number;
  category?: number;
}
export interface FinanceImportRow {
  id: string;
  date: string;
  description: string;
  normalized_description: string;
  amount_cents: number;
  transaction_type: 'income' | 'expense';
  account_name: string;
  category_name: string;
  account_id: string | null;
  category_id: string | null;
  notes: string;
}
export interface BodyImportRow {
  id: string;
  date: string;
  notes: string;
  metrics: Record<string, number>;
}
export interface CalendarImportRow {
  id: string;
  uid: string;
  summary: string;
  description: string;
  start_date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
}

export function parseCsv(text: string): string[][] {
  if (text.length > 10_000_000) throw new Error('Arquivo CSV maior que 10 MB.');
  const input = text.replace(/^\uFEFF/, '');
  const first = input.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', ',', '\t'].sort(
    (a, b) => first.split(b).length - first.split(a).length,
  )[0];
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false,
    endedQuote = false;
  for (let index = 0; index < input.length; index++) {
    const ch = input[index];
    if (quoted) {
      if (ch === '"' && input[index + 1] === '"') {
        value += '"';
        index++;
      } else if (ch === '"') {
        quoted = false;
        endedQuote = true;
      } else value += ch;
      continue;
    }
    if (ch === '"' && value === '' && !endedQuote) {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(value);
      value = '';
      endedQuote = false;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[index + 1] === '\n') index++;
      row.push(value);
      if (row.some((cell) => cell !== '')) rows.push(row);
      if (rows.length > MAX_ROWS + 1) throw new Error('Arquivo com mais de 10 mil linhas.');
      row = [];
      value = '';
      endedQuote = false;
      continue;
    }
    if (endedQuote || ch === '"') throw new Error(`CSV inválido na linha ${rows.length + 1}.`);
    value += ch;
  }
  if (quoted) throw new Error('Aspas não fechadas no CSV.');
  if (value !== '' || row.length) {
    row.push(value);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  if (rows.length < 2) throw new Error('CSV precisa de cabeçalho e ao menos uma linha.');
  return rows;
}
export function datePt(value: string): string {
  const text = value.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : br ? `${br[3]}-${br[2]}-${br[1]}` : '';
  const date = new Date(`${iso}T12:00:00Z`);
  if (!iso || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso)
    throw new Error(`Data inválida: ${value}`);
  return iso;
}
export function decimalPt(value: string): number {
  let text = value
    .trim()
    .replace(/^(R\$|kg)\s*/i, '')
    .replace(/\s/g, '');
  if (!text) throw new Error('Número vazio.');
  if (/^[-+]?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text))
    text = text.replaceAll('.', '').replace(',', '.');
  else if (/^[-+]?\d+(,\d+)?$/.test(text)) text = text.replace(',', '.');
  else if (!/^[-+]?\d+(\.\d+)?$/.test(text)) throw new Error(`Número inválido: ${value}`);
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`Número inválido: ${value}`);
  return parsed;
}
export function financeRows(
  rows: string[][],
  columns: FinanceColumns,
  defaultType: 'expense' | 'income',
): FinanceImportRow[] {
  const required = [columns.date, columns.description, columns.amount];
  if (required.some((i) => !Number.isInteger(i) || i < 0 || i >= rows[0].length))
    throw new Error('Mapeie data, descrição e valor.');
  return rows.slice(1).map((row, index) => {
    try {
      const date = datePt(row[columns.date] ?? '');
      const description = (row[columns.description] ?? '').trim();
      if (!description || description.length > 500)
        throw new Error('Descrição vazia ou longa demais.');
      const amount = decimalPt(row[columns.amount] ?? '');
      const cents = Math.round(Math.abs(amount) * 100);
      if (cents < 1 || !Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) > 0.001)
        throw new Error('Valor monetário inválido.');
      const typeText =
        columns.type == null || columns.type < 0
          ? ''
          : (row[columns.type] ?? '').trim().toLowerCase();
      if (typeText && !['receita', 'income', 'despesa', 'expense'].includes(typeText))
        throw new Error(`Tipo financeiro desconhecido: ${typeText}.`);
      const type =
        typeText.includes('receita') || typeText.includes('income')
          ? 'income'
          : typeText.includes('despesa') || typeText.includes('expense')
            ? 'expense'
            : amount < 0
              ? 'expense'
              : defaultType;
      return {
        id: crypto.randomUUID(),
        date,
        description,
        normalized_description: normalizeDescription(description),
        amount_cents: cents,
        transaction_type: type,
        account_name:
          columns.account == null || columns.account < 0 ? '' : (row[columns.account] ?? '').trim(),
        category_name:
          columns.category == null || columns.category < 0
            ? ''
            : (row[columns.category] ?? '').trim(),
        account_id: null,
        category_id: null,
        notes: '',
      };
    } catch (error) {
      throw new Error(`Linha ${index + 2}: ${String(error)}`, { cause: error });
    }
  });
}

const comparable = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
export function resolveFinanceRows(
  rows: FinanceImportRow[],
  accounts: { id: string; name: string }[],
  categories: { id: string; name: string; kind: 'expense' | 'income' }[],
): FinanceImportRow[] {
  return rows.map((row, index) => {
    const accountMatches = row.account_name
      ? accounts.filter((item) => comparable(item.name) === comparable(row.account_name))
      : [];
    const categoryMatches = row.category_name
      ? categories.filter(
          (item) =>
            item.kind === row.transaction_type &&
            comparable(item.name) === comparable(row.category_name),
        )
      : [];
    if (row.account_name && accountMatches.length !== 1)
      throw new Error(`Linha ${index + 2}: conta não encontrada ou ambígua: ${row.account_name}.`);
    if (row.category_name && categoryMatches.length !== 1)
      throw new Error(
        `Linha ${index + 2}: categoria não encontrada ou ambígua: ${row.category_name}.`,
      );
    return {
      ...row,
      account_id: accountMatches[0]?.id ?? null,
      category_id: categoryMatches[0]?.id ?? null,
    };
  });
}
export function probableFinanceDuplicates(
  incoming: FinanceImportRow[],
  existing: {
    date: string;
    amount_cents: number;
    normalized_description: string;
    account_id: string;
  }[],
  fallbackAccountId: string,
): number {
  const keys = new Set(
    existing.map(
      (row) => `${row.date}|${row.amount_cents}|${row.normalized_description}|${row.account_id}`,
    ),
  );
  return incoming.filter((row) =>
    keys.has(
      `${row.date}|${row.amount_cents}|${row.normalized_description}|${row.account_id ?? fallbackAccountId}`,
    ),
  ).length;
}

export interface CsvValidation<T> {
  values: T[];
  issues: string[];
}
export function validateFinanceCsv(
  rows: string[][],
  columns: FinanceColumns,
  defaultType: 'expense' | 'income',
  accounts: { id: string; name: string }[],
  categories: { id: string; name: string; kind: 'expense' | 'income' }[],
): CsvValidation<FinanceImportRow> {
  const values: FinanceImportRow[] = [],
    issues: string[] = [];
  for (let index = 1; index < rows.length; index++) {
    try {
      values.push(
        ...resolveFinanceRows(
          financeRows([rows[0], rows[index]], columns, defaultType),
          accounts,
          categories,
        ),
      );
    } catch (error) {
      issues.push(
        `Linha ${index + 1}: ${String(error).replace(/^Error: (Linha 2: )?(Error: )?/, '')}`,
      );
    }
  }
  return { values, issues };
}
export function validateBodyCsv(rows: string[][]): CsvValidation<BodyImportRow> {
  const values: BodyImportRow[] = [],
    issues: string[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < rows.length; index++) {
    try {
      const parsed = bodyRows([rows[0], rows[index]])[0];
      if (seen.has(parsed.date)) throw new Error('Data repetida no arquivo.');
      seen.add(parsed.date);
      values.push(parsed);
    } catch (error) {
      issues.push(
        `Linha ${index + 1}: ${String(error).replace(/^Error: (Linha 2: )?(Error: )?/, '')}`,
      );
    }
  }
  return { values, issues };
}

const bodyColumns: Record<string, string> = {
  weight_kg: 'weight',
  body_fat_pct: 'body_fat',
  waist_cm: 'waist',
  chest_cm: 'chest',
  left_arm_cm: 'left_arm',
  right_arm_cm: 'right_arm',
  neck_cm: 'neck',
  hips_cm: 'hips',
};
export function bodyRows(rows: string[][]): BodyImportRow[] {
  const headers = rows[0].map((v) => v.trim().toLowerCase());
  const dateIndex = headers.findIndex((v) => v === 'date' || v === 'data');
  if (dateIndex < 0) throw new Error('Coluna date/data não encontrada.');
  const seen = new Set<string>();
  return rows.slice(1).map((row, index) => {
    try {
      const date = datePt(row[dateIndex] ?? '');
      if (seen.has(date)) throw new Error('Data duplicada no arquivo.');
      seen.add(date);
      const metrics: Record<string, number> = {};
      for (const [column, key] of Object.entries(bodyColumns)) {
        const position = headers.indexOf(column);
        if (position < 0 || !(row[position] ?? '').trim()) continue;
        const value = decimalPt(row[position]);
        if (value <= 0 || value >= 1000 || (key === 'body_fat' && value > 100))
          throw new Error(`Valor inválido em ${column}.`);
        metrics[key] = value;
      }
      if (!Object.keys(metrics).length) throw new Error('Nenhuma medida presente.');
      return { id: crypto.randomUUID(), date, notes: '', metrics };
    } catch (error) {
      throw new Error(`Linha ${index + 2}: ${String(error)}`, { cause: error });
    }
  });
}

function decodeIcs(value: string) {
  return value.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');
}
function icsDate(value: string): { date: string; time: string | null } {
  if (/^\d{8}$/.test(value))
    return {
      date: datePt(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`),
      time: null,
    };
  if (!/^\d{8}T\d{6}Z?$/.test(value)) throw new Error('Data ICS não suportada.');
  const raw = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  datePt(raw);
  const time = `${value.slice(9, 11)}:${value.slice(11, 13)}`;
  if (
    Number(value.slice(9, 11)) > 23 ||
    Number(value.slice(11, 13)) > 59 ||
    Number(value.slice(13, 15)) > 59
  )
    throw new Error('Horário ICS inválido.');
  if (value.endsWith('Z')) {
    const instant = new Date(`${raw}T${time}:${value.slice(13, 15)}Z`);
    return {
      date: [
        instant.getFullYear(),
        String(instant.getMonth() + 1).padStart(2, '0'),
        String(instant.getDate()).padStart(2, '0'),
      ].join('-'),
      time: `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`,
    };
  }
  return { date: raw, time };
}
export function parseIcs(text: string): CalendarImportRow[] {
  if (text.length > 5_000_000) throw new Error('ICS maior que 5 MB.');
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  }
  if (!unfolded.includes('BEGIN:VCALENDAR') || !unfolded.includes('END:VCALENDAR'))
    throw new Error('Calendário ICS inválido.');
  const output: CalendarImportRow[] = [];
  let event: Record<string, string> | null = null;
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') {
      if (event) throw new Error('VEVENT aninhado inválido.');
      event = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (!event) throw new Error('VEVENT inválido.');
      if (event.RRULE) throw new Error('Recorrência ICS não é suportada nesta importação.');
      if (!event.UID || !event.SUMMARY || !event.DTSTART)
        throw new Error('Evento sem UID, título ou início.');
      const start = icsDate(event.DTSTART),
        end = event.DTEND ? icsDate(event.DTEND) : null;
      output.push({
        id: crypto.randomUUID(),
        uid: event.UID.slice(0, 512),
        summary: decodeIcs(event.SUMMARY).slice(0, 500),
        description: decodeIcs(event.DESCRIPTION ?? '').slice(0, 4000),
        start_date: start.date,
        start_time: start.time,
        end_date: end?.date ?? null,
        end_time: end?.time ?? null,
      });
      if (output.length > MAX_ROWS) throw new Error('ICS com mais de 10 mil eventos.');
      event = null;
      continue;
    }
    if (!event) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const name = line.slice(0, separator).split(';')[0].toUpperCase();
    if (line.slice(0, separator).toUpperCase().includes('TZID='))
      throw new Error('ICS com fuso TZID requer conversão explícita; importe datas locais ou UTC.');
    if (['UID', 'SUMMARY', 'DESCRIPTION', 'DTSTART', 'DTEND', 'RRULE'].includes(name))
      event[name] = line.slice(separator + 1);
  }
  if (event || !output.length) throw new Error('Nenhum evento ICS válido.');
  if (new Set(output.map((v) => v.uid)).size !== output.length)
    throw new Error('UID repetido no ICS.');
  return output;
}
