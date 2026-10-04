import { useState } from 'react';
import { Dialog } from '../../../components/Dialog';
import type { DayExercise, DayExerciseInput, Exercise } from '../types';
import { loadLabels } from './catalogOptions';

export function DayExerciseForm({
  item,
  exercises,
  busy,
  error,
  onSave,
  onClose,
}: {
  item?: DayExercise;
  exercises: Exercise[];
  busy: boolean;
  error: string;
  onSave: (input: DayExerciseInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DayExerciseInput>({
    exercise_id: item?.exercise_id ?? '',
    target_sets: item?.target_sets ?? 3,
    min_reps: item?.min_reps ?? 6,
    max_reps: item?.max_reps ?? 10,
    rest_seconds: item?.rest_seconds ?? null,
    notes: item?.notes ?? '',
  });
  const [search, setSearch] = useState('');
  const options = exercises.filter(
    (e) =>
      e.id === draft.exercise_id ||
      e.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')),
  );
  return (
    <Dialog
      title={item ? 'Editar exercício do dia' : 'Adicionar exercício ao dia'}
      onClose={onClose}
      busy={busy}
      error={error || undefined}
    >
      <form
        className="workout-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(draft).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        <div className="dialog-content">
          <fieldset disabled={busy}>
            <label htmlFor="plan-exercise-search">Buscar na biblioteca</label>
            <input
              id="plan-exercise-search"
              autoFocus
              type="search"
              placeholder="Nome do exercício…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label htmlFor="plan-exercise">Exercício</label>
            <select
              id="plan-exercise"
              required
              value={draft.exercise_id}
              onChange={(e) => setDraft({ ...draft, exercise_id: e.target.value })}
            >
              <option value="">Selecione um exercício</option>
              {item && !exercises.some((e) => e.id === item.exercise_id) && (
                <option value={item.exercise_id}>{item.exercise_name} (arquivado)</option>
              )}
              {options.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {loadLabels[e.load_type]}
                </option>
              ))}
            </select>
            <div className="workout-target-grid">
              <div>
                <label htmlFor="target-sets">Séries</label>
                <input
                  id="target-sets"
                  required
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={draft.target_sets}
                  onChange={(e) => setDraft({ ...draft, target_sets: Number(e.target.value) })}
                />
              </div>
              <div>
                <label htmlFor="min-reps">Reps mínimas</label>
                <input
                  id="min-reps"
                  required
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={draft.min_reps}
                  onChange={(e) => setDraft({ ...draft, min_reps: Number(e.target.value) })}
                />
              </div>
              <div>
                <label htmlFor="max-reps">Reps máximas</label>
                <input
                  id="max-reps"
                  required
                  type="number"
                  min={draft.min_reps}
                  max={1000}
                  step={1}
                  value={draft.max_reps}
                  onChange={(e) => setDraft({ ...draft, max_reps: Number(e.target.value) })}
                />
              </div>
            </div>
            <label htmlFor="rest-seconds">
              Descanso em segundos <span>opcional</span>
            </label>
            <input
              id="rest-seconds"
              type="number"
              min={0}
              max={86400}
              step={1}
              value={draft.rest_seconds ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  rest_seconds: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
            <label htmlFor="day-exercise-notes">Observações</label>
            <textarea
              id="day-exercise-notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </fieldset>
        </div>
        <footer className="drawer-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            Salvar exercício no dia
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
