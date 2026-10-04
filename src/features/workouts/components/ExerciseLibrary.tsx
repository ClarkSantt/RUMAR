import { useEffect, useState } from 'react';
import { Archive, History, Pencil, Plus } from 'lucide-react';
import { EmptyState } from '../../../components/EmptyState';
import { Dialog } from '../../../components/Dialog';
import { getDatabase } from '../../../lib/database/connection';
import { ExercisesRepository } from '../repositories/catalog';
import type { Exercise, ExerciseInput } from '../types';
import { equipmentOptions, loadLabels, muscleGroups } from './catalogOptions';
import { ExerciseForm } from './ExerciseForm';
import { useWorkoutAction } from './useWorkoutAction';
import '../workouts.css';

export function ExerciseLibrary({
  onChange,
  onHistory,
}: {
  onChange?: () => void;
  onHistory?: (exerciseId: string) => void;
}) {
  const [items, setItems] = useState<Exercise[]>([]),
    [search, setSearch] = useState(''),
    [muscle, setMuscle] = useState(''),
    [equipment, setEquipment] = useState(''),
    [visible, setVisible] = useState(80),
    [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Exercise | 'new' | null>(null),
    [archive, setArchive] = useState<Exercise | null>(null),
    [loading, setLoading] = useState(true);
  const action = useWorkoutAction(() => {
    setRevision((r) => r + 1);
    onChange?.();
  });
  const { setError } = action;
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => new ExercisesRepository(db).list(search, muscle, equipment, false, visible))
      .then((rows) => {
        if (active) {
          setItems(rows);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError('Não foi possível carregar a biblioteca.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [search, muscle, equipment, visible, revision, setError]);
  async function save(input: ExerciseInput) {
    return action.run(async () =>
      new ExercisesRepository(await getDatabase()).save(
        input,
        editor && editor !== 'new' ? editor.id : undefined,
      ),
    );
  }
  return (
    <section>
      <header className="workout-section-heading">
        <div>
          <h2>Biblioteca de exercícios</h2>
          <p>Use a biblioteca local ou cadastre seus próprios exercícios.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            action.setError('');
            setEditor('new');
          }}
        >
          <Plus size={16} />
          Novo exercício
        </button>
      </header>
      <div className="workout-filters">
        <div>
          <label htmlFor="exercise-search">Buscar exercício</label>
          <input
            id="exercise-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisible(80);
            }}
            placeholder="Nome do exercício…"
          />
        </div>
        <div>
          <label htmlFor="exercise-muscle-filter">Grupo muscular</label>
          <select
            id="exercise-muscle-filter"
            value={muscle}
            onChange={(e) => {
              setMuscle(e.target.value);
              setVisible(80);
            }}
          >
            <option value="">Todos</option>
            {muscleGroups.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="exercise-equipment-filter">Equipamento</label>
          <select
            id="exercise-equipment-filter"
            value={equipment}
            onChange={(e) => {
              setEquipment(e.target.value);
              setVisible(80);
            }}
          >
            <option value="">Todos</option>
            {equipmentOptions.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      {action.error && !editor && !archive && (
        <p role="alert" className="workout-error">
          {action.error}
        </p>
      )}
      {loading ? (
        <p role="status">Carregando biblioteca…</p>
      ) : items.length ? (
        <div className="workout-list">
          {items.map((exercise) => (
            <article className="workout-row" key={exercise.id}>
              <div className="workout-row-copy">
                <h3>{exercise.name}</h3>
                <p>
                  {exercise.muscle_group} · {exercise.equipment} · {loadLabels[exercise.load_type]}
                  {exercise.is_custom ? ' · Personalizado' : ''}
                </p>
                {exercise.notes && <p className="workout-notes">{exercise.notes}</p>}
              </div>
              <div className="workout-row-actions">
                {onHistory && (
                  <button
                    className="icon-button"
                    aria-label={`Histórico de ${exercise.name}`}
                    title="Histórico e evolução"
                    onClick={() => onHistory(exercise.id)}
                  >
                    <History size={16} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Editar ${exercise.name}`}
                  onClick={() => {
                    action.setError('');
                    setEditor(exercise);
                  }}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Arquivar ${exercise.name}`}
                  onClick={() => {
                    action.setError('');
                    setArchive(exercise);
                  }}
                >
                  <Archive size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nenhum exercício encontrado."
          description="Experimente outra busca ou cadastre um exercício."
        />
      )}
      {!loading && items.length >= visible && (
        <button className="secondary-button" onClick={() => setVisible((count) => count + 80)}>
          Mostrar mais exercícios
        </button>
      )}
      {editor && (
        <ExerciseForm
          exercise={editor === 'new' ? undefined : editor}
          busy={action.busy}
          error={action.error}
          onSave={save}
          onClose={() => setEditor(null)}
        />
      )}
      {archive && (
        <Dialog
          title="Arquivar exercício?"
          busy={action.busy}
          error={action.error || undefined}
          onClose={() => setArchive(null)}
        >
          <div className="dialog-content">
            <p>
              “{archive.name}” sairá da biblioteca disponível. Os treinos e registros anteriores
              serão preservados.
            </p>
          </div>
          <footer className="drawer-footer">
            <button
              className="secondary-button"
              disabled={action.busy}
              onClick={() => setArchive(null)}
            >
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={action.busy}
              onClick={() =>
                void action
                  .run(async () => new ExercisesRepository(await getDatabase()).archive(archive.id))
                  .then((ok) => {
                    if (ok) setArchive(null);
                  })
              }
            >
              Arquivar exercício
            </button>
          </footer>
        </Dialog>
      )}
    </section>
  );
}
