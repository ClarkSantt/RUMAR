import type { LoadType } from './types';
export interface MetricSet {
  exercise_id: string;
  workout_session_id: string;
  load_type: LoadType;
  load_value: number | null;
  reps: number | null;
  completed: number;
  set_type: string;
  session_status: string;
  session_date: string;
  muscle_group?: string;
}
export const loadLabels: Record<LoadType, string> = {
  total: 'kg total',
  per_side: 'kg/lado',
  per_dumbbell: 'kg/halter',
  bodyweight: 'kg adicionais ao peso corporal',
  none: 'Sem carga',
};
export function parseLoad(value: string | number): number {
  const text = String(value).trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) throw new Error('Informe uma carga válida, como 27,5.');
  const result = Number(text.replace(',', '.'));
  if (!Number.isFinite(result) || result < 0)
    throw new Error('A carga deve ser maior ou igual a zero.');
  return result;
}
export function recordedVolume(
  set: Pick<MetricSet, 'load_type' | 'load_value' | 'reps'>,
): number | null {
  if (
    !['total', 'per_side', 'per_dumbbell'].includes(set.load_type) ||
    set.load_value === null ||
    set.reps === null
  )
    return null;
  return set.load_value * set.reps;
}
export function countedSet(set: MetricSet) {
  return (
    set.session_status === 'completed' &&
    set.completed === 1 &&
    set.set_type !== 'warmup' &&
    set.reps !== null
  );
}
export function exerciseMetrics(history: MetricSet[], exerciseId: string, loadType: LoadType) {
  const sets = history.filter(
    (s) => s.exercise_id === exerciseId && s.load_type === loadType && countedSet(s),
  );
  const loaded = sets.filter((s) => s.load_value !== null || loadType === 'bodyweight');
  const maxLoad =
    loadType === 'none' || !loaded.length
      ? null
      : Math.max(...loaded.map((s) => s.load_value ?? 0));
  const repsByLoad = new Map<number, number>();
  for (const set of sets) {
    const load = set.load_value ?? 0;
    repsByLoad.set(load, Math.max(repsByLoad.get(load) ?? 0, set.reps!));
  }
  const grouped = new Map<
    string,
    {
      id: string;
      date: string;
      maxLoad: number | null;
      maxReps: number;
      volume: number | null;
      sets: number;
      reps: number;
    }
  >();
  for (const set of sets) {
    const previous = grouped.get(set.workout_session_id) ?? {
      id: set.workout_session_id,
      date: set.session_date,
      maxLoad: null,
      maxReps: 0,
      volume: null,
      sets: 0,
      reps: 0,
    };
    const volume = recordedVolume(set);
    if (volume !== null) previous.volume = (previous.volume ?? 0) + volume;
    if (loadType !== 'none' && set.load_value !== null)
      previous.maxLoad = Math.max(previous.maxLoad ?? 0, set.load_value);
    previous.maxReps = Math.max(previous.maxReps, set.reps!);
    previous.sets++;
    previous.reps += set.reps!;
    grouped.set(set.workout_session_id, previous);
  }
  const sessions = [...grouped.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const volumes = sessions.flatMap((s) => (s.volume === null ? [] : [s.volume]));
  const e1rms = sets
    .map((set) => estimatedOneRepMax(set.load_value, set.reps, set.load_type))
    .filter((value): value is number => value !== null);
  return {
    maxLoad,
    repsByLoad,
    maxSessionVolume: volumes.length ? Math.max(...volumes) : null,
    bestEstimatedOneRepMax: e1rms.length ? Math.max(...e1rms) : null,
    sessions,
  };
}

export function estimatedOneRepMax(
  load: number | null,
  reps: number | null,
  loadType: LoadType = 'total',
): number | null {
  if (
    load === null ||
    reps === null ||
    load <= 0 ||
    reps <= 0 ||
    reps > 30 ||
    ['none', 'bodyweight'].includes(loadType)
  )
    return null;
  return Math.round(load * (1 + reps / 30) * 100) / 100;
}

export function progressionSuggestion(
  history: MetricSet[],
  exerciseId: string,
  loadType: LoadType,
  targetSets: number,
  maxReps: number,
): 'increase_load' | 'increase_reps' | 'maintain' | null {
  const sessions = exerciseMetrics(history, exerciseId, loadType).sessions;
  if (!sessions.length) return null;
  const recent = sessions.slice(-2);
  if (
    recent.length === 2 &&
    recent.every((session) => session.sets >= targetSets && session.maxReps >= maxReps) &&
    !['none', 'bodyweight'].includes(loadType)
  )
    return 'increase_load';
  const latest = recent.at(-1)!;
  if (latest.sets >= targetSets && latest.maxReps < maxReps) return 'increase_reps';
  return 'maintain';
}

export function weeklyMuscleFrequency(history: MetricSet[]) {
  const groups = new Map<string, Set<string>>();
  for (const set of history.filter(countedSet)) {
    if (!set.muscle_group) continue;
    const sessions = groups.get(set.muscle_group) ?? new Set<string>();
    sessions.add(set.workout_session_id);
    groups.set(set.muscle_group, sessions);
  }
  return [...groups].map(([muscleGroup, sessions]) => ({
    muscleGroup,
    sessions: sessions.size,
  }));
}
export function newRecords(current: MetricSet, history: MetricSet[]): ('load' | 'reps')[] {
  if (!current.completed || current.set_type === 'warmup' || current.reps === null) return [];
  const previous = history.filter(
    (s) =>
      s.workout_session_id !== current.workout_session_id &&
      countedSet(s) &&
      s.exercise_id === current.exercise_id &&
      s.load_type === current.load_type,
  );
  if (!previous.length) return [];
  const metrics = exerciseMetrics(previous, current.exercise_id, current.load_type),
    result: ('load' | 'reps')[] = [];
  if (
    current.load_type !== 'none' &&
    current.load_value !== null &&
    metrics.maxLoad !== null &&
    current.load_value > metrics.maxLoad
  )
    result.push('load');
  const reps = metrics.repsByLoad.get(current.load_value ?? 0);
  if (reps !== undefined && current.reps > reps) result.push('reps');
  return result;
}
