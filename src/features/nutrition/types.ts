import type { FoodUnit, NutrientKey, Nutrients } from './domain';
export interface Food {
  id: string;
  source_id: string;
  source_item_id: string | null;
  name: string;
  category: string;
  base_amount: number;
  base_unit: FoodUnit;
  base_grams_equivalent: number;
  edible_portion: number;
  is_custom: number;
  notes: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}
export interface NutrientRow {
  food_id: string;
  nutrient_key: NutrientKey;
  amount: number | null;
  unit: string;
  qualifier: 'measured' | 'trace';
}
export interface Meal {
  id: string;
  name: string;
  notes: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  kind: 'meal' | 'recipe' | 'favorite';
  servings: number;
}
export interface MealItem {
  id: string;
  meal_id: string;
  food_id: string;
  food_name: string;
  quantity: number;
  unit: FoodUnit;
  grams_equivalent: number;
  base_grams_equivalent: number;
  notes: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface DietPlan {
  id: string;
  name: string;
  description: string;
  active: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}
export interface DietMeal {
  id: string;
  diet_plan_id: string;
  weekday: number;
  meal_id: string;
  meal_name: string;
  sort_order: number;
}
export interface DiaryEntry {
  id: string;
  entry_date: string;
  meal_label: string;
  food_id: string;
  food_name: string;
  quantity: number;
  unit: FoodUnit;
  grams_equivalent: number;
  nutrients_json: string;
  source_meal_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}
export interface WeightEntry {
  id: string;
  entry_date: string;
  weight_kg: number;
  notes: string;
  created_at: string;
  updated_at: string;
}
export interface Goals {
  calories: number | null;
  carbs_g: number | null;
  protein_g: number | null;
  fat_g: number | null;
}
export interface FoodInput {
  name: string;
  category?: string;
  base_amount: number;
  base_unit: FoodUnit;
  base_grams_equivalent?: number;
  notes?: string;
  nutrients: Nutrients;
}
export interface QuantityInput {
  food_id: string;
  quantity: number;
  unit: FoodUnit;
  grams_equivalent: number;
  notes?: string;
}
