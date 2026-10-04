import { useEffect, useState } from 'react';
import { getDatabase } from '../../../lib/database/connection';
import { loadLabels } from '../domain';
import { WorkoutHistoryRepository, type HistorySet } from '../repositories/history';
import type { SessionExercise, WorkoutSession, WorkoutSet } from '../types';
import { SetRow } from './SetRow';
export function SessionExerciseCard({
  exercise,
  sets,
  session,
  onAdd,
  onRemove,
  onCopy,
  onSetSaved,
}: {
  exercise: SessionExercise;
  sets: WorkoutSet[];
  session: WorkoutSession;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onCopy: () => void;
  onSetSaved: (set: WorkoutSet) => void;
}) {
  const [previous, setPrevious] = useState<HistorySet[]>([]),
    [error, setError] = useState('');
  const [records, setRecords] = useState<{
    maxLoad: number | null;
    repsByLoad: Map<number, number>;
  } | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => {
        const repo = new WorkoutHistoryRepository(db);
        const [prior, pr] = await Promise.all([
          repo.previousSession(exercise.exercise_id, session.started_at, session.id),
          repo.lifetimeRecords(exercise.exercise_id, exercise.load_type, session.id),
        ]);
        if (active) {
          setPrevious(prior);
          setRecords(pr);
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível consultar o treino anterior.');
      });
    return () => {
      active = false;
    };
  }, [exercise.exercise_id, exercise.load_type, session.id, session.started_at]);
  function saved(set: WorkoutSet) {
    onSetSaved(set);
    if (!set.completed || set.set_type === 'warmup' || set.reps === null) {
      setNotice('');
      return;
    }
    const old = previous.filter(
      (p) =>
        p.load_type === set.load_type && p.load_value === set.load_value && p.set_type !== 'warmup',
    );
    const priorReps = old.length ? Math.max(...old.map((p) => p.reps ?? 0)) : null;
    const difference = priorReps === null ? null : set.reps - priorReps;
    const record =
      records &&
      set.load_type === exercise.load_type &&
      ((set.load_value !== null && records.maxLoad !== null && set.load_value > records.maxLoad) ||
        (records.repsByLoad.has(set.load_value ?? 0) &&
          set.reps > records.repsByLoad.get(set.load_value ?? 0)!));
    setNotice(
      [
        record ? 'Novo recorde' : '',
        difference !== null
          ? `${difference > 0 ? '+' : ''}${difference} rep em relação ao treino anterior nesta carga`
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
  return (
    <section className="workout-execution-exercise" aria-label={exercise.exercise_name}>
      <div className="section-heading">
        <div>
          <h2>{exercise.exercise_name}</h2>
          <p className="field-help">
            {exercise.target_sets} × {exercise.min_reps}–{exercise.max_reps} ·{' '}
            {loadLabels[exercise.load_type]}
            {exercise.rest_seconds ? ` · Descanso ${exercise.rest_seconds}s` : ''}
          </p>
        </div>
        <button className="text-button" onClick={onAdd}>
          + Série
        </button>
      </div>
      {exercise.notes && <p className="view-note">{exercise.notes}</p>}
      {error && <p role="alert">{error}</p>}
      {!!previous.length && (
        <div className="workout-previous">
          <p>Último treino</p>
          <p>
            {previous
              .map(
                (p) =>
                  `${p.load_type === 'none' ? 'Sem carga' : `${p.load_value?.toLocaleString('pt-BR') ?? '0'} ${loadLabels[p.load_type]}`} × ${p.reps}`,
              )
              .join(' · ')}
          </p>
          <button className="text-button" onClick={onCopy}>
            Usar cargas anteriores
          </button>
        </div>
      )}
      {sets.map((set) => (
        <SetRow key={set.id} set={set} onRemove={() => onRemove(set.id)} onSaved={saved} />
      ))}
      {notice && (
        <p role="status" className="field-help">
          {notice}
        </p>
      )}
    </section>
  );
}
