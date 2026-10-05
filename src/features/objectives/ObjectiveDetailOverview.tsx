import type { ReactNode } from 'react';
import { CalendarDays, Target } from 'lucide-react';
import { durationLabel } from '../calendar/planner-domain';
import type { Objective, ObjectiveProgress } from './repository';

export function ObjectiveDetailOverview({
  objective,
  category,
  status,
  progress,
  focusSeconds,
  actions,
}: {
  objective: Objective;
  category: string;
  status: string;
  progress: ObjectiveProgress | null;
  focusSeconds: number;
  actions: ReactNode;
}) {
  return (
    <section className="objective-detail-hero">
      <div className="objective-detail-top">
        <span className="objective-detail-symbol" aria-hidden="true">
          <Target size={24} />
        </span>
        <div>
          <p className="objective-kicker">
            {category} · {status}
          </p>
          <h1>{objective.name}</h1>
          {objective.description && (
            <p className="objective-description">{objective.description}</p>
          )}
        </div>
      </div>
      <div className="objective-detail-meta">
        <span>Desde {objective.start_date.split('-').reverse().join('/')}</span>
        {objective.target_date && (
          <span>
            <CalendarDays size={15} aria-hidden="true" /> Prazo{' '}
            {objective.target_date.split('-').reverse().join('/')}
          </span>
        )}
      </div>
      {focusSeconds > 0 && (
        <p className="field-help">Tempo de foco registrado: {durationLabel(focusSeconds)}</p>
      )}
      {progress && (
        <div className="objective-progress">
          <strong>{progress.label}</strong>
          <span>
            {progress.hidden
              ? 'Valores ocultos'
              : `${progress.current.toLocaleString('pt-BR')}${progress.target !== null ? ` / ${progress.target.toLocaleString('pt-BR')}` : ''} ${progress.unit}`}
          </span>
          {!progress.hidden && progress.percent !== null && (
            <>
              <span className="objective-progress-percent">{Math.round(progress.percent)}%</span>
              <progress value={progress.percent} max={100} aria-label="Progresso do indicador" />
            </>
          )}
        </div>
      )}
      <div className="objective-detail-actions">{actions}</div>
    </section>
  );
}
