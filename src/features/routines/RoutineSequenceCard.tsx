import type { ReactNode } from 'react';
import { Check, ChevronDown, Clock3, ListChecks, Play, RotateCcw } from 'lucide-react';
import { ProjectActionMenu } from '../projects/ProjectActionMenu';
import type { Routine, RoutineCompletion, RoutineItem, RoutineOccurrence } from './domain';

export function RoutineSequenceCard({
  routine,
  items,
  occurrence,
  completions,
  eligible,
  expanded,
  busy,
  onExpand,
  onEdit,
  onStart,
  onComplete,
  onReopen,
  onToggleStep,
  templateAction,
}: {
  routine: Routine;
  items: RoutineItem[];
  occurrence?: RoutineOccurrence;
  completions: RoutineCompletion[];
  eligible: boolean;
  expanded: boolean;
  busy: boolean;
  onExpand: () => void;
  onEdit: () => void;
  onStart: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onToggleStep: (itemId: string, checked: boolean) => void;
  templateAction?: ReactNode;
}) {
  const completed = occurrence?.completed_at ? items.length : completions.length;
  const running = !!occurrence && !occurrence.completed_at;
  const status = !routine.active
    ? 'Pausada'
    : occurrence?.completed_at
      ? 'Concluída'
      : running
        ? 'Em andamento'
        : eligible
          ? 'Pronta para iniciar'
          : 'Não prevista hoje';
  return (
    <article className={`routine-sequence-card${running ? ' is-running' : ''}`}>
      <div className="routine-card-top">
        <button
          className="routine-card-toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Recolher' : 'Expandir'} ${routine.name}`}
          onClick={onExpand}
        >
          <span className="routine-card-symbol" aria-hidden="true">
            <ListChecks size={20} />
          </span>
          <span className="routine-card-heading">
            <span className="routine-card-status">{status}</span>
            <strong>{routine.name}</strong>
            {routine.description && (
              <span className="routine-card-description">{routine.description}</span>
            )}
          </span>
          <ChevronDown className="routine-card-chevron" size={18} aria-hidden="true" />
        </button>
        <ProjectActionMenu label={`Mais ações de ${routine.name}`} compact>
          <button onClick={onEdit}>Editar rotina e sequência</button>
        </ProjectActionMenu>
      </div>
      <div className="routine-card-context">
        <span>
          {routine.time_of_day ? (
            <>
              <Clock3 size={14} aria-hidden="true" /> {routine.time_of_day}
            </>
          ) : routine.frequency === 'daily' ? (
            'Todos os dias'
          ) : (
            'Dias selecionados'
          )}
        </span>
        <span>
          {items.length} {items.length === 1 ? 'etapa' : 'etapas'}
        </span>
        <strong>
          {completed} de {items.length} concluídas
        </strong>
      </div>
      {items.length > 0 && (
        <progress
          max={items.length}
          value={completed}
          aria-label={`Progresso de ${routine.name}`}
        />
      )}
      {!expanded && items.length > 0 && (
        <p className="routine-card-preview">
          {items
            .slice(0, 3)
            .map((item) => item.title)
            .join(' · ')}
          {items.length > 3 ? ` · +${items.length - 3} etapas` : ''}
        </p>
      )}
      {expanded && (
        <div className="routine-card-expanded">
          <h3>Sequência</h3>
          {items.length ? (
            <ol className="routine-step-list">
              {items.map((item, index) => {
                const checked =
                  !!occurrence?.completed_at ||
                  completions.some((completion) => completion.item_id === item.id);
                const current =
                  running &&
                  !checked &&
                  items
                    .slice(0, index)
                    .every((previous) =>
                      completions.some((completion) => completion.item_id === previous.id),
                    );
                return (
                  <li
                    key={item.id}
                    className={`${checked ? 'is-complete' : ''}${current ? ' is-current' : ''}`}
                  >
                    {occurrence ? (
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy || !!occurrence.completed_at}
                          onChange={(event) => onToggleStep(item.id, event.currentTarget.checked)}
                        />
                        <span className="routine-step-title">{item.title}</span>
                      </label>
                    ) : (
                      <span className="routine-step-pending">
                        <span aria-hidden="true">{index + 1}</span>
                        {item.title}
                      </span>
                    )}
                    {current && <span className="routine-step-now">Próxima etapa</span>}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="routine-card-empty">
              Adicione etapas ao editar a rotina para poder iniciá-la.
            </p>
          )}
        </div>
      )}
      <div className="routine-card-actions">
        {!occurrence ? (
          eligible && (
            <button className="primary-button" disabled={busy || !items.length} onClick={onStart}>
              <Play size={16} aria-hidden="true" /> Iniciar rotina
            </button>
          )
        ) : occurrence.completed_at ? (
          <button className="secondary-button" disabled={busy} onClick={onReopen}>
            <RotateCcw size={16} aria-hidden="true" /> Reabrir ocorrência
          </button>
        ) : expanded ? (
          <button
            className="primary-button"
            disabled={busy || !items.length || completed !== items.length}
            onClick={onComplete}
          >
            <Check size={16} aria-hidden="true" /> Concluir rotina
          </button>
        ) : (
          <button className="primary-button" disabled={busy} onClick={onExpand}>
            <Play size={16} aria-hidden="true" /> Continuar
          </button>
        )}
        {expanded && templateAction}
      </div>
    </article>
  );
}
