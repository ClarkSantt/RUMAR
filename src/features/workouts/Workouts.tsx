import { useEffect, useState } from 'react';
import { Dumbbell, Play } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { getDatabase } from '../../lib/database/connection';
import { addDays, formatDate, parseDate } from '../../lib/dates';
import { WorkoutScheduleRepository, type ScheduledWorkout } from './repositories/schedule';
import { PlansRepository } from './repositories/plans';
import { SessionsRepository } from './repositories/sessions';
import { flushWorkouts } from './persistence';
import type { DayExercise, WorkoutDay, WorkoutSession } from './types';
import { SessionEditor } from './components/SessionEditor';
import { PlanEditor } from './components/PlanEditor';
import { ExerciseLibrary } from './components/ExerciseLibrary';
import { Evolution } from './components/Evolution';
import { BodyProgress } from '../body-progress/BodyProgress';
import './workouts.css';
import './execution.css';
import type { SearchResult } from '../search/repository';
type Tab = 'today' | 'plan' | 'history' | 'exercises' | 'body';
const tabs: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: 'plan', label: 'Plano' },
  { id: 'history', label: 'Histórico' },
  { id: 'exercises', label: 'Exercícios' },
  { id: 'body', label: 'Progresso corporal' },
];
export function Workouts({
  day,
  searchTarget,
  openBodyProgress = false,
}: {
  day: string;
  searchTarget?: SearchResult;
  openBodyProgress?: boolean;
}) {
  const initialTab: Tab = openBodyProgress
    ? 'body'
    : searchTarget?.group === 'Exercícios'
      ? 'exercises'
      : searchTarget?.group === 'Planos de treino'
        ? 'plan'
        : searchTarget?.group === 'Sessões'
          ? 'history'
          : 'today';
  const [tab, setTab] = useState<Tab>(initialTab),
    [selected, setSelected] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [exerciseId, setExerciseId] = useState<string | undefined>(
      searchTarget?.group === 'Exercícios' ? searchTarget.id : undefined,
    ),
    [error, setError] = useState('');
  async function navigate(next: Tab) {
    try {
      await flushWorkouts();
      setSelected(null);
      setExerciseId(undefined);
      setTab(next);
      setError('');
    } catch {
      setError('Há alterações não salvas no treino. Tente salvar novamente.');
    }
  }
  if (selected)
    return (
      <SessionEditor
        id={selected}
        onBack={() => {
          setSelected(null);
          setRevision((n) => n + 1);
        }}
      />
    );
  return (
    <>
      <header className="page-header module-header">
        <div className="module-heading">
          <span className="module-heading-icon">
            <Dumbbell size={22} />
          </span>
          <div>
            <h1>Treinos</h1>
            <p>Planeje, registre e acompanhe seu próprio ritmo.</p>
          </div>
        </div>
      </header>
      <nav className="tabs" aria-label="Seções de treinos">
        {tabs.map((item) => (
          <button
            key={item.id}
            aria-current={item.id === tab ? 'page' : undefined}
            onClick={() => void navigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {tab === 'today' ? (
        <WorkoutToday
          key={`${day}-${revision}`}
          day={day}
          onOpen={setSelected}
          onPlan={() => setTab('plan')}
        />
      ) : tab === 'history' ? (
        <WorkoutHistory onOpen={setSelected} />
      ) : tab === 'plan' ? (
        <PlanEditor onChange={() => setRevision((n) => n + 1)} />
      ) : tab === 'exercises' ? (
        exerciseId ? (
          <section>
            <button className="text-button project-back" onClick={() => setExerciseId(undefined)}>
              ← Biblioteca de exercícios
            </button>
            <Evolution exerciseId={exerciseId} />
          </section>
        ) : (
          <ExerciseLibrary
            onChange={() => setRevision((n) => n + 1)}
            onHistory={(id) => {
              setExerciseId(id);
            }}
          />
        )
      ) : (
        <BodyProgress />
      )}
    </>
  );
}
function WorkoutToday({
  day,
  onOpen,
  onPlan,
}: {
  day: string;
  onOpen: (id: string) => void;
  onPlan: () => void;
}) {
  const [rows, setRows] = useState<ScheduledWorkout[]>([]),
    [weekRows, setWeekRows] = useState<ScheduledWorkout[]>([]),
    [days, setDays] = useState<(WorkoutDay & { exercise_count: number })[]>([]),
    [planExercises, setPlanExercises] = useState<DayExercise[]>([]),
    [planName, setPlanName] = useState(''),
    [lastSession, setLastSession] = useState<{ day_name: string; session_date: string } | null>(
      null,
    ),
    [current, setCurrent] = useState<WorkoutSession | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [choice, setChoice] = useState('');
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => {
        const schedule = new WorkoutScheduleRepository(db);
        const firstWeekday = addDays(day, -((parseDate(day).getDay() + 6) % 7));
        const [week, options, session, plans, previous] = await Promise.all([
          schedule.range(firstWeekday, addDays(firstWeekday, 6)),
          schedule.days(),
          new SessionsRepository(db).current(),
          db.select<{ name: string }[]>(
            'SELECT name FROM workout_plans WHERE active=1 AND archived_at IS NULL LIMIT 1',
          ),
          db.select<{ day_name: string; session_date: string }[]>(
            "SELECT day_name,session_date FROM workout_sessions WHERE status='completed' ORDER BY finished_at DESC LIMIT 1",
          ),
        ]);
        const today = week.filter((row) => row.date === day);
        const planDayId = today.find((row) => row.day_id)?.day_id ?? options[0]?.id;
        const exercises = planDayId ? await new PlansRepository(db).exercises(planDayId) : [];
        if (active) {
          setRows(today);
          setWeekRows(week);
          setDays(options);
          setPlanExercises(exercises);
          setCurrent(session);
          setPlanName(plans[0]?.name ?? '');
          setLastSession(previous[0] ?? null);
          setChoice(options[0]?.id ?? '');
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError('Não foi possível carregar os treinos.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [day]);
  async function start(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      onOpen(await new SessionsRepository(await getDatabase()).start(id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar.');
    } finally {
      setBusy(false);
    }
  }
  const weekCompleted = weekRows.filter((row) => row.completed).length;
  const upcoming = weekRows.filter((row) => row.date > day && !row.completed).slice(0, 3);
  return (
    <div className="workout-today-page">
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Carregando treinos…</p>
      ) : (
        <>
          <div className="workout-today-top">
            <div className="workout-today-main">
              {current && (
                <section className="workout-today workout-today-active">
                  <p className="workout-kicker">Treino em andamento</p>
                  <h2>{current.day_name}</h2>
                  <p>
                    Iniciado em {formatDate(current.session_date)} às{' '}
                    {new Date(current.started_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <button className="primary-button" onClick={() => onOpen(current.id)}>
                    <Play size={16} fill="currentColor" /> Continuar treino
                  </button>
                  <p className="field-help">Você pode descartar a sessão ao abri-la.</p>
                </section>
              )}
              {rows
                .filter((r) => !r.in_progress)
                .map((row) => (
                  <section className="workout-today workout-today-scheduled" key={row.id}>
                    <p className="workout-kicker">Treino de hoje</p>
                    <h2>{row.name}</h2>
                    <p>{row.completed ? 'Concluído' : `${row.exercise_count} exercícios`}</p>
                    <button
                      className={row.completed ? 'secondary-button' : 'primary-button'}
                      disabled={busy || (!row.completed && !!current)}
                      onClick={() =>
                        row.session_id ? onOpen(row.session_id) : void start(row.day_id!)
                      }
                    >
                      {!row.completed && <Play size={16} fill="currentColor" />}
                      {row.completed ? 'Ver sessão' : 'Iniciar treino'}
                    </button>
                  </section>
                ))}
              {!rows.length && !current && (planName || lastSession) && (
                <section className="workout-today workout-overview">
                  <p className="workout-kicker">Seu plano</p>
                  <h2>{planName || 'Nenhum treino planejado para hoje'}</h2>
                  {planName && (
                    <p>Nenhum treino fixo para hoje. Você pode escolher um dia do plano abaixo.</p>
                  )}
                  {lastSession && (
                    <p>
                      Último treino: {lastSession.day_name} · {formatDate(lastSession.session_date)}
                    </p>
                  )}
                </section>
              )}
            </div>
            {weekRows.length > 0 && (
              <section className="workout-week-context" aria-label="Contexto desta semana">
                <span className="workout-kicker">Esta semana</span>
                <strong>{weekCompleted} concluídos</strong>
                <span>{weekRows.length} treinos no calendário</span>
                <progress
                  max={weekRows.length}
                  value={weekCompleted}
                  aria-label="Treinos concluídos nesta semana"
                />
              </section>
            )}
          </div>
          {(planExercises.length > 0 || lastSession) && (
            <div className="workout-context-grid">
              {planExercises.length > 0 && (
                <section className="workout-context-section">
                  <div className="section-heading">
                    <h2>Seu plano</h2>
                    <button className="text-button" onClick={onPlan}>
                      Ver plano
                    </button>
                  </div>
                  <ul className="workout-exercise-preview">
                    {planExercises.slice(0, 3).map((exercise) => (
                      <li key={exercise.id}>
                        <span>{exercise.exercise_name}</span>
                        <small>{exercise.target_sets} séries</small>
                      </li>
                    ))}
                  </ul>
                  {planExercises.length > 3 && (
                    <p className="field-help">
                      Mais {planExercises.length - 3} exercícios no plano.
                    </p>
                  )}
                </section>
              )}
              {lastSession && (
                <section className="workout-context-section">
                  <div className="section-heading">
                    <h2>Último treino</h2>
                  </div>
                  <strong>{lastSession.day_name}</strong>
                  <p>{formatDate(lastSession.session_date)}</p>
                </section>
              )}
            </div>
          )}
          {upcoming.length > 0 && (
            <section className="workout-next-section">
              <h2>Próximos nesta semana</h2>
              <div className="workout-next-list">
                {upcoming.map((row) => (
                  <div key={`${row.id}-${row.date}`}>
                    <strong>{row.name}</strong>
                    <span>
                      {formatDate(row.date)} · {row.exercise_count} exercícios
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {!days.length ? (
            <EmptyState
              icon={Dumbbell}
              title="Nenhum plano de treino ainda."
              description="Crie seu primeiro plano para começar, ou ative um plano existente."
              action={{ label: 'Abrir plano', onClick: onPlan }}
            />
          ) : (
            <section className="secondary-section workout-choose-section">
              <h2>Escolher outro treino</h2>
              <div className="workout-choose">
                <label>
                  Dia do plano ativo
                  <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                    {days.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.exercise_count} exercícios
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary-button"
                  disabled={!choice || busy || !!current}
                  onClick={() => void start(choice)}
                >
                  Iniciar escolhido
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
function WorkoutHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<WorkoutSession[]>([]),
    [error, setError] = useState(''),
    [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => new SessionsRepository(db).list(30, page * 30))
      .then((list) => {
        if (active) {
          setRows(list);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar o histórico.');
      });
    return () => {
      active = false;
    };
  }, [page]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {!rows.length ? (
        <p className="view-note">Nenhum treino registrado.</p>
      ) : (
        rows.map((session) => (
          <button
            key={session.id}
            className="workout-history-row"
            onClick={() => onOpen(session.id)}
          >
            <span>
              <strong>{session.day_name}</strong>
              <small>{session.plan_name}</small>
            </span>
            <span>
              {formatDate(session.session_date)}
              <small>
                {session.status === 'completed'
                  ? 'Concluído'
                  : session.status === 'discarded'
                    ? 'Descartado'
                    : 'Em andamento'}
                {session.finished_at
                  ? ` · ${Math.max(0, Math.round((Date.parse(session.finished_at) - Date.parse(session.started_at)) / 60000))} min`
                  : ''}
              </small>
            </span>
          </button>
        ))
      )}
      <div className="workout-actions">
        <button className="text-button" disabled={!page} onClick={() => setPage((p) => p - 1)}>
          Anteriores
        </button>
        <span className="field-help">Página {page + 1}</span>
        <button
          className="text-button"
          disabled={rows.length < 30}
          onClick={() => setPage((p) => p + 1)}
        >
          Mais antigas
        </button>
      </div>
    </>
  );
}
