import { useEffect, useState } from 'react';
import { Repeat2 } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { getDatabase } from '../../lib/database/connection';
import { addDays, localDate } from '../../lib/dates';
import { habitEligible, habitProgress, habitReached, type Habit, type HabitEntry } from './domain';
import { HabitsRepository } from './repository';
import './habits.css';
import { HabitEditor } from './HabitEditor';
const repository = async () => new HabitsRepository(await getDatabase());
export function HomeHabits({ day, projectId }: { day: string; projectId?: string }) {
  return <HabitCollection day={day} projectId={projectId} compact />;
}
export function Habits() {
  return (
    <>
      <header className="page-header">
        <p className="eyebrow">ORGANIZAÇÃO</p>
        <h1>Hábitos</h1>
        <p>Constância no seu ritmo.</p>
      </header>
      <HabitCollection day={localDate()} />
    </>
  );
}
function HabitCollection({
  day,
  projectId,
  compact = false,
}: {
  day: string;
  projectId?: string;
  compact?: boolean;
}) {
  const [habits, setHabits] = useState<Habit[]>([]),
    [entries, setEntries] = useState<HabitEntry[]>([]),
    [revision, setRevision] = useState(0),
    [editing, setEditing] = useState<Habit | null | undefined>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
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
        }
      })
      .catch((e) => {
        if (current) setError(String(e));
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
  return (
    <section className="habit-section" aria-label="Hábitos">
      <div className="habit-heading">
        <h2>{projectId ? 'Hábitos vinculados' : compact ? 'Hábitos de hoje' : 'Seus hábitos'}</h2>
        {!compact && (
          <button className="primary-button" onClick={() => setEditing(null)}>
            Novo hábito
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {!shown.length &&
        (compact || projectId ? (
          <p className="muted">
            {projectId ? 'Nenhum hábito vinculado' : 'Nenhum hábito previsto para hoje.'}
          </p>
        ) : (
          <EmptyState
            icon={Repeat2}
            title="Nenhum hábito configurado."
            description="Escolha algo que gostaria de acompanhar no seu ritmo."
            action={{ label: 'Criar hábito', onClick: () => setEditing(null) }}
          />
        ))}
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
