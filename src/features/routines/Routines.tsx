import { useEffect, useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';
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
import { RoutineSequenceCard } from './RoutineSequenceCard';
const repository = async () => new RoutinesRepository(await getDatabase());
export function HomeRoutines({ day }: { day: string }) {
  return <RoutineCollection day={day} compact />;
}
export function Routines() {
  const [day, setDay] = useState(localDate());
  return <RoutineCollection day={day} onDayChange={setDay} />;
}
function RoutineCollection({
  day,
  compact = false,
  onDayChange,
}: {
  day: string;
  compact?: boolean;
  onDayChange?: (day: string) => void;
}) {
  const [routines, setRoutines] = useState<Routine[]>([]),
    [revision, setRevision] = useState(0),
    [editing, setEditing] = useState<Routine | null | undefined>(),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void repository()
      .then((r) => r.list())
      .then((rows) => {
        if (active) {
          setRoutines(rows);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(String(e));
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const shown = compact ? routines.filter((r) => routineEligible(r, day)) : routines;
  return (
    <section className={`habit-section${compact ? '' : ' routines-page'}`} aria-label="Rotinas">
      {compact ? (
        <div className="habit-heading">
          <h2>Rotinas de hoje</h2>
        </div>
      ) : (
        <>
          <header className="page-header header-with-action module-header">
            <div className="module-heading">
              <span className="module-heading-icon">
                <ListChecks size={22} />
              </span>
              <div>
                <h1>Rotinas</h1>
                <p>Organize sequências que tornam o seu dia mais simples.</p>
              </div>
            </div>
            <button className="primary-button" onClick={() => setEditing(null)}>
              <Plus size={17} aria-hidden="true" /> Nova rotina
            </button>
          </header>
          <label className="routine-date-bar">
            Dia da ocorrência
            <input
              type="date"
              value={day}
              max={localDate()}
              required
              onChange={(event) => {
                if (event.currentTarget.value) onDayChange?.(event.currentTarget.value);
              }}
            />
          </label>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {!loaded && (
        <p className="muted" role="status">
          Carregando rotinas…
        </p>
      )}
      {loaded &&
        !shown.length &&
        (compact ? (
          <p className="muted">Nenhuma rotina prevista para hoje.</p>
        ) : (
          <EmptyState
            illustration="/assets/rumar/empty-states/empty-routines.png"
            icon={ListChecks}
            title="Nenhuma rotina ainda."
            description="Crie uma sequência para organizar atividades que você costuma fazer juntas."
            action={{ label: 'Criar rotina', onClick: () => setEditing(null) }}
          />
        ))}
      <div className={compact ? 'routine-compact-list' : 'routine-page-list'}>
        {shown.map((r) => (
          <RoutineCard
            key={`${r.id}-${revision}-${day}`}
            routine={r}
            day={day}
            compact={compact}
            onEdit={() => setEditing(r)}
          />
        ))}
      </div>
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
  compact,
  onEdit,
}: {
  routine: Routine;
  day: string;
  compact: boolean;
  onEdit: () => void;
}) {
  const [items, setItems] = useState<RoutineItem[]>([]),
    [occurrence, setOccurrence] = useState<RoutineOccurrence>(),
    [completions, setCompletions] = useState<RoutineCompletion[]>([]),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState(false);
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
          if (o && !o.completed_at && !compact) setExpanded(true);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [routine.id, day, revision, compact]);
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
  if (!compact)
    return (
      <>
        {error && <p role="alert">{error}</p>}
        <RoutineSequenceCard
          routine={routine}
          items={items}
          occurrence={occurrence}
          completions={completions}
          eligible={routineEligible(routine, day)}
          expanded={expanded}
          busy={busy}
          onExpand={() => setExpanded((open) => !open)}
          onEdit={onEdit}
          onStart={() => void action((repo) => repo.start(routine.id, day))}
          onComplete={() => {
            if (occurrence) void action((repo) => repo.complete(occurrence.id));
          }}
          onReopen={() => {
            if (occurrence) void action((repo) => repo.reopen(occurrence.id));
          }}
          onToggleStep={(itemId, checked) => {
            if (occurrence) void action((repo) => repo.toggle(occurrence.id, itemId, checked));
          }}
          templateAction={
            <SaveTemplateButton kind="routine" sourceId={routine.id} initialName={routine.name} />
          }
        />
      </>
    );
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
