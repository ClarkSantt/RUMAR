import { useEffect, useState } from 'react';
import { Plus, Repeat2 } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { getDatabase } from '../../lib/database/connection';
import { addDays, localDate } from '../../lib/dates';
import { habitEligible, habitProgress, habitReached, type Habit, type HabitEntry } from './domain';
import { HabitsRepository } from './repository';
import './habits.css';
import { HabitEditor } from './HabitEditor';
import { HabitCard } from './HabitCard';
const repository = async () => new HabitsRepository(await getDatabase());
export function HomeHabits({
  day,
  projectId,
  summaryOnly = false,
}: {
  day: string;
  projectId?: string;
  summaryOnly?: boolean;
}) {
  return <HabitCollection day={day} projectId={projectId} compact summaryOnly={summaryOnly} />;
}
export function Habits() {
  return <HabitCollection day={localDate()} />;
}
function HabitCollection({
  day,
  projectId,
  compact = false,
  summaryOnly = false,
}: {
  day: string;
  projectId?: string;
  compact?: boolean;
  summaryOnly?: boolean;
}) {
  const [habits, setHabits] = useState<Habit[]>([]),
    [entries, setEntries] = useState<HabitEntry[]>([]),
    [revision, setRevision] = useState(0),
    [editing, setEditing] = useState<Habit | null | undefined>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let current = true;
    void repository()
      .then(async (r) => {
        const [h, e] = await Promise.all([
          r.list(projectId),
          r.entries(addDays(day, -35), addDays(day, 6)),
        ]);
        if (current) {
          setHabits(h);
          setEntries(e);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (current) {
          setError(String(e));
          setLoaded(true);
        }
      });
    return () => {
      current = false;
    };
  }, [day, projectId, revision]);
  async function record(h: Habit, value: number) {
    setBusy(true);
    setError('');
    try {
      await (await repository()).record(h.id, day, value);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const shown = compact && !projectId ? habits.filter((h) => habitEligible(h, day)) : habits;
  const page = !compact && !projectId;
  const todayHabits = habits.filter((habit) => habitEligible(habit, day));
  const completedToday = todayHabits.filter((habit) =>
    habitReached(
      habit,
      entries.find((entry) => entry.habit_id === habit.id && entry.entry_date === day)?.value ?? 0,
    ),
  ).length;
  const summaries = habits
    .filter((habit) => habit.active)
    .map((habit) => habitProgress(habit, entries, day));
  const weekDone = summaries.reduce(
    (total, summary) => total + Math.min(summary.weekDone, summary.weekTarget),
    0,
  );
  const weekTarget = summaries.reduce((total, summary) => total + summary.weekTarget, 0);
  const monthDone = summaries.reduce((total, summary) => total + summary.done, 0);
  const monthExpected = summaries.reduce((total, summary) => total + summary.expected, 0);
  if (summaryOnly)
    return (
      <section className="home-pulse-item home-habit-pulse">
        <span className="summary-label">Hábitos de hoje</span>
        <strong>
          {completedToday} de {todayHabits.length} feitos
        </strong>
        <progress
          max={Math.max(todayHabits.length, 1)}
          value={completedToday}
          aria-label="Hábitos concluídos hoje"
        />
        <span className="summary-caption">{todayHabits.length - completedToday} por registrar</span>
        {error && <span role="alert">{error}</span>}
      </section>
    );
  return (
    <section className={`habit-section${page ? ' habits-page' : ''}`} aria-label="Hábitos">
      {page ? (
        <header className="page-header header-with-action module-header">
          <div className="module-heading">
            <span className="module-heading-icon">
              <Repeat2 size={22} />
            </span>
            <div>
              <h1>Hábitos</h1>
              <p>Pequenas ações, grandes resultados.</p>
            </div>
          </div>
          <button className="primary-button" onClick={() => setEditing(null)}>
            <Plus size={17} aria-hidden="true" /> Novo hábito
          </button>
        </header>
      ) : (
        <div className="habit-heading">
          <h2>{projectId ? 'Hábitos vinculados' : 'Hábitos de hoje'}</h2>
          {!compact && (
            <button className="primary-button" onClick={() => setEditing(null)}>
              Novo hábito
            </button>
          )}
        </div>
      )}
      {page && habits.length > 0 && (
        <div className="habit-day-summary" aria-label="Resumo dos hábitos">
          <div>
            <strong>
              {completedToday} de {todayHabits.length}
            </strong>
            <span>hábitos previstos hoje</span>
          </div>
          <div>
            <strong>
              {weekDone} de {weekTarget}
            </strong>
            <span>registros desta semana</span>
          </div>
          {monthExpected > 0 && (
            <div>
              <strong>{Math.round((monthDone / monthExpected) * 100)}%</strong>
              <span>consistência em 30 dias</span>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!loaded && (
        <p className="muted" role="status">
          Carregando hábitos…
        </p>
      )}
      {loaded &&
        !shown.length &&
        (compact || projectId ? (
          <p className="muted">
            {projectId ? 'Nenhum hábito vinculado' : 'Nenhum hábito previsto para hoje.'}
          </p>
        ) : (
          <EmptyState
            icon={Repeat2}
            title="Nenhum hábito ainda."
            description="Crie um hábito para acompanhar pequenas ações que você quer manter no dia a dia."
            action={{ label: 'Criar hábito', onClick: () => setEditing(null) }}
          />
        ))}
      {page ? (
        <div className="habit-card-grid">
          {shown.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              entries={entries}
              day={day}
              busy={busy}
              onRecord={(value) => void record(habit, value)}
              onEdit={() => setEditing(habit)}
            />
          ))}
        </div>
      ) : (
        <div className="habit-list">
          {shown.map((h) => {
            const entry = entries.find((e) => e.habit_id === h.id && e.entry_date === day),
              progress = habitProgress(h, entries, day);
            return (
              <article className="habit-row" key={h.id}>
                <div className="habit-row-main">
                  {h.kind === 'boolean' && habitEligible(h, day) && (
                    <input
                      type="checkbox"
                      aria-label={`Registrar ${h.name}`}
                      checked={habitReached(h, entry?.value ?? 0)}
                      disabled={busy}
                      onChange={(e) => void record(h, e.target.checked ? 1 : 0)}
                    />
                  )}
                  <button className="habit-title" onClick={() => setEditing(h)}>
                    {h.name}
                  </button>
                  {!h.active && <span className="muted">Pausado</span>}
                </div>
                <p className="muted">
                  Esta semana: {progress.weekDone}/{progress.weekTarget} · Últimos 30 dias:{' '}
                  {progress.consistency}%
                  {h.kind === 'quantity'
                    ? ` · Hoje: ${entry?.value ?? 0}/${h.target_value} ${h.unit}`
                    : ''}
                </p>
                {progress.weekTarget > 0 && (
                  <progress
                    className="habit-progress"
                    aria-label={`Progresso semanal de ${h.name}`}
                    max={progress.weekTarget}
                    value={Math.min(progress.weekDone, progress.weekTarget)}
                  />
                )}
                {h.kind === 'quantity' && h.target_value > 0 && (
                  <progress
                    className="habit-progress"
                    aria-label={`Progresso de hoje em ${h.name}`}
                    max={h.target_value}
                    value={Math.min(entry?.value ?? 0, h.target_value)}
                  />
                )}
                {h.kind === 'quantity' && habitEligible(h, day) && (
                  <Quantity
                    key={`${h.id}-${entry?.value}`}
                    value={entry?.value ?? 0}
                    unit={h.unit}
                    busy={busy}
                    onSave={(value) => void record(h, value)}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
      {editing !== undefined && (
        <HabitEditor
          habit={editing}
          day={day}
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
function Quantity({
  value,
  unit,
  busy,
  onSave,
}: {
  value: number;
  unit: string;
  busy: boolean;
  onSave: (value: number) => void;
}) {
  const [amount, setAmount] = useState(String(value));
  return (
    <form
      className="habit-quantity"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(Number(amount));
      }}
    >
      <input
        aria-label={`Quantidade em ${unit}`}
        type="number"
        min="0"
        step="any"
        required
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={busy}
      />
      <span>{unit}</span>
      <button className="secondary-button" disabled={busy}>
        Registrar
      </button>
    </form>
  );
}
