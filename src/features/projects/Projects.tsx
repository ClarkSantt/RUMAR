import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { QuickEntry } from '../../components/QuickEntry';
import type { RumoStore } from '../../hooks/useRumo';
import { getDatabase } from '../../lib/database/connection';
import { localDate } from '../../lib/dates';
import type { TaskOccurrence } from '../../types/models';
import { nextOccurrence, occurrence } from '../tasks/domain';
import { TaskList } from '../tasks/TaskList';
import { HomeHabits } from '../habits/Habits';
import { ProjectEditor } from './ProjectEditor';
import { ProjectCard } from './ProjectCard';
import { ProjectDetailOverview } from './ProjectDetailOverview';
import { ProjectActionMenu } from './ProjectActionMenu';
import { ProjectsRepository } from './repository';
import { SaveTemplateButton } from '../templates/SaveTemplateButton';
import { Attachments } from '../attachments/Attachments';
import { DependenciesPanel } from '../dependencies/DependenciesPanel';
import { VersionHistory } from '../versions/VersionHistory';
import type { ProjectInput, ProjectSection, ProjectStatus, ProjectSummary } from './types';
import './projects.css';

const statuses: Record<ProjectStatus, string> = {
  active: 'Ativos',
  paused: 'Pausados',
  completed: 'Concluídos',
  archived: 'Arquivados',
};
const emptyStatus: Record<ProjectStatus, string> = {
  active: 'ativo',
  paused: 'pausado',
  completed: 'concluído',
  archived: 'arquivado',
};
export function projectEmptyCopy(view: ProjectStatus, hasProjects: boolean) {
  return hasProjects
    ? {
        title: `Nenhum projeto ${emptyStatus[view]}.`,
        description: 'Você não possui projetos com esse status.',
      }
    : {
        title: 'Nenhum projeto ainda.',
        description: 'Projetos reúnem tarefas e etapas para realizar um plano.',
      };
}
export function projectsForStatus(projects: ProjectSummary[], view: ProjectStatus) {
  return projects.filter((project) => project.status === view);
}
const repository = async () => new ProjectsRepository(await getDatabase());
let rememberedProjectView: ProjectStatus = 'active';
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
    [view, setView] = useState<ProjectStatus>(rememberedProjectView);
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
  const visibleProjects = projectsForStatus(projects, view);
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
    const sectionRows = rows.filter(
      (row) => (row.task.project_section_id ?? null) === (section?.id ?? null),
    );
    return (
      <section className="project-section" key={section?.id ?? 'unsectioned'}>
        <header className="project-section-header">
          <div>
            <h2>{section?.name ?? 'Sem seção'}</h2>
            <span>
              {sectionRows.length} {sectionRows.length === 1 ? 'tarefa' : 'tarefas'}
            </span>
          </div>
          {section && (
            <ProjectActionMenu label={`Ações da seção ${section.name}`} compact>
              <button
                aria-label={`Mover ${section.name} para cima`}
                disabled={store.busy || index === 0}
                onClick={() => void run((repo) => repo.moveSection(project!.id, section.id, -1))}
              >
                <ArrowUp size={16} /> Mover para cima
              </button>
              <button
                aria-label={`Mover ${section.name} para baixo`}
                disabled={store.busy || index === sections.length - 1}
                onClick={() => void run((repo) => repo.moveSection(project!.id, section.id, 1))}
              >
                <ArrowDown size={16} /> Mover para baixo
              </button>
              <button
                aria-label={`Renomear ${section.name}`}
                onClick={() => {
                  setSectionEdit(section);
                  setSectionName(section.name);
                }}
              >
                <Pencil size={16} /> Renomear
              </button>
              <button
                aria-label={`Excluir seção ${section.name}`}
                onClick={() => setDeleteSection(section)}
              >
                <Trash2 size={16} /> Excluir seção
              </button>
            </ProjectActionMenu>
          )}
        </header>
        <TaskList
          rows={sectionRows}
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
    <div className="projects-page">
      {error && <p role="alert">{error}</p>}
      {project ? (
        <>
          <button className="text-button project-back" onClick={() => setSelected(null)}>
            <ArrowLeft size={16} />
            Todos os projetos
          </button>
          <ProjectDetailOverview project={project} onEdit={() => setEditor('edit')} />
          <div className="project-detail-toolbar">
            {project.status !== 'active' && (
              <button
                className="primary-button"
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
            <SaveTemplateButton kind="project" sourceId={project.id} initialName={project.name} />
            <VersionHistory type="project" entityId={project.id} onRestored={() => store.retry()} />
            <ProjectActionMenu label="Mais ações do projeto">
              {project.status !== 'completed' && (
                <button disabled={store.busy} onClick={() => status('completed')}>
                  Concluir projeto
                </button>
              )}
              {project.status !== 'archived' && (
                <button disabled={store.busy} onClick={() => status('archived')}>
                  Arquivar
                </button>
              )}
              <button
                className="danger"
                onClick={() => {
                  setDeleteTasks(false);
                  setConfirm('delete');
                }}
              >
                Excluir projeto
              </button>
            </ProjectActionMenu>
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
          <DependenciesPanel type="project" entityId={project.id} onChanged={store.retry} />
          <Attachments entityType="project" entityId={project.id} />
        </>
      ) : (
        <>
          <header className="page-header header-with-action module-header">
            <div className="module-heading">
              <span className="module-heading-icon" aria-hidden="true">
                <FolderKanban size={22} />
              </span>
              <div>
                <h1>Projetos</h1>
                <p>Transforme ideias em resultados reais.</p>
              </div>
            </div>
            <button className="primary-button" onClick={() => setEditor('new')}>
              <Plus size={17} />
              Novo projeto
            </button>
          </header>
          <nav className="tabs project-tabs" aria-label="Status dos projetos">
            {(Object.keys(statuses) as ProjectStatus[]).map((s) => (
              <button
                key={s}
                aria-current={view === s ? 'page' : undefined}
                onClick={() => {
                  rememberedProjectView = s;
                  setView(s);
                }}
              >
                {statuses[s]}
              </button>
            ))}
          </nav>
          {visibleProjects.length ? (
            <div className="project-list">
              {visibleProjects.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={() => setSelected(p.id)} />
              ))}
            </div>
          ) : (
            <EmptyState
              illustration={
                !projects.length ? '/assets/rumar/empty-states/empty-projects.png' : undefined
              }
              title={projectEmptyCopy(view, projects.length > 0).title}
              description={projectEmptyCopy(view, projects.length > 0).description}
              icon={FolderKanban}
              action={
                !projects.length
                  ? { label: 'Criar primeiro projeto', onClick: () => setEditor('new') }
                  : undefined
              }
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
          title={confirm === 'complete' ? 'Concluir projeto?' : 'Mover projeto para a Lixeira?'}
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
                  O projeto continuará disponível na Lixeira para restauração. Arquivar continua
                  sendo a opção para mantê-lo fora da lista ativa sem removê-lo.
                </p>
                <label htmlFor="delete-project-tasks">Tarefas do projeto</label>
                <select
                  id="delete-project-tasks"
                  value={deleteTasks ? 'delete' : 'keep'}
                  onChange={(e) => setDeleteTasks(e.target.value === 'delete')}
                >
                  <option value="keep">Manter tarefas sem projeto</option>
                  <option value="delete">Mover também as tarefas para a Lixeira</option>
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
                else {
                  let deletedAt = '';
                  const removeTasks = deleteTasks;
                  void run(async (repo) => {
                    deletedAt = await repo.remove(project.id, removeTasks);
                  }).then((ok) => {
                    if (ok) {
                      store.setNotice({
                        message: 'Projeto movido para a Lixeira.',
                        undo: async () => {
                          await new ProjectsRepository(await getDatabase()).restore(
                            project.id,
                            removeTasks,
                            deletedAt,
                          );
                          await store.retry();
                          return true;
                        },
                      });
                      setConfirm(null);
                      setSelected(null);
                    }
                  });
                }
              }}
            >
              {confirm === 'complete' ? 'Concluir mesmo assim' : 'Mover para a Lixeira'}
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
    </div>
  );
}
