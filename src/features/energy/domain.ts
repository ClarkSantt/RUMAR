export interface EnergyProfile {
  automatic?: boolean;
  balance_override?: number | null;
  birth_date: string;
  height_cm: number;
  biological_parameter: 'male' | 'female';
  method: 'mifflin';
  base_factor: number;
  habitual_steps: number;
  step_adjustment: boolean;
  kcal_per_1000_steps: number | null;
  objective: 'lose' | 'maintain' | 'gain' | 'custom';
  balance: number;
  balance_period: 'day' | 'week';
  dynamic_goals: boolean;
  macro_strategy: 'manual' | 'percent' | 'per_kg';
  protein: number;
  carbs: number;
  fat: number;
}
export const BASE_ACTIVITY_FACTOR = 1.2;
export const BASELINE_STEPS = 5000;
export const WALKING_MET = 3;
export const WALKING_STEPS_PER_MINUTE = 100;
export const GENERAL_RESISTANCE_MET = 3.5;
export const DEFAULT_GOAL_ADJUSTMENT = 250;
export function generalProfile(
  birth_date: string,
  height_cm: number,
  biological_parameter: EnergyProfile['biological_parameter'],
  objective: 'lose' | 'maintain' | 'gain',
  previous?: EnergyProfile | null,
): EnergyProfile {
  return {
    birth_date,
    height_cm,
    biological_parameter,
    objective,
    method: 'mifflin',
    automatic: true,
    balance_override: previous?.balance_override ?? null,
    base_factor: BASE_ACTIVITY_FACTOR,
    habitual_steps: BASELINE_STEPS,
    step_adjustment: false,
    kcal_per_1000_steps: null,
    balance: 0,
    balance_period: 'day',
    dynamic_goals: true,
    macro_strategy: previous?.macro_strategy ?? 'manual',
    protein: previous?.protein ?? 0,
    carbs: previous?.carbs ?? 0,
    fat: previous?.fat ?? 0,
  };
}
export interface WorkoutEnergy {
  method: 'off' | 'manual' | 'estimated';
  minutes: number | null;
  met: number | null;
  calories: number | null;
}
export function civilDate(value: string) {
  const d = new Date(`${value}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== value
  )
    throw Error('Data inválida.');
  return d;
}
export function ageOn(birth: string, day: string) {
  civilDate(birth);
  civilDate(day);
  let age = Number(day.slice(0, 4)) - Number(birth.slice(0, 4));
  if (day.slice(5) < birth.slice(5)) age--;
  return age;
}
export function validateProfile(p: EnergyProfile, day: string) {
  const age = ageOn(p.birth_date, day);
  if (age < 18 || age > 120)
    throw Error('A estimativa Mifflin está disponível para adultos; confira a data de nascimento.');
  const finite = [
    p.height_cm,
    p.base_factor,
    p.habitual_steps,
    p.balance,
    p.protein,
    p.carbs,
    p.fat,
  ];
  if (
    !finite.every(Number.isFinite) ||
    p.height_cm < 100 ||
    p.height_cm > 250 ||
    p.base_factor < 1 ||
    p.base_factor > 3 ||
    !Number.isInteger(p.habitual_steps) ||
    p.habitual_steps < 0 ||
    p.habitual_steps > 200000 ||
    Math.abs(p.balance) > 20000 ||
    [p.protein, p.carbs, p.fat].some((n) => n < 0 || n > 5000)
  )
    throw Error('Confira os valores do perfil energético.');
  if (
    !['male', 'female'].includes(p.biological_parameter) ||
    p.method !== 'mifflin' ||
    !['lose', 'maintain', 'gain', 'custom'].includes(p.objective) ||
    !['day', 'week'].includes(p.balance_period) ||
    !['manual', 'percent', 'per_kg'].includes(p.macro_strategy)
  )
    throw Error('Configuração energética inválida.');
  if (
    p.step_adjustment &&
    !p.automatic &&
    (!Number.isFinite(p.kcal_per_1000_steps) ||
      p.kcal_per_1000_steps! <= 0 ||
      p.kcal_per_1000_steps! > 1000)
  )
    throw Error('Informe sua estimativa explícita de kcal por 1.000 passos ou desative o ajuste.');
  if (p.macro_strategy === 'percent' && Math.abs(p.protein + p.carbs + p.fat - 100) > 0.001)
    throw Error('Os percentuais devem somar 100%.');
  if (
    p.balance_override != null &&
    (!Number.isFinite(p.balance_override) || Math.abs(p.balance_override) > 20000)
  )
    throw Error('Confira o ajuste energético escolhido.');
}
export function restingEnergy(p: EnergyProfile, weight: number, day: string) {
  validateProfile(p, day);
  if (!Number.isFinite(weight) || weight <= 0 || weight >= 1000) throw Error('Peso inválido.');
  return (
    10 * weight +
    6.25 * p.height_cm -
    5 * ageOn(p.birth_date, day) +
    (p.biological_parameter === 'male' ? 5 : -161)
  );
}
export function desiredBalance(p: EnergyProfile) {
  if (p.automatic) {
    const magnitude = p.balance_override ?? DEFAULT_GOAL_ADJUSTMENT;
    return p.objective === 'lose'
      ? -Math.abs(magnitude)
      : p.objective === 'gain'
        ? Math.abs(magnitude)
        : 0;
  }
  const value = p.balance_period === 'week' ? p.balance / 7 : p.balance;
  return p.objective === 'maintain'
    ? 0
    : p.objective === 'lose'
      ? -Math.abs(value)
      : p.objective === 'gain'
        ? Math.abs(value)
        : value;
}
// Approximation: 3 MET walking at a 100-step/min cadence; only the net energy
// above rest is added. Step count alone cannot determine actual intensity.
export function automaticStepAdjustment(weight: number, steps: number) {
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(steps)) return 0;
  const minutes = (steps - BASELINE_STEPS) / WALKING_STEPS_PER_MINUTE;
  return ((WALKING_MET - 1) * 3.5 * weight * minutes) / 200;
}
export function stepAdjustment(p: EnergyProfile, steps: number | null) {
  return p.step_adjustment && steps !== null
    ? ((steps - p.habitual_steps) / 1000) * p.kcal_per_1000_steps!
    : 0;
}
// Net MET energy subtracts the resting component already included in the daily base.
export function workoutCalories(
  e: WorkoutEnergy | undefined,
  weight: number,
  duration?: number | null,
) {
  if (e?.method === 'off') return 0;
  if (!e)
    return workoutCalories(
      { method: 'estimated', minutes: null, met: GENERAL_RESISTANCE_MET, calories: null },
      weight,
      duration,
    );
  if (e.method === 'manual') return e.calories ?? 0;
  const minutes = e.minutes ?? duration;
  return minutes != null && minutes > 0 && e.met != null
    ? (((e.met - 1) * 3.5 * weight) / 200) * minutes
    : 0;
}
export function macroGoals(p: EnergyProfile, calories: number, weight: number) {
  const protein =
    p.macro_strategy === 'manual'
      ? p.protein
      : p.macro_strategy === 'percent'
        ? (calories * p.protein) / 100 / 4
        : p.protein * weight;
  const fat =
    p.macro_strategy === 'manual'
      ? p.fat
      : p.macro_strategy === 'percent'
        ? (calories * p.fat) / 100 / 9
        : p.fat * weight;
  const carbs =
    p.macro_strategy === 'manual'
      ? p.carbs
      : p.macro_strategy === 'percent'
        ? (calories * p.carbs) / 100 / 4
        : Math.max(0, (calories - protein * 4 - fat * 9) / 4);
  return {
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    macro_calories: protein * 4 + carbs * 4 + fat * 9,
    insufficient: protein * 4 + fat * 9 > calories,
  };
}
