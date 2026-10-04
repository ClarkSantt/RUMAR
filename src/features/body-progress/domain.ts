export const metrics = [
  ['weight', 'Peso', 'kg'],
  ['body_fat', 'Percentual de gordura', '%'],
  ['neck', 'Pescoço', 'cm'],
  ['shoulders', 'Ombros', 'cm'],
  ['chest', 'Tórax', 'cm'],
  ['waist', 'Cintura', 'cm'],
  ['abdomen', 'Abdômen', 'cm'],
  ['hips', 'Quadril', 'cm'],
  ['left_arm', 'Braço esquerdo', 'cm'],
  ['right_arm', 'Braço direito', 'cm'],
  ['left_forearm', 'Antebraço esquerdo', 'cm'],
  ['right_forearm', 'Antebraço direito', 'cm'],
  ['left_thigh', 'Coxa esquerda', 'cm'],
  ['right_thigh', 'Coxa direita', 'cm'],
  ['left_calf', 'Panturrilha esquerda', 'cm'],
  ['right_calf', 'Panturrilha direita', 'cm'],
] as const;
export type MetricKey = (typeof metrics)[number][0];
export type Measurements = Partial<Record<MetricKey, number>>;
export interface BodyRecord {
  date: string;
  notes: string;
  values: Measurements;
  created_at: string;
  updated_at: string;
}
export function parseMeasurement(value: string | number, key: MetricKey): number {
  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1000)
    throw Error(`${metrics.find(([id]) => id === key)?.[1]}: informe um valor positivo válido.`);
  if (key === 'body_fat' && parsed > 100)
    throw Error('Percentual de gordura deve ser no máximo 100%.');
  return parsed;
}
export function formatMeasurement(value: number, unit: string): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)} ${unit}`;
}
export function comparison(a: BodyRecord | undefined, b: BodyRecord | undefined) {
  return metrics
    .filter(([key]) => a?.values[key] != null || b?.values[key] != null)
    .map(([key, label, unit]) => ({
      key,
      label,
      unit,
      a: a?.values[key],
      b: b?.values[key],
      change:
        a?.values[key] != null && b?.values[key] != null
          ? Math.round((b.values[key]! - a.values[key]!) * 100) / 100
          : null,
    }));
}
