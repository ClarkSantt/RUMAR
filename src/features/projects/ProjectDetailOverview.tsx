import { CalendarDays, FolderKanban } from 'lucide-react';
import { formatDate } from '../../lib/dates';
import type { ProjectSummary } from './types';

const statusLabel = {
  active: 'Ativo',
  paused: 'Pausado',
  completed: 'Concluído',
  archived: 'Arquivado',
} as const;

export function ProjectDetailOverview({
  project,
  onEdit,
}: {
  project: ProjectSummary;
  onEdit: () => void;
}) {
  return (
    <>
      <header className="page-header header-with-action module-header project-detail-header">
        <div className="module-heading">
          <span className="module-heading-icon" aria-hidden="true">
            <FolderKanban size={22} />
          </span>
          <div>
            <span className={`project-status project-status-${project.status}`}>
              {statusLabel[project.status]}
            </span>
            <h1>{project.name}</h1>
            {project.description && <p className="project-description">{project.description}</p>}
          </div>
        </div>
        <button className="secondary-button" onClick={onEdit}>
          Editar projeto
        </button>
      </header>
      <div className="project-summary">
        <div className="project-summary-main">
          <span className="project-summary-label">Execução</span>
          <strong>
            {project.task_count
              ? `${project.completed_count} de ${project.task_count} tarefas concluídas`
              : '0 tarefas'}
          </strong>
          {project.task_count > 0 && (
            <progress
              aria-label="Progresso do projeto"
              max={project.task_count}
              value={project.completed_count}
            />
          )}
          <p>
            <span>Próxima ação</span>
            {project.next_task ?? 'Nenhuma tarefa pendente.'}
          </p>
        </div>
        <div className="project-summary-dates">
          {project.start_date && (
            <p>
              Início <strong>{formatDate(project.start_date)}</strong>
            </p>
          )}
          {project.target_date && (
            <p>
              <CalendarDays size={16} aria-hidden="true" /> Prazo{' '}
              <strong>{formatDate(project.target_date)}</strong>
            </p>
          )}
        </div>
      </div>
    </>
  );
}
