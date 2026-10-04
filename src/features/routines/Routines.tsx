import { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { getDatabase } from '../../lib/database/connection';
import { localDate } from '../../lib/dates';
import {
  routineEligible,
  type Routine,
  type RoutineItem,
  type RoutineOccurrence,
  type RoutineCompletion,
} from './domain';
import { RoutinesRepository } from './repository';
import '../habits/habits.css';
import { RoutineEditor } from './RoutineEditor';
import { SaveTemplateButton } from '../templates/SaveTemplateButton';
const repository = async () => new RoutinesRepository(await getDatabase());
export function HomeRoutines({ day }: { day: string }) {
  return <RoutineCollection day={day} compact />;
}
export function Routines() {
  const [day, setDay] = useState(localDate());
  return (
    <>
      <header className="page-header">
        <p className="eyebrow">ORGANIZAÇÃO</p>
        <h1>Rotinas</h1>
        <p>Uma sequência simples para cada dia.</p>
      </header>
      <label className="routine-history">
        Dia da ocorrência
        <input
          type="date"
          value={day}
          max={localDate()}
          required
          onChange={(e) => {
            if (e.target.value) setDay(e.target.value);
          }}
        />
      </label>
      <RoutineCollection day={day} />
    </>
  );
}
function RoutineCollection({ day, compact = false }: { day: string; compact?: boolean }) {
  const [routines, setRoutines] = useState<Routine[]>([]),
    [revision, setRevision] = useState(0),
    [editing, setEditing] = useState<Routine | null | undefined>(),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void repository()
      .then((r) => r.list())
      .then((rows) => {
        if (active) setRoutines(rows);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const shown = compact ? routines.filter((r) => routineEligible(r, day)) : routines;
  return (
    <section className="habit-section" aria-label="Rotinas">
      <div className="habit-heading">
        <h2>{compact ? 'Rotinas de hoje' : 'Suas rotinas'}</h2>
        {!compact && (
          <button className="primary-button" onClick={() => setEditing(null)}>
            Nova rotina
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {!shown.length &&
        (compact ? (
          <p className="muted">Nenhuma rotina prevista para hoje.</p>
        ) : (
          <EmptyState
            icon={ListChecks}
            title="Nenhuma rotina criada."
            description="Organize uma sequência simples para os dias em que ela ajuda."
            action={{ label: 'Criar rotina', onClick: () => setEditing(null) }}
          />
        ))}
      {shown.map((r) => (
        <RoutineCard
          key={`${r.id}-${revision}-${day}`}
          routine={r}
          day={day}
          onEdit={() => setEditing(r)}
        />
      ))}
      {editing !== undefined && (
        <RoutineEditor
          routine={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setRevision((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
function RoutineCard({
  routine,
  day,
  onEdit,
}: {
  routine: Routine;
  day: string;
  onEdit: () => void;
}) {
  const [items, setItems] = useState<RoutineItem[]>([]),
    [occurrence, setOccurrence] = useState<RoutineOccurrence>(),
    [completions, setCompletions] = useState<RoutineCompletion[]>([]),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void repository()
      .then(async (r) => {
        const [i, occurrences] = await Promise.all([
          r.items(routine.id),
          r.occurrences(day, day, routine.id),
        ]);
        const o = occurrences.find((v) => v.routine_id === routine.id),
          c = o ? await r.completions(o.id) : [];
        if (active) {
          setItems(i);
          setOccurrence(o);
          setCompletions(c);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [routine.id, day, revision]);
  async function action(callback: (r: RoutinesRepository) => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await callback(await repository());
      setRevision((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="habit-row">
      <div className="habit-row-main">
        <button className="habit-title" onClick={onEdit}>
          {routine.name}
        </button>
        {routine.time_of_day && <span className="muted">{routine.time_of_day}</span>}
        {!routine.active && <span className="muted">Pausada</span>}
      </div>
      <p>
        {occurrence?.completed_at
          ? 'Concluída neste dia'
          : occurrence
            ? `${completions.length}/${items.length} itens concluídos`
            : `${items.length} itens`}
      </p>
      {items.length > 0 && (
        <progress
          className="habit-progress"
          aria-label={`Progresso de ${routine.name}`}
          max={items.length}
          value={occurrence?.completed_at ? items.length : completions.length}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {!occurrence && items.length > 0 && (
        <ul className="routine-preview">
          {items.slice(0, 3).map((item) => (
            <li key={item.id}>{item.title}</li>
          ))}
          {items.length > 3 && <li>+ {items.length - 3} itens</li>}
        </ul>
      )}
      {occurrence && (
        <ul className="routine-items">
          {items.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={completions.some((c) => c.item_id === item.id)}
                  disabled={busy || !!occurrence.completed_at}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    void action((r) => r.toggle(occurrence.id, item.id, checked));
                  }}
                />
                {item.title}
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="routine-actions">
        <SaveTemplateButton kind="routine" sourceId={routine.id} initialName={routine.name} />
        {!occurrence ? (
          routineEligible(routine, day) && (
            <button
              className="secondary-button"
              disabled={busy || !items.length}
              onClick={() => void action((r) => r.start(routine.id, day))}
            >
              Iniciar rotina
            </button>
          )
        ) : occurrence.completed_at ? (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void action((r) => r.reopen(occurrence.id))}
          >
            Reabrir ocorrência
          </button>
        ) : (
          <button
            className="secondary-button"
            disabled={busy || !items.length || completions.length !== items.length}
            onClick={() => void action((r) => r.complete(occurrence.id))}
          >
            Concluir rotina
          </button>
        )}
      </div>
    </article>
  );
}
