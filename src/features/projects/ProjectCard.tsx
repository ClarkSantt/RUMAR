import { ArrowRight, CalendarDays, CheckCheck, FolderKanban } from 'lucide-react';
import { formatDate } from '../../lib/dates';
import type { ProjectSummary } from './types';

const statusLabel = {
  active: 'Em andamento',
  paused: 'Em pausa',
  completed: 'Concluído',
  archived: 'Arquivado',
} as const;

export function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  const percent = project.task_count
    ? Math.round((project.completed_count / project.task_count) * 100)
    : 0;
  return (
    <button className="project-card" onClick={onOpen} aria-label={`Abrir projeto ${project.name}`}>
      <span className="project-card-top">
        <span className="project-card-icon" aria-hidden="true">
          <FolderKanban size={20} />
        </span>
        <span className={`project-status project-status-${project.status}`}>
          {statusLabel[project.status]}
        </span>
        <ArrowRight className="project-card-arrow" size={17} aria-hidden="true" />
      </span>
      <span className="project-card-copy">
        <strong>{project.name}</strong>
        {project.description && <span>{project.description}</span>}
      </span>
      <span className="project-card-progress">
        <span className="project-card-progress-label">
          <span>Progresso</span>
          <strong>{percent}%</strong>
        </span>
        <progress
          max={project.task_count || 1}
          value={project.completed_count}
          aria-label={`Progresso de ${project.name}`}
        />
        <span className="project-card-count">
          <CheckCheck size={15} aria-hidden="true" />
          {project.completed_count} de {project.task_count} tarefas
        </span>
      </span>
      <span className="project-card-bottom">
        <span className="project-card-next">
          <small>Próxima ação</small>
          <span>{project.next_task ?? 'Nenhuma tarefa pendente'}</span>
        </span>
        {project.target_date && (
          <span className="project-card-date">
            <CalendarDays size={15} aria-hidden="true" />
            <span>Prazo {formatDate(project.target_date)}</span>
          </span>
        )}
      </span>
    </button>
  );
}
