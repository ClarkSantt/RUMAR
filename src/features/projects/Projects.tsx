import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { QuickEntry } from '../../components/QuickEntry';
import type { RumoStore } from '../../hooks/useRumo';
import { getDatabase } from '../../lib/database/connection';
import { formatDate, localDate } from '../../lib/dates';
import type { TaskOccurrence } from '../../types/models';
import { nextOccurrence, occurrence } from '../tasks/domain';
import { TaskList } from '../tasks/TaskList';
import { HomeHabits } from '../habits/Habits';
import { ProjectEditor } from './ProjectEditor';
import { ProjectsRepository } from './repository';
import { SaveTemplateButton } from '../templates/SaveTemplateButton';
import { Attachments } from '../attachments/Attachments';
import type { ProjectInput, ProjectSection, ProjectStatus, ProjectSummary } from './types';
import './projects.css';

const statuses: Record<ProjectStatus, string> = {
  active: 'Ativos',
  paused: 'Pausados',
  completed: 'Concluídos',
  archived: 'Arquivados',
};
const repository = async () => new ProjectsRepository(await getDatabase());
export function Projects({
  store,
  onOpen,
  initialProjectId,
}: {
  store: RumoStore;
  onOpen: (row: TaskOccurrence) => void;
  initialProjectId?: string;
  onCreate?: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [selected, setSelected] = useState<string | null>(initialProjectId ?? null),
    [view, setView] = useState<ProjectStatus>('active');
  const [sections, setSections] = useState<ProjectSection[]>([]),
    [error, setError] = useState('');
  const [editor, setEditor] = useState<'new' | 'edit' | null>(null),
    [confirm, setConfirm] = useState<'complete' | 'delete' | null>(null),
    [deleteTasks, setDeleteTasks] = useState(false);
  const [sectionEdit, setSectionEdit] = useState<ProjectSection | null>(null),
    [sectionName, setSectionName] = useState(''),
    [deleteSection, setDeleteSection] = useState<ProjectSection | null>(null);
  useEffect(() => {
    let active = true;
    void repository()
      .then(async (repo) => {
        const [current, archived, list] = await Promise.all([
          repo.list(),
          repo.list('archived'),
          selected ? repo.sections(selected) : [],
        ]);
        if (active) {
          setProjects([...current, ...archived]);
          setSections(list);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os projetos. Tente novamente.');
      });
    return () => {
      active = false;
    };
  }, [store.data, selected]);
  const project = projects.find((p) => p.id === selected);
  const run = (action: (repo: ProjectsRepository) => Promise<unknown>, message?: string) =>
    store.run(async () => action(await repository()), message);
  async function save(input: ProjectInput) {
    let id = project?.id;
    const ok = await run(async (repo) => {
      if (editor === 'edit' && id) await repo.update(id, input);
      else id = await repo.create(input);
    }, 'Projeto salvo.');
    if (ok && id) setSelected(id);
    return ok;
  }
  function status(value: ProjectStatus, confirmed = false) {
    if (!project) return;
    if (value === 'completed' && project.task_count > project.completed_count && !confirmed) {
      setConfirm('complete');
      return;
    }
    void run(
      (repo) => repo.setStatus(project.id, value, confirmed),
      'Status do projeto atualizado.',
    ).then((ok) => {
      if (ok) setConfirm(null);
    });
  }
  const rows = store
    .data!.tasks.filter((t) => t.project_id === selected)
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    )
    .map((t) => occurrence(t, nextOccurrence(t, localDate()), store.data!));
  function sectionBlock(section: ProjectSection | null, index: number) {
    return (
      <section className="project-section" key={section?.id ?? 'unsectioned'}>
        <header className="project-section-header">
          <h2>{section?.name ?? 'Sem seção'}</h2>
          {section && (
            <div className="project-actions">
              <button
                className="icon-button"
                aria-label={`Mover ${section.name} para cima`}
                disabled={store.busy || index === 0}
                onClick={() => void run((repo) => repo.moveSection(project!.id, section.id, -1))}
              >
                <ArrowUp size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={`Mover ${section.name} para baixo`}
                disabled={store.busy || index === sections.length - 1}
                onClick={() => void run((repo) => repo.moveSection(project!.id, section.id, 1))}
              >
                <ArrowDown size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={`Renomear ${section.name}`}
                onClick={() => {
                  setSectionEdit(section);
                  setSectionName(section.name);
                }}
              >
                <Pencil size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={`Excluir seção ${section.name}`}
                onClick={() => setDeleteSection(section)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </header>
        <TaskList
          rows={rows.filter(
            (row) => (row.task.project_section_id ?? null) === (section?.id ?? null),
          )}
          store={store}
          onOpen={onOpen}
          showDate
          emptyTitle="Nenhuma tarefa nesta seção."
        />
        <QuickEntry
          placeholder={`Adicionar tarefa em ${section?.name ?? 'Sem seção'}…`}
          busy={store.busy}
          onSave={(title) =>
            store.run(
              (repo) =>
                repo.createTask({
                  title,
                  description: '',
                  priority: 'normal',
                  due_date: null,
                  due_time: null,
                  recurrence: null,
                  project_id: project!.id,
                  project_section_id: section?.id ?? null,
                }),
              'Tarefa adicionada.',
            )
          }
        />
      </section>
    );
  }
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {project ? (
        <>
          <button className="text-button project-back" onClick={() => setSelected(null)}>
            <ArrowLeft size={16} />
            Todos os projetos
          </button>
          <header className="page-header header-with-action">
            <div>
              <p className="eyebrow">PROJETO · {statuses[project.status].toUpperCase()}</p>
              <h1>{project.name}</h1>
              {project.description && <p className="project-description">{project.description}</p>}
            </div>
            <button className="secondary-button" onClick={() => setEditor('edit')}>
              Editar projeto
            </button>
          </header>
          <div className="project-summary">
            <div>
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
                {project.next_task ? `Próxima: ${project.next_task}` : 'Nenhuma tarefa pendente.'}
              </p>
            </div>
            <div>
              {project.start_date && <p>Início {formatDate(project.start_date)}</p>}
              {project.target_date && <p>Prazo {formatDate(project.target_date)}</p>}
            </div>
          </div>
          <div className="project-actions project-status-actions">
            <SaveTemplateButton kind="project" sourceId={project.id} initialName={project.name} />
            {project.status !== 'active' && (
              <button
                className="secondary-button"
                disabled={store.busy}
                onClick={() => status('active')}
              >
                Ativar projeto
              </button>
            )}
            {project.status === 'active' && (
              <button
                className="secondary-button"
                disabled={store.busy}
                onClick={() => status('paused')}
              >
                Pausar projeto
              </button>
            )}
            {project.status !== 'completed' && (
              <button
                className="secondary-button"
                disabled={store.busy}
                onClick={() => status('completed')}
              >
                Concluir projeto
              </button>
            )}
            {project.status !== 'archived' && (
              <button
                className="text-button"
                disabled={store.busy}
                onClick={() => status('archived')}
              >
                Arquivar
              </button>
            )}
            <button
              className="text-button danger"
              onClick={() => {
                setDeleteTasks(false);
                setConfirm('delete');
              }}
            >
              Excluir projeto
            </button>
          </div>
          {sectionBlock(null, -1)}
          {sections.map((section, index) => sectionBlock(section, index))}
          <QuickEntry
            placeholder="Adicionar seção…"
            busy={store.busy}
            onSave={(title) =>
              run((repo) => repo.createSection(project.id, title), 'Seção criada.')
            }
          />
          <section className="project-section">
            <h2>Hábitos ligados</h2>
            <HomeHabits day={localDate()} projectId={project.id} />
          </section>
          <Attachments entityType="project" entityId={project.id} />
        </>
      ) : (
        <>
          <header className="page-header header-with-action">
            <div>
              <p className="eyebrow">UM PASSO DE CADA VEZ</p>
              <h1>Projetos</h1>
              <p>Dê espaço aos planos que precisam de mais de uma tarefa.</p>
            </div>
            <button className="primary-button" onClick={() => setEditor('new')}>
              <Plus size={17} />
              Novo projeto
            </button>
          </header>
          <nav className="tabs" aria-label="Status dos projetos">
            {(Object.keys(statuses) as ProjectStatus[]).map((s) => (
              <button
                key={s}
                aria-current={view === s ? 'page' : undefined}
                onClick={() => setView(s)}
              >
                {statuses[s]}
              </button>
            ))}
          </nav>
          {projects.filter((p) => p.status === view).length ? (
            <div className="project-list">
              {projects
                .filter((p) => p.status === view)
                .map((p) => (
                  <button className="project-row" key={p.id} onClick={() => setSelected(p.id)}>
                    <span>
                      <strong>{p.name}</strong>
                      {p.description && (
                        <span className="project-row-description">{p.description}</span>
                      )}
                      <span className="project-row-next">
                        {p.next_task ? `Próxima: ${p.next_task}` : 'Nenhuma tarefa pendente'}
                      </span>
                      {p.task_count > 0 && (
                        <progress
                          aria-label={`Progresso de ${p.name}`}
                          max={p.task_count}
                          value={p.completed_count}
                        />
                      )}
                    </span>
                    <span className="project-row-meta">
                      {p.task_count
                        ? `${Math.round((p.completed_count / p.task_count) * 100)}% · ${p.completed_count}/${p.task_count} tarefas`
                        : '0 tarefas'}
                      {p.target_date && <span>{formatDate(p.target_date)}</span>}
                    </span>
                  </button>
                ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhum projeto ainda."
              description="Projetos organizam objetivos que precisam de mais de uma ação."
              icon={FolderKanban}
              action={{ label: 'Criar primeiro projeto', onClick: () => setEditor('new') }}
            />
          )}
        </>
      )}
      {editor && (
        <ProjectEditor
          project={editor === 'edit' ? project : undefined}
          busy={store.busy}
          onSave={save}
          onClose={() => setEditor(null)}
        />
      )}
      {confirm && project && (
        <Dialog
          title={confirm === 'complete' ? 'Concluir projeto?' : 'Excluir projeto?'}
          busy={store.busy}
          onClose={() => setConfirm(null)}
        >
          <div className="dialog-content">
            {confirm === 'complete' ? (
              <p>
                Há {project.task_count - project.completed_count} tarefas pendentes. Elas
                continuarão pendentes ao concluir o projeto.
              </p>
            ) : (
              <>
                <p>
                  O projeto e suas seções serão excluídos. Você também pode arquivar para preservar
                  a organização.
                </p>
                <label htmlFor="delete-project-tasks">Tarefas do projeto</label>
                <select
                  id="delete-project-tasks"
                  value={deleteTasks ? 'delete' : 'keep'}
                  onChange={(e) => setDeleteTasks(e.target.value === 'delete')}
                >
                  <option value="keep">Manter tarefas sem projeto</option>
                  <option value="delete">Excluir também todas as tarefas do projeto</option>
                </select>
              </>
            )}
          </div>
          <footer className="drawer-footer">
            <button
              className="secondary-button"
              disabled={store.busy}
              onClick={() => setConfirm(null)}
            >
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={store.busy}
              onClick={() => {
                if (confirm === 'complete') status('completed', true);
                else
                  void run(
                    (repo) => repo.remove(project.id, deleteTasks),
                    'Projeto excluído.',
                  ).then((ok) => {
                    if (ok) {
                      setConfirm(null);
                      setSelected(null);
                    }
                  });
              }}
            >
              {confirm === 'complete' ? 'Concluir mesmo assim' : 'Confirmar exclusão'}
            </button>
          </footer>
        </Dialog>
      )}
      {sectionEdit && (
        <Dialog title="Renomear seção" busy={store.busy} onClose={() => setSectionEdit(null)}>
          <form
            className="project-dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run((repo) => repo.renameSection(sectionEdit.id, sectionName)).then((ok) => {
                if (ok) setSectionEdit(null);
              });
            }}
          >
            <div className="dialog-content">
              <label htmlFor="section-name">Nome da seção</label>
              <input
                id="section-name"
                autoFocus
                required
                maxLength={500}
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
              />
            </div>
            <footer className="drawer-footer">
              <button className="primary-button" disabled={store.busy}>
                Salvar seção
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {deleteSection && (
        <Dialog title="Excluir seção?" busy={store.busy} onClose={() => setDeleteSection(null)}>
          <div className="dialog-content">
            <p>As tarefas de “{deleteSection.name}” ficarão em Sem seção, dentro deste projeto.</p>
          </div>
          <footer className="drawer-footer">
            <button className="secondary-button" onClick={() => setDeleteSection(null)}>
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={store.busy}
              onClick={() =>
                void run((repo) => repo.deleteSection(deleteSection.id)).then((ok) => {
                  if (ok) setDeleteSection(null);
                })
              }
            >
              Excluir seção
            </button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
