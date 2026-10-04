import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { addDays, formatDate } from '../../lib/dates';
import type { ProjectSummary } from '../projects/types';
import { homeOverview } from './repository';
export function HomeProjects({
  day,
  onNavigate,
  revision,
}: {
  day: string;
  revision?: unknown;
  onNavigate: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [deadlines, setDeadlines] = useState<{ id: string; name: string; date: string }[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => homeOverview(db, day, addDays(day, 30)))
      .then((data) => {
        if (active) {
          setProjects(data.projects);
          setDeadlines(data.deadlines);
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os próximos prazos.');
      });
    return () => {
      active = false;
    };
  }, [day, revision]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {deadlines.length > 0 && (
        <section className="secondary-section">
          <div className="section-heading">
            <h2>Próximos</h2>
          </div>
          {deadlines.map((d) => (
            <p key={d.id} className="calendar-detail-item">
              <span className="field-help">{formatDate(d.date)} · </span>
              {d.name}
            </p>
          ))}
        </section>
      )}
      {projects.length > 0 && (
        <section className="secondary-section">
          <div className="section-heading">
            <h2>Em andamento</h2>
            <button className="text-button" onClick={onNavigate}>
              Ver projetos
            </button>
          </div>
          {projects.map((p) => (
            <button className="calendar-detail-item" key={p.id} onClick={onNavigate}>
              {p.name}
              <span className="field-help">
                {' '}
                ·{' '}
                {p.task_count
                  ? `${Math.round((p.completed_count / p.task_count) * 100)}% · ${p.completed_count} de ${p.task_count} tarefas`
                  : '0 tarefas'}
              </span>
            </button>
          ))}
        </section>
      )}
    </>
  );
}
