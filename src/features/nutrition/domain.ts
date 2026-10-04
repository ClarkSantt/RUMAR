export const nutrientInfo = {
  energy_kcal: ['Calorias', 'kcal'],
  carbohydrate_g: ['Carboidratos', 'g'],
  protein_g: ['Proteínas', 'g'],
  fat_g: ['Gorduras', 'g'],
  fiber_g: ['Fibras', 'g'],
  sodium_mg: ['Sódio', 'mg'],
  calcium_mg: ['Cálcio', 'mg'],
  iron_mg: ['Ferro', 'mg'],
  potassium_mg: ['Potássio', 'mg'],
  magnesium_mg: ['Magnésio', 'mg'],
  phosphorus_mg: ['Fósforo', 'mg'],
  zinc_mg: ['Zinco', 'mg'],
  vitamin_c_mg: ['Vitamina C', 'mg'],
  vitamin_a_mcg_rae: ['Vitamina A (RAE)', 'mcg'],
  vitamin_b1_mg: ['Vitamina B1', 'mg'],
  vitamin_b2_mg: ['Vitamina B2', 'mg'],
  vitamin_b3_mg: ['Vitamina B3', 'mg'],
  vitamin_b6_mg: ['Vitamina B6', 'mg'],
  vitamin_b12_mcg: ['Vitamina B12', 'mcg'],
  folate_mcg: ['Folato', 'mcg'],
  vitamin_d_mcg: ['Vitamina D', 'mcg'],
  vitamin_e_mg: ['Vitamina E', 'mg'],
} as const;
export type NutrientKey = keyof typeof nutrientInfo;
export type Nutrients = Partial<Record<NutrientKey, number>>;
export const macroKeys = ['energy_kcal', 'carbohydrate_g', 'protein_g', 'fat_g'] as const;
export type FoodUnit = 'g' | 'ml' | 'unidade' | 'colher' | 'xícara' | 'porção';
export const foodUnits: FoodUnit[] = ['g', 'ml', 'unidade', 'colher', 'xícara', 'porção'];

export function positiveNumber(value: string | number, label = 'Quantidade'): number {
  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0) throw Error(`${label} deve ser maior que zero.`);
  return number;
}
export function nonnegativeNumber(value: string | number, label = 'Nutriente'): number {
  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) throw Error(`${label} deve ser zero ou maior.`);
  return number;
}
export function requireName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 300) throw Error('Informe um nome de até 300 caracteres.');
  return name;
}
export function portion(base: Nutrients, grams: number, baseAmount: number): Nutrients {
  const scale = positiveNumber(grams) / positiveNumber(baseAmount);
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [key, value * scale]),
  ) as Nutrients;
}
export function sumNutrients(parts: Nutrients[]): Nutrients {
  const total: Nutrients = {};
  for (const part of parts)
    for (const [key, value] of Object.entries(part) as [NutrientKey, number][]) {
      if (Number.isFinite(value)) total[key] = (total[key] ?? 0) + value;
    }
  return total;
}
export function remaining(consumed: number | undefined, goal: number | null | undefined) {
  return goal == null ? null : goal - (consumed ?? 0);
}
export function formatAmount(value: number | undefined, digits = 1) {
  return value == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value);
}
