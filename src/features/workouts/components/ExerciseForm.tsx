import { useState } from 'react';
import { Dialog } from '../../../components/Dialog';
import type { Exercise, ExerciseInput, LoadType } from '../types';
import { equipmentOptions, loadLabels, muscleGroups } from './catalogOptions';

export function ExerciseForm({
  exercise,
  busy,
  error,
  onSave,
  onClose,
}: {
  exercise?: Exercise;
  busy: boolean;
  error: string;
  onSave: (input: ExerciseInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ExerciseInput>({
    name: exercise?.name ?? '',
    muscle_group: exercise?.muscle_group ?? 'Outro',
    equipment: exercise?.equipment ?? 'Outro',
    load_type: exercise?.load_type ?? 'total',
    notes: exercise?.notes ?? '',
    aliases: exercise ? JSON.parse(exercise.aliases_json).join(', ') : '',
    secondary_muscles: exercise ? JSON.parse(exercise.secondary_muscles_json).join(', ') : '',
    movement_pattern: exercise?.movement_pattern ?? '',
  });
  return (
    <Dialog
      title={exercise ? 'Editar exercício' : 'Novo exercício'}
      busy={busy}
      error={error || undefined}
      onClose={onClose}
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
            <label htmlFor="exercise-name">Nome</label>
            <input
              autoFocus
              required
              maxLength={500}
              id="exercise-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <div className="form-grid">
              <div>
                <label htmlFor="exercise-muscle">Grupo muscular</label>
                <input
                  id="exercise-muscle"
                  list="muscle-options"
                  required
                  value={draft.muscle_group}
                  onChange={(e) => setDraft({ ...draft, muscle_group: e.target.value })}
                />
                <datalist id="muscle-options">
                  {muscleGroups.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="exercise-equipment">Equipamento</label>
                <input
                  id="exercise-equipment"
                  list="equipment-options"
                  required
                  value={draft.equipment}
                  onChange={(e) => setDraft({ ...draft, equipment: e.target.value })}
                />
                <datalist id="equipment-options">
                  {equipmentOptions.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>
            </div>
            <label htmlFor="exercise-load">Tipo de carga</label>
            <select
              id="exercise-load"
              value={draft.load_type}
              onChange={(e) => setDraft({ ...draft, load_type: e.target.value as LoadType })}
            >
              {Object.entries(loadLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="field-help">
              A medida escolhida identifica o número registrado. Cargas por lado ou halter não serão
              convertidas em carga total.
            </p>
            <label htmlFor="exercise-aliases">
              Nomes alternativos <span>opcional</span>
            </label>
            <input
              id="exercise-aliases"
              value={draft.aliases ?? ''}
              onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
              placeholder="Separe por vírgulas"
            />
            <div className="form-grid">
              <div>
                <label htmlFor="exercise-secondary">
                  Músculos secundários <span>opcional</span>
                </label>
                <input
                  id="exercise-secondary"
                  value={draft.secondary_muscles ?? ''}
                  onChange={(e) => setDraft({ ...draft, secondary_muscles: e.target.value })}
                  placeholder="Separe por vírgulas"
                />
              </div>
              <div>
                <label htmlFor="exercise-pattern">
                  Padrão de movimento <span>opcional</span>
                </label>
                <input
                  id="exercise-pattern"
                  value={draft.movement_pattern ?? ''}
                  onChange={(e) => setDraft({ ...draft, movement_pattern: e.target.value })}
                />
              </div>
            </div>
            <label htmlFor="exercise-notes">
              Observações <span>opcional</span>
            </label>
            <textarea
              id="exercise-notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </fieldset>
        </div>
        <footer className="drawer-footer">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            Salvar exercício
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
