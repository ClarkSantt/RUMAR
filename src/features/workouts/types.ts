export type LoadType = 'total' | 'per_side' | 'per_dumbbell' | 'bodyweight' | 'none';
export type SetType = 'normal' | 'warmup' | 'drop';
export interface ExerciseInput {
  name: string;
  muscle_group: string;
  equipment: string;
  load_type: LoadType;
  notes: string;
  aliases?: string;
  secondary_muscles?: string;
  movement_pattern?: string;
}
export interface Exercise extends ExerciseInput {
  id: string;
  is_custom: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  aliases_json: string;
  secondary_muscles_json: string;
  movement_pattern: string;
}
export interface PlanInput {
  activate?: boolean;
  name: string;
  description: string;
  habit_id: string | null;
}
export interface WorkoutPlan extends PlanInput {
  id: string;
  active: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}
export interface DayInput {
  name: string;
  weekday: number | null;
  weekdays?: number[];
  notes: string;
}
export interface WorkoutDay extends DayInput {
  exercise_count?: number;
  id: string;
  workout_plan_id: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface DayExerciseInput {
  exercise_id: string;
  target_sets: number;
  min_reps: number;
  max_reps: number;
  rest_seconds: number | null;
  notes: string;
}
export interface DayExercise extends DayExerciseInput {
  id: string;
  workout_day_id: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  exercise_name: string;
  load_type: LoadType;
}
export interface WorkoutSession {
  id: string;
  workout_plan_id: string | null;
  workout_day_id: string | null;
  plan_name: string;
  day_name: string;
  session_date: string;
  started_at: string;
  finished_at: string | null;
  status: 'in_progress' | 'completed' | 'discarded';
  notes: string;
  habit_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface SessionExercise {
  id: string;
  workout_session_id: string;
  exercise_id: string;
  exercise_name: string;
  load_type: LoadType;
  target_sets: number;
  min_reps: number;
  max_reps: number;
  rest_seconds: number | null;
  notes: string;
  sort_order: number;
}
export interface SetInput {
  set_type: SetType;
  load_value: number | null;
  load_type: LoadType;
  reps: number | null;
  completed: number;
  notes: string;
}
export interface WorkoutSet extends SetInput {
  id: string;
  workout_session_id: string;
  session_exercise_id: string;
  exercise_id: string;
  set_number: number;
  created_at: string;
  updated_at: string;
}
export interface SessionDetail {
  session: WorkoutSession;
  exercises: SessionExercise[];
  sets: WorkoutSet[];
}
