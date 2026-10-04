import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { Dialog } from '../../../components/Dialog';
import { getDatabase } from '../../../lib/database/connection';
import { weekdays } from '../../../lib/dates';
import { PlansRepository } from '../repositories/plans';
import { ExercisesRepository } from '../repositories/catalog';
import type { DayExercise, Exercise, WorkoutDay } from '../types';
import { useWorkoutAction } from './useWorkoutAction';
import { DayExerciseForm } from './DayExerciseForm';
import { loadLabels } from './catalogOptions';
import { WorkoutEnergyForm } from '../../energy/WorkoutEnergyForm';
import { ExerciseForm } from './ExerciseForm';

export function PlanDay({
  day,
  index,
  total,
  onEdit,
  onRemove,
  onMove,
  onChange,
  disabled,
}: {
  day: WorkoutDay;
  index: number;
  total: number;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onChange?: () => void;
  disabled: boolean;
}) {
  const [items, setItems] = useState<DayExercise[]>([]),
    [custom, setCustom] = useState(false),
    [exercises, setExercises] = useState<Exercise[]>([]),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<DayExercise | 'new' | null>(null),
    [remove, setRemove] = useState<DayExercise | null>(null);
  const action = useWorkoutAction(() => {
    setRevision((r) => r + 1);
    onChange?.();
  });
  const { setError } = action;
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => {
        const rows = await new PlansRepository(db).exercises(day.id);
        if (active) setItems(rows);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os exercícios deste dia.');
      });
    return () => {
      active = false;
    };
  }, [day.id, revision, setError]);
  async function edit(value: DayExercise | 'new') {
    action.setError('');
    try {
      setExercises(await new ExercisesRepository(await getDatabase()).list());
      setEditor(value);
    } catch {
      action.setError('Não foi possível abrir a biblioteca.');
    }
  }
  const run = (fn: (repo: PlansRepository) => Promise<unknown>) =>
    action.run(async () => fn(new PlansRepository(await getDatabase())));
  return (
    <section className="workout-plan-day">
      <header className="workout-section-heading">
        <div>
          <h3>{day.name}</h3>
          <p>
            {day.weekdays?.length
              ? weekdays
                  .filter((d) => day.weekdays?.includes(d.value))
                  .map((d) => d.label)
                  .join(' · ')
              : 'Sem dia fixo'}
          </p>
          {day.notes && <p className="workout-notes">{day.notes}</p>}
        </div>
        <div className="workout-row-actions">
          <button
            className="icon-button"
            aria-label={`Mover ${day.name} para cima`}
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={`Mover ${day.name} para baixo`}
            disabled={disabled || index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={`Editar dia ${day.name}`}
            disabled={disabled}
            onClick={onEdit}
          >
            <Pencil size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={`Remover dia ${day.name}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>
      <WorkoutEnergyForm kind="day" id={day.id} />
      {action.error && !editor && !remove && (
        <p role="alert" className="workout-error">
          {action.error}
        </p>
      )}
      {items.map((item, at) => (
        <article className="workout-row" key={item.id}>
          <div className="workout-row-copy">
            <strong>{item.exercise_name}</strong>
            <p>
              {item.target_sets} × {item.min_reps}
              {item.min_reps !== item.max_reps ? `–${item.max_reps}` : ''} reps ·{' '}
              {loadLabels[item.load_type]}
              {item.rest_seconds !== null ? ` · ${item.rest_seconds}s de descanso` : ''}
            </p>
            {item.notes && <p className="workout-notes">{item.notes}</p>}
          </div>
          <div className="workout-row-actions">
            <button
              className="icon-button"
              aria-label={`Subir exercício ${item.exercise_name}`}
              disabled={action.busy || at === 0}
              onClick={() => void run((repo) => repo.moveExercise(item.id, -1))}
            >
              <ArrowUp size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={`Descer exercício ${item.exercise_name}`}
              disabled={action.busy || at === items.length - 1}
              onClick={() => void run((repo) => repo.moveExercise(item.id, 1))}
            >
              <ArrowDown size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={`Editar exercício ${item.exercise_name}`}
              disabled={action.busy}
              onClick={() => void edit(item)}
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={`Duplicar exercício ${item.exercise_name}`}
              disabled={action.busy}
              onClick={() => void run((repo) => repo.duplicateExercise(item.id))}
            >
              <Copy size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={`Remover exercício ${item.exercise_name}`}
              disabled={action.busy}
              onClick={() => setRemove(item)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </article>
      ))}
      {!items.length && <p className="view-note">Nenhum exercício neste dia.</p>}
      <button
        className="secondary-button"
        disabled={action.busy || disabled}
        onClick={() => setCustom(true)}
      >
        Novo exercício personalizado
      </button>
      {custom && (
        <ExerciseForm
          busy={action.busy}
          error={action.error}
          onClose={() => setCustom(false)}
          onSave={(input) =>
            action.run(async () => {
              await new ExercisesRepository(await getDatabase()).save(input);
            })
          }
        />
      )}
      <button
        className="text-button workout-add"
        disabled={action.busy || disabled}
        onClick={() => void edit('new')}
      >
        <Plus size={15} />
        Adicionar exercício
      </button>
      {editor && (
        <DayExerciseForm
          item={editor === 'new' ? undefined : editor}
          exercises={exercises}
          busy={action.busy}
          error={action.error}
          onClose={() => setEditor(null)}
          onSave={(input) =>
            run((repo) =>
              repo.saveExercise(day.id, input, editor === 'new' ? undefined : editor.id),
            )
          }
        />
      )}
      {remove && (
        <Dialog
          title="Remover exercício do plano?"
          busy={action.busy}
          error={action.error || undefined}
          onClose={() => setRemove(null)}
        >
          <div className="dialog-content">
            <p>
              “{remove.exercise_name}” será removido deste dia. Sessões anteriores serão
              preservadas.
            </p>
          </div>
          <footer className="drawer-footer">
            <button
              className="secondary-button"
              disabled={action.busy}
              onClick={() => setRemove(null)}
            >
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={action.busy}
              onClick={() =>
                void run((repo) => repo.removeExercise(remove.id)).then((ok) => {
                  if (ok) setRemove(null);
                })
              }
            >
              Remover exercício
            </button>
          </footer>
        </Dialog>
      )}
    </section>
  );
}
