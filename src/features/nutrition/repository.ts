import type { SqlConnection } from '../../lib/database/connection';
import { BodyProgressRepository } from '../body-progress/repository';
import { EnergyRepository } from '../energy/repository';
import {
  foodUnits,
  nonnegativeNumber,
  positiveNumber,
  requireName,
  portion,
  nutrientInfo,
  type Nutrients,
  type NutrientKey,
} from './domain';
import type {
  Food,
  FoodInput,
  NutrientRow,
  Meal,
  MealItem,
  DietPlan,
  DietMeal,
  DiaryEntry,
  WeightEntry,
  Goals,
  QuantityInput,
} from './types';

// A source is identified in data, not in calculation code. A TBCA importer can
// add its own source and foods without changing meals, plans, or the diary.
export interface FoodDataSource {
  readonly id: string;
  search(query: string, limit?: number): Promise<Food[]>;
}
export class SqlFoodSource implements FoodDataSource {
  constructor(
    readonly id: string,
    private readonly db: SqlConnection,
  ) {}
  search(query: string, limit = 50) {
    return new NutritionRepository(this.db).searchFoods(query, this.id, limit);
  }
}
const stamp = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
function checkedQuantity(input: QuantityInput) {
  if (!foodUnits.includes(input.unit)) throw Error('Unidade inválida.');
  return [positiveNumber(input.quantity), positiveNumber(input.grams_equivalent)];
}
function checkedNutrients(input: Nutrients) {
  const result: Nutrients = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!(key in nutrientInfo)) throw Error('Nutriente desconhecido.');
    if (raw !== undefined) result[key as NutrientKey] = nonnegativeNumber(raw);
  }
  return result;
}
export class NutritionRepository {
  constructor(private readonly db: SqlConnection) {}

  searchFoods(query = '', source = '', limit = 50, category = '') {
    return this.db.select<Food[]>(
      `SELECT * FROM foods WHERE archived_at IS NULL AND ($2='' OR source_id=$2)
       AND ($4='' OR category=$4) AND ($1='' OR instr(lower(name),lower($1))>0)
       ORDER BY CASE WHEN lower(name)=lower($1) THEN 0 WHEN lower(name) LIKE lower($1)||'%' THEN 1 ELSE 2 END,name LIMIT $3`,
      [query.trim(), source, Math.max(1, Math.min(100, limit)), category],
    );
  }
  food(id: string) {
    return this.db
      .select<Food[]>('SELECT * FROM foods WHERE id=$1', [id])
      .then((rows) => rows[0] ?? null);
  }
  nutrientRows(foodId: string) {
    return this.db.select<NutrientRow[]>(
      'SELECT * FROM food_nutrients WHERE food_id=$1 ORDER BY nutrient_key',
      [foodId],
    );
  }
  async nutrients(foodId: string): Promise<Nutrients> {
    const rows = await this.nutrientRows(foodId),
      result: Nutrients = {};
    for (const row of rows) if (row.amount !== null) result[row.nutrient_key] = row.amount;
    return result;
  }
  async saveCustomFood(input: FoodInput, id?: string) {
    if (!foodUnits.includes(input.base_unit)) throw Error('Unidade inválida.');
    const name = requireName(input.name),
      baseAmount = positiveNumber(input.base_amount),
      baseGrams =
        input.base_unit === 'g'
          ? baseAmount
          : positiveNumber(input.base_grams_equivalent ?? NaN, 'Equivalente em gramas');
    const nutrients = JSON.stringify(checkedNutrients(input.nutrients));
    const key = id ?? uuid(),
      now = stamp();
    const result = await this.db.execute(
      id
        ? `UPDATE foods SET name=$1,category=$2,base_amount=$3,base_unit=$4,notes=$5,
           base_grams_equivalent=$9,
           custom_nutrients_json=$6,updated_at=$7 WHERE id=$8 AND is_custom=1`
        : `INSERT INTO foods(id,source_id,name,category,base_amount,base_unit,notes,base_grams_equivalent,
           custom_nutrients_json,is_custom,created_at,updated_at)
           VALUES($8,'custom',$1,$2,$3,$4,$5,$9,$6,1,$7,$7)`,
      [
        name,
        input.category?.trim() ?? '',
        baseAmount,
        input.base_unit,
        input.notes?.trim() ?? '',
        nutrients,
        now,
        key,
        baseGrams,
      ],
    );
    if (!result.rowsAffected) throw Error('Alimento personalizado não encontrado.');
    return key;
  }
  archiveCustomFood(id: string) {
    return this.db.execute(
      'UPDATE foods SET archived_at=$2,updated_at=$2 WHERE id=$1 AND is_custom=1',
      [id, stamp()],
    );
  }

  meals() {
    return this.db.select<Meal[]>('SELECT * FROM meals WHERE archived_at IS NULL ORDER BY name,id');
  }
  async saveMeal(name: string, notes = '', id?: string) {
    const key = id ?? uuid(),
      now = stamp();
    const result = await this.db.execute(
      id
        ? 'UPDATE meals SET name=$1,notes=$2,updated_at=$3 WHERE id=$4'
        : 'INSERT INTO meals(name,notes,created_at,updated_at,id) VALUES($1,$2,$3,$3,$4)',
      [requireName(name), notes.trim(), now, key],
    );
    if (!result.rowsAffected) throw Error('Refeição não encontrada.');
    return key;
  }
  archiveMeal(id: string) {
    return this.db.execute('UPDATE meals SET archived_at=$2,updated_at=$2 WHERE id=$1', [
      id,
      stamp(),
    ]);
  }
  mealItems(mealId: string) {
    return this.db.select<MealItem[]>(
      `SELECT mi.*,f.name food_name,f.base_grams_equivalent FROM meal_items mi
       JOIN foods f ON f.id=mi.food_id WHERE mi.meal_id=$1 ORDER BY mi.sort_order,mi.created_at,mi.id`,
      [mealId],
    );
  }
  async saveMealItem(mealId: string, input: QuantityInput, id?: string) {
    const [quantity, grams] = checkedQuantity(input),
      key = id ?? uuid(),
      now = stamp();
    const result = await this.db.execute(
      id
        ? `UPDATE meal_items SET food_id=$1,quantity=$2,unit=$3,grams_equivalent=$4,
            notes=$5,updated_at=$6 WHERE id=$7 AND meal_id=$8`
        : `INSERT INTO meal_items(food_id,quantity,unit,grams_equivalent,notes,
           created_at,updated_at,id,meal_id,sort_order)
           VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,
           (SELECT COALESCE(MAX(sort_order),0)+1 FROM meal_items WHERE meal_id=$8))`,
      [input.food_id, quantity, input.unit, grams, input.notes?.trim() ?? '', now, key, mealId],
    );
    if (!result.rowsAffected) throw Error('Item da refeição não encontrado.');
    return key;
  }
  removeMealItem(id: string) {
    return this.db.execute('DELETE FROM meal_items WHERE id=$1', [id]);
  }
  async mealTotals(mealId: string): Promise<Nutrients> {
    const rows = await this.db.select<{ nutrient_key: NutrientKey; total: number }[]>(
      `SELECT fn.nutrient_key,SUM(fn.amount*mi.grams_equivalent/f.base_grams_equivalent) total
       FROM meal_items mi JOIN foods f ON f.id=mi.food_id
       JOIN food_nutrients fn ON fn.food_id=f.id AND fn.amount IS NOT NULL
       WHERE mi.meal_id=$1 GROUP BY fn.nutrient_key`,
      [mealId],
    );
    return Object.fromEntries(rows.map((r) => [r.nutrient_key, r.total])) as Nutrients;
  }

  plans(includeArchived = false) {
    return this.db.select<DietPlan[]>(
      'SELECT * FROM diet_plans WHERE $1=1 OR archived_at IS NULL ORDER BY active DESC,created_at DESC,id',
      [Number(includeArchived)],
    );
  }
  async savePlan(name: string, description = '', id?: string) {
    const key = id ?? uuid(),
      now = stamp();
    const result = await this.db.execute(
      id
        ? 'UPDATE diet_plans SET name=$1,description=$2,updated_at=$3 WHERE id=$4'
        : 'INSERT INTO diet_plans(name,description,created_at,updated_at,id) VALUES($1,$2,$3,$3,$4)',
      [requireName(name), description.trim(), now, key],
    );
    if (!result.rowsAffected) throw Error('Dieta não encontrada.');
    return key;
  }
  activatePlan(id: string) {
    return this.db.execute(
      'UPDATE diet_plans SET active=1,updated_at=$2 WHERE id=$1 AND archived_at IS NULL',
      [id, stamp()],
    );
  }
  archivePlan(id: string) {
    return this.db.execute(
      'UPDATE diet_plans SET active=0,archived_at=$2,updated_at=$2 WHERE id=$1',
      [id, stamp()],
    );
  }
  planMeals(planId: string, weekday?: number) {
    return this.db.select<DietMeal[]>(
      `SELECT dm.*,m.name meal_name FROM diet_meals dm JOIN meals m ON m.id=dm.meal_id
       WHERE dm.diet_plan_id=$1 AND ($2 IS NULL OR dm.weekday=$2)
       ORDER BY dm.weekday,dm.sort_order,dm.id`,
      [planId, weekday ?? null],
    );
  }
  async addPlanMeal(planId: string, weekday: number, mealId: string) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw Error('Dia inválido.');
    const key = uuid();
    await this.db.execute(
      `INSERT INTO diet_meals(id,diet_plan_id,weekday,meal_id,sort_order)
       VALUES($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order),0)+1 FROM diet_meals
       WHERE diet_plan_id=$2 AND weekday=$3))`,
      [key, planId, weekday, mealId],
    );
    return key;
  }
  removePlanMeal(id: string) {
    return this.db.execute('DELETE FROM diet_meals WHERE id=$1', [id]);
  }
  async planDayTotals(planId: string, weekday: number): Promise<Nutrients> {
    const rows = await this.db.select<{ nutrient_key: NutrientKey; total: number }[]>(
      `SELECT fn.nutrient_key,SUM(fn.amount*mi.grams_equivalent/f.base_grams_equivalent) total
       FROM diet_meals dm JOIN meal_items mi ON mi.meal_id=dm.meal_id
       JOIN foods f ON f.id=mi.food_id JOIN food_nutrients fn ON fn.food_id=f.id
       WHERE dm.diet_plan_id=$1 AND dm.weekday=$2 AND fn.amount IS NOT NULL
       GROUP BY fn.nutrient_key`,
      [planId, weekday],
    );
    return Object.fromEntries(rows.map((r) => [r.nutrient_key, r.total])) as Nutrients;
  }

  diary(day: string) {
    return this.db.select<DiaryEntry[]>(
      'SELECT * FROM food_diary_entries WHERE entry_date=$1 ORDER BY meal_label,created_at,id',
      [day],
    );
  }
  async diaryTotals(day: string): Promise<Nutrients> {
    const rows = await this.db.select<{ nutrient_key: NutrientKey; total: number }[]>(
      `SELECT j.key nutrient_key,SUM(CAST(j.value AS REAL)) total FROM food_diary_entries e,
       json_each(e.nutrients_json) j WHERE e.entry_date=$1 GROUP BY j.key`,
      [day],
    );
    return Object.fromEntries(rows.map((r) => [r.nutrient_key, r.total])) as Nutrients;
  }
  async saveDiaryEntry(day: string, mealLabel: string, input: QuantityInput, id?: string) {
    const [quantity, grams] = checkedQuantity(input);
    const food = await this.food(input.food_id);
    if (!food) throw Error('Alimento não encontrado.');
    const values = portion(await this.nutrients(food.id), grams, food.base_grams_equivalent);
    const key = id ?? uuid(),
      now = stamp();
    const result = await this.db.execute(
      id
        ? `UPDATE food_diary_entries SET entry_date=$1,meal_label=$2,food_id=$3,
            food_name=$4,quantity=$5,unit=$6,grams_equivalent=$7,nutrients_json=$8,
            notes=$9,updated_at=$10 WHERE id=$11`
        : `INSERT INTO food_diary_entries(entry_date,meal_label,food_id,food_name,
           quantity,unit,grams_equivalent,nutrients_json,notes,created_at,updated_at,id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11)`,
      [
        day,
        requireName(mealLabel),
        food.id,
        food.name,
        quantity,
        input.unit,
        grams,
        JSON.stringify(values),
        input.notes?.trim() ?? '',
        now,
        key,
      ],
    );
    if (!result.rowsAffected) throw Error('Registro não encontrado.');
    return key;
  }
  removeDiaryEntry(id: string) {
    return this.db.execute('DELETE FROM food_diary_entries WHERE id=$1', [id]);
  }
  // One SQL statement copies an entire meal and snapshots its nutrient values.
  // The statement is atomic under SQLite even with a pooled plugin connection.
  async copyMealToDiary(mealId: string, day: string, label?: string) {
    const now = stamp();
    return this.db.execute(
      `INSERT INTO food_diary_entries(id,entry_date,meal_label,food_id,food_name,
       quantity,unit,grams_equivalent,nutrients_json,source_meal_id,notes,created_at,updated_at)
       SELECT lower(hex(randomblob(16))),$2,COALESCE($3,m.name),f.id,f.name,
       mi.quantity,mi.unit,mi.grams_equivalent,
       COALESCE((SELECT json_group_object(fn.nutrient_key,fn.amount*mi.grams_equivalent/f.base_grams_equivalent)
         FROM food_nutrients fn WHERE fn.food_id=f.id AND fn.amount IS NOT NULL),'{}'),
       m.id,mi.notes,$4,$4 FROM meal_items mi
       JOIN meals m ON m.id=mi.meal_id JOIN foods f ON f.id=mi.food_id WHERE mi.meal_id=$1`,
      [mealId, day, label ?? null, now],
    );
  }
  diaryHistory(from: string, to: string) {
    return this.db.select<{ entry_date: string; calories: number; protein: number }[]>(
      `SELECT entry_date,
       SUM(COALESCE(CAST(json_extract(nutrients_json,'$.energy_kcal') AS REAL),0)) calories,
       SUM(COALESCE(CAST(json_extract(nutrients_json,'$.protein_g') AS REAL),0)) protein
       FROM food_diary_entries WHERE entry_date BETWEEN $1 AND $2
       GROUP BY entry_date ORDER BY entry_date DESC`,
      [from, to],
    );
  }
  goals() {
    return this.db
      .select<Goals[]>('SELECT calories,carbs_g,protein_g,fat_g FROM nutrition_goals WHERE id=1')
      .then((rows) => rows[0] ?? { calories: null, carbs_g: null, protein_g: null, fat_g: null });
  }
  saveGoals(goals: Goals) {
    const values = [goals.calories, goals.carbs_g, goals.protein_g, goals.fat_g].map((n) =>
      n == null ? null : positiveNumber(n, 'Meta'),
    );
    return this.db.execute(
      `INSERT INTO nutrition_goals(id,calories,carbs_g,protein_g,fat_g,updated_at)
       VALUES(1,$1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET
       calories=excluded.calories,carbs_g=excluded.carbs_g,protein_g=excluded.protein_g,
       fat_g=excluded.fat_g,updated_at=excluded.updated_at`,
      [...values, stamp()],
    );
  }
  weights(limit = 100) {
    return new BodyProgressRepository(this.db).weights(limit) as Promise<WeightEntry[]>;
  }
  async saveWeight(day: string, weight: string | number, notes = '', id?: string) {
    return new BodyProgressRepository(this.db).saveWeight(day, weight, notes, id);
  }
  removeWeight(id: string) {
    return new BodyProgressRepository(this.db).removeWeight(id);
  }
  // Seven planned days are accumulated in grams; no conversion from cups or
  // pieces is guessed because meal_items stores the user's gram equivalent.
  shoppingForPlan(planId: string) {
    return this.db.select<{ food_id: string; name: string; grams: number }[]>(
      `SELECT f.id food_id,f.name,SUM(mi.grams_equivalent) grams
       FROM diet_meals dm JOIN meal_items mi ON mi.meal_id=dm.meal_id
       JOIN foods f ON f.id=mi.food_id WHERE dm.diet_plan_id=$1
       GROUP BY f.id,f.name ORDER BY f.name`,
      [planId],
    );
  }
  async daySummary(day: string) {
    const [totals, manual] = await Promise.all([this.diaryTotals(day), this.goals()]);
    const energy = new EnergyRepository(this.db);
    const profile = await energy.profile();
    const calculated = profile?.dynamic_goals ? (await energy.day(day)).goals : null;
    if (profile?.automatic && calculated)
      return [
        totals,
        {
          calories: calculated.calories,
          carbs_g:
            profile.macro_strategy === 'manual' ? (manual?.carbs_g ?? null) : calculated.carbs_g,
          protein_g:
            profile.macro_strategy === 'manual'
              ? (manual?.protein_g ?? null)
              : calculated.protein_g,
          fat_g: profile.macro_strategy === 'manual' ? (manual?.fat_g ?? null) : calculated.fat_g,
        },
      ] as const;
    return [totals, calculated ?? manual] as const;
  }
}
