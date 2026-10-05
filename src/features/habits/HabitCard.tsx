import { useState } from 'react';
import { CalendarDays, Check, Repeat2 } from 'lucide-react';
import { addDays, parseDate } from '../../lib/dates';
import { ProjectActionMenu } from '../projects/ProjectActionMenu';
import {
  habitEligible,
  habitProgress,
  habitReached,
  weekStart,
  type Habit,
  type HabitEntry,
} from './domain';

const weekLabels = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

export function HabitCard({
  habit,
  entries,
  day,
  busy,
  onRecord,
  onEdit,
}: {
  habit: Habit;
  entries: HabitEntry[];
  day: string;
  busy: boolean;
  onRecord: (value: number) => void;
  onEdit: () => void;
}) {
  const todayEntry = entries.find(
    (entry) => entry.habit_id === habit.id && entry.entry_date === day,
  );
  const value = todayEntry?.value ?? 0;
  const done = habitReached(habit, value);
  const eligible = habitEligible(habit, day);
  const progress = habitProgress(habit, entries, day);
  const weekAchieved = Math.min(progress.weekDone, progress.weekTarget);
  const week = Array.from({ length: 7 }, (_, index) => addDays(weekStart(day), index));
  return (
    <article className={`habit-card${done && eligible ? ' is-done' : ''}`}>
      <div className="habit-card-top">
        <span className="habit-card-symbol" aria-hidden="true">
          <Repeat2 size={19} />
        </span>
        <div className="habit-card-title">
          <h2>{habit.name}</h2>
          <p>
            {habit.description ||
              (habit.frequency === 'weekly_target'
                ? `${habit.weekly_target} vezes por semana`
                : habit.frequency === 'weekdays'
                  ? 'Dias selecionados'
                  : 'Todos os dias')}
          </p>
        </div>
        <ProjectActionMenu label={`Mais ações de ${habit.name}`} compact>
          <button onClick={onEdit}>Editar e ver histórico</button>
        </ProjectActionMenu>
      </div>
      {!habit.active && <span className="habit-card-state">Pausado</span>}
      <div className="habit-card-metric">
        <div>
          <span className="habit-card-label">
            {habit.kind === 'quantity' ? 'Hoje' : 'Esta semana'}
          </span>
          <strong>
            {habit.kind === 'quantity'
              ? `${value} / ${habit.target_value} ${habit.unit}`
              : `${weekAchieved} de ${progress.weekTarget} dias`}
          </strong>
        </div>
        <span className="habit-card-consistency">{progress.consistency}% nos últimos 30 dias</span>
      </div>
      <progress
        max={habit.kind === 'quantity' ? habit.target_value : Math.max(progress.weekTarget, 1)}
        value={habit.kind === 'quantity' ? Math.min(value, habit.target_value) : weekAchieved}
        aria-label={`${habit.kind === 'quantity' ? 'Progresso de hoje' : 'Progresso semanal'} de ${habit.name}`}
      />
      {eligible &&
        (habit.kind === 'boolean' ? (
          <label className="habit-card-checkin">
            <input
              type="checkbox"
              checked={done}
              disabled={busy}
              onChange={(event) => onRecord(event.currentTarget.checked ? 1 : 0)}
            />
            <span>{done ? 'Concluído hoje' : 'Concluir hoje'}</span>
          </label>
        ) : (
          <QuantityCheckIn
            key={`${habit.id}-${value}`}
            value={value}
            unit={habit.unit}
            busy={busy}
            onRecord={onRecord}
          />
        ))}
      {!eligible && <p className="habit-card-unavailable">Sem check-in previsto para esta data.</p>}
      <ol className="habit-week" aria-label={`Semana de ${habit.name}`}>
        {week.map((date, index) => {
          const entry = entries.find(
            (item) => item.habit_id === habit.id && item.entry_date === date,
          );
          const scheduled = habitEligible({ ...habit, active: 1, archived_at: null }, date);
          const state = !scheduled
            ? 'off'
            : entry && habitReached(habit, entry.value)
              ? 'done'
              : entry && entry.value > 0
                ? 'partial'
                : date > day
                  ? 'future'
                  : 'pending';
          const spokenDate = new Intl.DateTimeFormat('pt-BR', {
            day: 'numeric',
            month: 'long',
          }).format(parseDate(date));
          return (
            <li
              key={date}
              data-state={state}
              aria-label={`${spokenDate}: ${state === 'done' ? 'concluído' : state === 'partial' ? 'parcial' : state === 'off' ? 'não previsto' : 'sem registro'}`}
            >
              <span>{weekLabels[index]}</span>
              <span className="habit-week-mark" aria-hidden="true">
                {state === 'done' ? <Check size={12} /> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {habit.kind === 'quantity' && (
        <span className="habit-card-week-note">
          <CalendarDays size={14} aria-hidden="true" /> {weekAchieved} de {progress.weekTarget}{' '}
          nesta semana
        </span>
      )}
    </article>
  );
}

function QuantityCheckIn({
  value,
  unit,
  busy,
  onRecord,
}: {
  value: number;
  unit: string;
  busy: boolean;
  onRecord: (value: number) => void;
}) {
  const [amount, setAmount] = useState(String(value));
  return (
    <form
      className="habit-card-quantity"
      onSubmit={(event) => {
        event.preventDefault();
        onRecord(Number(amount));
      }}
    >
      <label>
        <span>Registrar quantidade em {unit}</span>
        <input
          type="number"
          min="0"
          step="any"
          required
          value={amount}
          onChange={(event) => setAmount(event.currentTarget.value)}
          disabled={busy}
        />
      </label>
      <button className="primary-button" disabled={busy}>
        Registrar
      </button>
    </form>
  );
}
