import { useEffect, useState } from 'react';
import { getDatabase } from '../../../lib/database/connection';
import { WorkoutScheduleRepository, type ScheduledWorkout } from '../repositories/schedule';
import { SessionsRepository } from '../repositories/sessions';
export function HomeWorkouts({ day, onNavigate }: { day: string; onNavigate: () => void }) {
  const [rows, setRows] = useState<ScheduledWorkout[]>([]);
  const [current, setCurrent] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => {
        const [items, session] = await Promise.all([
          new WorkoutScheduleRepository(db).range(day, day),
          new SessionsRepository(db).current(),
        ]);
        if (active) {
          setRows(items);
          setCurrent(session?.day_name ?? '');
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar o treino de hoje.');
      });
    return () => {
      active = false;
    };
  }, [day]);
  if (error) return <p role="alert">{error}</p>;
  if (!rows.length && !current) return null;
  return (
    <section className="secondary-section">
      <div className="section-heading">
        <h2>Treino</h2>
        <button className="text-button" onClick={onNavigate}>
          Ver treinos
        </button>
      </div>
      {current && (
        <button className="calendar-detail-item" onClick={onNavigate}>
          {current} · Continuar treino
        </button>
      )}
      {rows
        .filter((r) => !r.in_progress)
        .map((row) => (
          <button key={row.id} className="calendar-detail-item" onClick={onNavigate}>
            {row.name}{' '}
            <span className="field-help">
              · {row.completed ? 'Concluído' : `Hoje · ${row.exercise_count} exercícios · Iniciar`}
            </span>
          </button>
        ))}
    </section>
  );
}
