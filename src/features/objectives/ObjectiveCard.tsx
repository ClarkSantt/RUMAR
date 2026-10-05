import type { CSSProperties } from 'react';
import { ArrowRight, CalendarDays, Flag, Link2, Target } from 'lucide-react';
import type { Objective, ObjectiveProgress } from './repository';

const statusLabel = {
  active: 'Em andamento',
  paused: 'Em pausa',
  completed: 'Concluído',
  archived: 'Arquivado',
} as const;

export function ObjectiveCard({
  objective,
  category,
  progress,
  milestones,
  onOpen,
}: {
  objective: Objective & { link_count: number };
  category: string;
  progress?: ObjectiveProgress | null;
  milestones?: { total: number; completed: number };
  onOpen: () => void;
}) {
  const percent = progress && !progress.hidden ? progress.percent : null;
  const rounded = percent === null || percent === undefined ? null : Math.round(percent);
  return (
    <button
      className="objective-card"
      onClick={onOpen}
      aria-label={`Abrir objetivo ${objective.name}`}
    >
      <span className="objective-card-symbol" aria-hidden="true">
        <Target size={21} />
      </span>
      <span className="objective-card-main">
        <span className="objective-card-kicker">
          <span>{category}</span>
          <span>·</span>
          <span>{statusLabel[objective.status]}</span>
        </span>
        <strong>{objective.name}</strong>
        {objective.description && (
          <span className="objective-card-description">{objective.description}</span>
        )}
        <span className="objective-card-meta">
          {objective.target_date && (
            <span>
              <CalendarDays size={14} aria-hidden="true" /> Prazo{' '}
              {objective.target_date.split('-').reverse().join('/')}
            </span>
          )}
          {milestones && milestones.total > 0 && (
            <span>
              <Flag size={14} aria-hidden="true" /> {milestones.completed} de {milestones.total}{' '}
              marcos
            </span>
          )}
          <span>
            <Link2 size={14} aria-hidden="true" /> {objective.link_count}{' '}
            {objective.link_count === 1 ? 'vínculo' : 'vínculos'}
          </span>
        </span>
      </span>
      <span className="objective-card-end">
        {rounded !== null ? (
          <span
            className="objective-progress-ring"
            style={{ '--progress': `${rounded}%` } as CSSProperties}
            aria-label={`${rounded}% de progresso`}
          >
            <span>{rounded}%</span>
          </span>
        ) : (
          <span className="objective-card-no-progress">
            {progress?.hidden ? 'Valores ocultos' : 'Sem indicador'}
          </span>
        )}
        <ArrowRight size={17} aria-hidden="true" />
      </span>
    </button>
  );
}
