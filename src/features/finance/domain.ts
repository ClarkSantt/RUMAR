export function parseMoney(input: string): number {
  const value = input.trim().replace(/^R\$\s*/, '');
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(value))
    throw Error('Informe um valor em reais, como 1.234,56.');
  const [whole, fraction = ''] = value.split(',');
  const cents = Number(whole.replaceAll('.', '')) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw Error('Valor monetário fora do limite seguro.');
  return cents;
}
export function money(cents: number, hidden = false): string {
  if (hidden) return 'R$ •••••';
  if (!Number.isSafeInteger(cents)) throw Error('Valor monetário inválido.');
  const absolute = Math.abs(cents);
  const whole = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(
    Math.floor(absolute / 100),
  );
  return `${cents < 0 ? '-' : ''}R$\u00a0${whole},${String(absolute % 100).padStart(2, '0')}`;
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function projectedMonthExpense(
  realizedCents: number,
  elapsedDays: number,
  daysInMonth: number,
  pendingRecurringCents = 0,
) {
  if (elapsedDays <= 0 || daysInMonth < elapsedDays) return realizedCents + pendingRecurringCents;
  const paceRemaining = Math.round((realizedCents / elapsedDays) * (daysInMonth - elapsedDays));
  return realizedCents + Math.max(paceRemaining, pendingRecurringCents);
}

export function monthChangePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function detectCategoryOutliers(
  rows: { category: string; month: string; cents: number }[],
  currentMonth: string,
) {
  const byCategory = new Map<string, { current: number; history: number[] }>();
  for (const row of rows) {
    const value = byCategory.get(row.category) ?? { current: 0, history: [] };
    if (row.month === currentMonth) value.current += row.cents;
    else if (row.cents > 0) value.history.push(row.cents);
    byCategory.set(row.category, value);
  }
  return [...byCategory]
    .map(([category, value]) => {
      const baseline = median(value.history);
      return {
        category,
        current_cents: value.current,
        baseline_cents: Math.round(baseline),
        ratio: baseline ? Math.round((value.current / baseline) * 100) / 100 : 0,
      };
    })
    .filter(
      (row) =>
        row.baseline_cents > 0 &&
        row.ratio >= 1.5 &&
        row.current_cents - row.baseline_cents >= 1000,
    )
    .sort((a, b) => b.ratio - a.ratio);
}
export function validCents(value: number, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw Error('Valor monetário inválido.');
  return value;
}
export function validDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Data inválida.');
  const [y, m, d] = date.split('-').map(Number);
  const check = new Date(y, m - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d)
    throw Error('Data inválida.');
  return date;
}
export function normalizeDescription(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}
export function available(income: number, expense: number, reserved: number): number {
  return income - expense - reserved;
}
export interface ProjectionPoint {
  month: string;
  amount_cents: number;
}
export function projectGoal(
  currentCents: number,
  targetCents: number,
  monthlyContributionCents: number,
  annualRatePercent: number,
  startMonth: string,
  maxMonths = 600,
): ProjectionPoint[] {
  validCents(currentCents, true);
  validCents(targetCents);
  validCents(monthlyContributionCents, true);
  if (!Number.isFinite(annualRatePercent) || annualRatePercent < 0 || annualRatePercent > 1000)
    throw Error('Taxa anual inválida.');
  if (
    !/^\d{4}-\d{2}$/.test(startMonth) ||
    Number(startMonth.slice(5)) > 12 ||
    Number(startMonth.slice(5)) < 1
  )
    throw Error('Mês inicial inválido.');
  const points: ProjectionPoint[] = [{ month: startMonth, amount_cents: currentCents }];
  if (currentCents >= targetCents) return points;
  const monthlyRate = Math.pow(1 + annualRatePercent / 100, 1 / 12) - 1;
  const [year, month] = startMonth.split('-').map(Number);
  let amount = currentCents;
  for (let i = 1; i <= maxMonths; i++) {
    // Round each month's estimated yield to a whole cent; contribution is end of month.
    amount = Math.round(amount * (1 + monthlyRate)) + monthlyContributionCents;
    if (!Number.isSafeInteger(amount)) throw Error('Projeção excede o limite monetário seguro.');
    const date = new Date(year, month - 1 + i, 1);
    points.push({
      month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      amount_cents: amount,
    });
    if (amount >= targetCents) break;
    if (monthlyContributionCents === 0 && monthlyRate === 0) break;
  }
  return points;
}
