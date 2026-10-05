import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Link2, Plus, Target, X } from 'lucide-react';
import { getDatabase } from '../../lib/database/connection';
import { FocusRepository } from '../calendar/planner-repository';
import { Attachments } from '../attachments/Attachments';
import { Milestones } from './Milestones';
import { ObjectiveCard } from './ObjectiveCard';
import { ObjectiveDetailOverview } from './ObjectiveDetailOverview';
import {
  ObjectivesRepository,
  emptyObjectiveDraft,
  objectiveCategories,
  type Objective,
  type ObjectiveDraft,
  type ObjectiveLink,
  type ObjectiveLinkType,
  type ObjectiveProgress,
  type ObjectiveCategory,
  type ObjectiveUpdate,
} from './repository';

const categories: Record<(typeof objectiveCategories)[number], string> = {
  personal: 'Pessoal',
  health: 'Saúde e corpo',
  learning: 'Aprendizado',
  finance: 'Financeiro',
  professional: 'Profissional',
  other: 'Outro',
};
const statuses: Record<Objective['status'], string> = {
  active: 'Ativo',
  paused: 'Pausado',
  completed: 'Concluído',
  archived: 'Arquivado',
};
const linkLabels: Record<ObjectiveLinkType, string> = {
  task: 'Tarefas',
  project: 'Projetos',
  habit: 'Hábitos',
  routine: 'Rotinas',
  workout_plan: 'Treinos',
  financial_goal: 'Finanças',
  thought: 'Pensamentos',
  body_metric: 'Medidas',
  activity: 'Atividade',
  nutrition: 'Alimentação',
};
type Candidate = { entity_type: ObjectiveLinkType; entity_id: string; name: string };
type Page =
  'tasks' | 'projects' | 'habits' | 'routines' | 'workouts' | 'finance' | 'thoughts' | 'nutrition';

async function loadOverview(repo: ObjectivesRepository) {
  const list = await repo.list();
  const counts = await repo.milestoneCounts();
  const indicators = await Promise.all(
    list.map(async (objective) => {
      try {
        return [objective.id, await repo.progress(objective)] as const;
      } catch {
        return [objective.id, null] as const;
      }
    }),
  );
  return {
    list,
    indicators: Object.fromEntries(indicators) as Record<string, ObjectiveProgress | null>,
    milestones: Object.fromEntries(
      counts.map(({ objective_id, total, completed }) => [objective_id, { total, completed }]),
    ) as Record<string, { total: number; completed: number }>,
  };
}
let rememberedObjectiveCategory: ObjectiveCategory | 'all' = 'all';
export function objectivesForCategory<T extends { category: ObjectiveCategory }>(
  rows: T[],
  category: ObjectiveCategory | 'all',
) {
  return category === 'all' ? rows : rows.filter((row) => row.category === category);
}

export function Objectives({
  initialId,
  onNavigate,
  onTimeline,
}: {
  initialId?: string;
  onNavigate: (page: Page, id?: string, type?: string) => void;
  onTimeline: (id: string) => void;
}) {
  const [rows, setRows] = useState<(Objective & { link_count: number })[]>([]);
  const [listProgress, setListProgress] = useState<Record<string, ObjectiveProgress | null>>({});
  const [milestoneCounts, setMilestoneCounts] = useState<
    Record<string, { total: number; completed: number }>
  >({});
  const [categoryFilter, setCategoryFilter] = useState<ObjectiveCategory | 'all'>(
    rememberedObjectiveCategory,
  );
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [draft, setDraft] = useState<ObjectiveDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [links, setLinks] = useState<ObjectiveLink[]>([]);
  const [updates, setUpdates] = useState<ObjectiveUpdate[]>([]);
  const [progress, setProgress] = useState<ObjectiveProgress | null>(null);
  const [focusSeconds, setFocusSeconds] = useState(0);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [newEntity, setNewEntity] = useState('');
  const [newEntityType, setNewEntityType] = useState<'task' | 'project' | 'habit'>('task');
  const [updateText, setUpdateText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = rows.find((row) => row.id === selected);
  const visibleObjectives = objectivesForCategory(rows, categoryFilter);

  async function refresh(id = selected) {
    const repo = new ObjectivesRepository(await getDatabase());
    const { list, indicators, milestones } = await loadOverview(repo);
    setRows(list);
    setListProgress(indicators);
    setMilestoneCounts(milestones);
    if (id) {
      const found = list.find((row) => row.id === id);
      if (found) {
        const [relations, notes, indicator, focused] = await Promise.all([
          repo.links(id),
          repo.updates(id),
          repo.progress(found),
          new FocusRepository(await getDatabase()).objectiveSeconds(id),
        ]);
        setLinks(relations);
        setUpdates(notes);
        setProgress(indicator);
        setFocusSeconds(focused);
      } else setSelected(null);
    }
  }
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => loadOverview(new ObjectivesRepository(db)))
      .then(({ list, indicators, milestones }) => {
        if (active) {
          setRows(list);
          setListProgress(indicators);
          setMilestoneCounts(milestones);
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os objetivos.');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    void getDatabase()
      .then(async (db) => {
        const repo = new ObjectivesRepository(db);
        const found = await repo.get(selected);
        if (!found) return null;
        const [relations, notes, indicator, focused] = await Promise.all([
          repo.links(selected),
          repo.updates(selected),
          repo.progress(found),
          new FocusRepository(db).objectiveSeconds(selected),
        ]);
        return { relations, notes, indicator, focused };
      })
      .then((result) => {
        if (active && result) {
          setLinks(result.relations);
          setUpdates(result.notes);
          setProgress(result.indicator);
          setFocusSeconds(result.focused);
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível abrir o objetivo.');
      });
    return () => {
      active = false;
    };
  }, [selected]);
  useEffect(() => {
    if (!selected || !query.trim()) return;
    let active = true;
    const timer = setTimeout(() => {
      void getDatabase()
        .then((db) => new ObjectivesRepository(db).candidates(query, selected))
        .then((rows) => {
          if (active) setCandidates(rows);
        })
        .catch(() => {
          if (active) setError('Não foi possível buscar vínculos.');
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selected, query]);
  async function mutate(action: (repo: ObjectivesRepository) => Promise<unknown>, id = selected) {
    setBusy(true);
    setError('');
    try {
      await action(new ObjectivesRepository(await getDatabase()));
      await refresh(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  function startNew() {
    setSelected(null);
    setDraft(emptyObjectiveDraft());
    setEditing(true);
    setError('');
  }
  function startEdit(row: Objective) {
    setDraft({
      name: row.name,
      description: row.description,
      category: row.category,
      start_date: row.start_date,
      target_date: row.target_date,
      progress_mode: row.progress_mode,
      progress_ref: row.progress_ref,
      manual_current: row.manual_current,
      manual_target: row.manual_target,
      manual_unit: row.manual_unit,
      body_baseline: row.body_baseline,
      body_target: row.body_target,
    });
    setEditing(true);
  }
  async function save() {
    if (!draft) return;
    const repo = new ObjectivesRepository(await getDatabase());
    setBusy(true);
    setError('');
    try {
      const id = selected
        ? (await repo.update(selected, draft), selected)
        : await repo.create(draft);
      setEditing(false);
      setDraft(null);
      setSelected(id);
      await refresh(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  const fields = (key: keyof ObjectiveDraft, value: ObjectiveDraft[keyof ObjectiveDraft]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  return (
    <div className="objectives-page">
      {!selected && !editing && (
        <header className="page-header header-with-action module-header">
          <div className="module-heading">
            <span className="module-heading-icon objective-heading-icon" aria-hidden="true">
              <Target size={22} />
            </span>
            <div>
              <h1>Objetivos</h1>
              <p>Grandes conquistas começam com passos consistentes.</p>
            </div>
          </div>
          <button className="primary-button" onClick={startNew}>
            <Plus size={17} /> Novo objetivo
          </button>
        </header>
      )}
      {error && <p role="alert">{error}</p>}
      {editing && draft ? (
        <section className="review-section objective-editor">
          <h2>{selected ? 'Editar objetivo' : 'Novo objetivo'}</h2>
          <label htmlFor="objective-name">Nome</label>
          <input
            id="objective-name"
            value={draft.name}
            maxLength={160}
            onChange={(e) => fields('name', e.target.value)}
            autoFocus
          />
          <label htmlFor="objective-description">Descrição opcional</label>
          <textarea
            id="objective-description"
            value={draft.description}
            onChange={(e) => fields('description', e.target.value)}
            rows={3}
          />
          <div className="objective-fields">
            <div>
              <label htmlFor="objective-category">Categoria</label>
              <select
                id="objective-category"
                value={draft.category}
                onChange={(e) => fields('category', e.target.value as ObjectiveDraft['category'])}
              >
                {objectiveCategories.map((c) => (
                  <option key={c} value={c}>
                    {categories[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="objective-start">Desde</label>
              <input
                id="objective-start"
                type="date"
                value={draft.start_date}
                onChange={(e) => fields('start_date', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="objective-target">Prazo opcional</label>
              <input
                id="objective-target"
                type="date"
                value={draft.target_date ?? ''}
                onChange={(e) => fields('target_date', e.target.value || null)}
              />
            </div>
          </div>
          <label htmlFor="objective-progress-mode">Indicador de progresso</label>
          <select
            id="objective-progress-mode"
            value={draft.progress_mode}
            onChange={(e) =>
              fields('progress_mode', e.target.value as ObjectiveDraft['progress_mode'])
            }
          >
            <option value="none">Sem número</option>
            <option value="manual">Manual</option>
            <option value="project">Projeto existente</option>
            <option value="financial_goal">Meta financeira existente</option>
            <option value="body_metric">Medida corporal</option>
          </select>
          {draft.progress_mode === 'manual' && (
            <div className="objective-fields">
              <div>
                <label htmlFor="objective-current">Atual</label>
                <input
                  id="objective-current"
                  type="number"
                  min="0"
                  value={draft.manual_current ?? ''}
                  onChange={(e) =>
                    fields('manual_current', e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </div>
              <div>
                <label htmlFor="objective-goal">Meta</label>
                <input
                  id="objective-goal"
                  type="number"
                  min="0.01"
                  value={draft.manual_target ?? ''}
                  onChange={(e) =>
                    fields('manual_target', e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </div>
              <div>
                <label htmlFor="objective-unit">Unidade</label>
                <input
                  id="objective-unit"
                  value={draft.manual_unit}
                  onChange={(e) => fields('manual_unit', e.target.value)}
                />
              </div>
            </div>
          )}
          {(draft.progress_mode === 'project' || draft.progress_mode === 'financial_goal') && (
            <>
              <label htmlFor="objective-progress-source">ID da fonte vinculada</label>
              <select
                id="objective-progress-source"
                value={draft.progress_ref ?? ''}
                onChange={(e) => fields('progress_ref', e.target.value || null)}
              >
                <option value="">Selecione um vínculo abaixo</option>
                {links
                  .filter(
                    (l) =>
                      l.entity_type ===
                      (draft.progress_mode === 'project' ? 'project' : 'financial_goal'),
                  )
                  .map((l) => (
                    <option key={l.id} value={l.entity_id}>
                      {l.name}
                    </option>
                  ))}
              </select>
              <p className="field-help">
                Vincule um projeto ou meta financeira antes de escolhê-lo como indicador.
              </p>
            </>
          )}
          {draft.progress_mode === 'body_metric' && (
            <div className="objective-fields">
              <div>
                <label htmlFor="objective-body-key">Medida</label>
                <select
                  id="objective-body-key"
                  value={draft.progress_ref ?? ''}
                  onChange={(e) => fields('progress_ref', e.target.value)}
                >
                  <option value="">Selecione</option>
                  <option value="weight">Peso</option>
                  <option value="waist">Cintura</option>
                  <option value="body_fat">Gordura corporal</option>
                  <option value="chest">Peito</option>
                  <option value="hips">Quadril</option>
                </select>
              </div>
              <div>
                <label htmlFor="objective-baseline">Referência inicial</label>
                <input
                  id="objective-baseline"
                  type="number"
                  step="0.1"
                  value={draft.body_baseline ?? ''}
                  onChange={(e) =>
                    fields('body_baseline', e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </div>
              <div>
                <label htmlFor="objective-body-target">Meta opcional</label>
                <input
                  id="objective-body-target"
                  type="number"
                  step="0.1"
                  value={draft.body_target ?? ''}
                  onChange={(e) =>
                    fields('body_target', e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </div>
            </div>
          )}
          <div className="form-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setEditing(false);
                setDraft(null);
              }}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              className="primary-button"
              onClick={() => void save()}
              disabled={busy || !draft.name.trim()}
            >
              Salvar objetivo
            </button>
          </div>
        </section>
      ) : selected && current ? (
        <>
          <button className="text-button objective-back" onClick={() => setSelected(null)}>
            <ArrowLeft size={16} /> Todos os objetivos
          </button>
          <ObjectiveDetailOverview
            objective={current}
            category={categories[current.category]}
            status={statuses[current.status]}
            progress={progress}
            focusSeconds={focusSeconds}
            actions={
              <>
                <button className="secondary-button" onClick={() => startEdit(current)}>
                  Editar
                </button>
                <button className="secondary-button" onClick={() => onTimeline(current.id)}>
                  Ver Timeline <ArrowRight size={15} />
                </button>
                <select
                  aria-label="Status do objetivo"
                  value={current.status}
                  onChange={(e) =>
                    void mutate((repo) =>
                      repo.status(current.id, e.target.value as Objective['status']),
                    )
                  }
                >
                  {Object.entries(statuses).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </>
            }
          />
          <Milestones objectiveId={current.id} onChanged={() => void refresh(current.id)} />
          <section className="review-section objective-related">
            <h2>Relacionados</h2>
            {links.length === 0 ? (
              <p>Nenhum item vinculado.</p>
            ) : (
              Object.entries(linkLabels).map(([type, label]) => {
                const group = links.filter((l) => l.entity_type === type);
                return group.length ? (
                  <div key={type}>
                    <h3>{label}</h3>
                    {group.map((l) => (
                      <div className="objective-link" key={l.id}>
                        <button
                          onClick={() => {
                            const target: Record<string, Page> = {
                              task: 'tasks',
                              project: 'projects',
                              habit: 'habits',
                              routine: 'routines',
                              workout_plan: 'workouts',
                              financial_goal: 'finance',
                              thought: 'thoughts',
                              body_metric: 'workouts',
                              activity: 'workouts',
                              nutrition: 'nutrition',
                            };
                            onNavigate(target[l.entity_type], l.entity_id, l.entity_type);
                          }}
                        >
                          {l.name}
                          <ArrowRight size={14} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Remover vínculo com ${l.name}`}
                          onClick={() => void mutate((repo) => repo.unlink(l.id, current.id))}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null;
              })
            )}
            <div className="objective-link-picker">
              <label htmlFor="objective-link-search">Vincular item existente</label>
              <input
                id="objective-link-search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCandidates([]);
                }}
                placeholder="Buscar tarefa, projeto, hábito…"
              />
              {candidates.map((c) => (
                <button
                  className="review-line"
                  key={`${c.entity_type}:${c.entity_id}`}
                  onClick={() =>
                    void mutate(async (repo) => {
                      await repo.link(current.id, c.entity_type, c.entity_id);
                      setQuery('');
                    })
                  }
                >
                  <Link2 size={15} />
                  {c.name} · {linkLabels[c.entity_type]}
                </button>
              ))}
              <div className="review-actions">
                {(['body_metric', 'activity', 'nutrition'] as const).map((type) => (
                  <button
                    key={type}
                    className="secondary-button"
                    onClick={() =>
                      void mutate((repo) =>
                        repo.link(
                          current.id,
                          type,
                          type === 'body_metric'
                            ? 'weight'
                            : type === 'activity'
                              ? 'steps'
                              : 'diary',
                        ),
                      )
                    }
                  >
                    {type === 'body_metric'
                      ? 'Vincular peso'
                      : type === 'activity'
                        ? 'Vincular passos'
                        : 'Vincular diário'}
                  </button>
                ))}
              </div>
            </div>
            <div className="objective-fields">
              <div>
                <label htmlFor="objective-new-type">Criar e vincular</label>
                <select
                  id="objective-new-type"
                  value={newEntityType}
                  onChange={(e) => setNewEntityType(e.target.value as typeof newEntityType)}
                >
                  <option value="task">Tarefa</option>
                  <option value="project">Projeto</option>
                  <option value="habit">Hábito diário</option>
                </select>
              </div>
              <div>
                <label htmlFor="objective-new-title">Nome</label>
                <input
                  id="objective-new-title"
                  value={newEntity}
                  onChange={(e) => setNewEntity(e.target.value)}
                />
              </div>
              <button
                className="secondary-button"
                disabled={busy || !newEntity.trim()}
                onClick={() =>
                  void mutate(async (repo) => {
                    await repo.createLinked(current.id, newEntityType, newEntity);
                    setNewEntity('');
                  })
                }
              >
                <Plus size={15} /> Criar
              </button>
            </div>
          </section>
          <Attachments entityType="objective" entityId={current.id} />
          <section className="review-section objective-updates">
            <h2>Atualizações</h2>
            <label htmlFor="objective-update">Nota curta opcional</label>
            <textarea
              id="objective-update"
              rows={3}
              value={updateText}
              onChange={(e) => setUpdateText(e.target.value)}
              maxLength={2000}
            />
            <button
              className="secondary-button"
              disabled={busy || !updateText.trim()}
              onClick={() =>
                void mutate(async (repo) => {
                  await repo.addUpdate(current.id, updateText);
                  setUpdateText('');
                })
              }
            >
              Adicionar atualização
            </button>
            {updates.map((u) => (
              <p className="review-detail" key={u.id}>
                <time>{u.created_at.slice(0, 10).split('-').reverse().join('/')}</time> ·{' '}
                {u.content}
              </p>
            ))}
          </section>
        </>
      ) : (
        <>
          <nav className="tabs objective-category-tabs" aria-label="Categorias dos objetivos">
            <button
              aria-current={categoryFilter === 'all' ? 'page' : undefined}
              onClick={() => {
                rememberedObjectiveCategory = 'all';
                setCategoryFilter('all');
              }}
            >
              Todos <span>{rows.length}</span>
            </button>
            {objectiveCategories.map((category) => {
              const count = rows.filter((row) => row.category === category).length;
              return count ? (
                <button
                  key={category}
                  aria-current={categoryFilter === category ? 'page' : undefined}
                  onClick={() => {
                    rememberedObjectiveCategory = category;
                    setCategoryFilter(category);
                  }}
                >
                  {categories[category]} <span>{count}</span>
                </button>
              ) : null;
            })}
          </nav>
          {rows.length === 0 ? (
            <section className="empty-state">
              <h2>Nenhum objetivo ainda.</h2>
              <p>
                Conecte projetos, hábitos e outras partes do RUMAR ao que você quer construir ou
                alcançar.
              </p>
              <button className="primary-button" onClick={startNew}>
                Criar objetivo
              </button>
            </section>
          ) : visibleObjectives.length ? (
            <div className="objective-list">
              {visibleObjectives.map((row) => (
                <ObjectiveCard
                  key={row.id}
                  objective={row}
                  category={categories[row.category]}
                  progress={listProgress[row.id]}
                  milestones={milestoneCounts[row.id]}
                  onOpen={() => setSelected(row.id)}
                />
              ))}
            </div>
          ) : (
            <section className="empty-state">
              <h2>Nenhum objetivo nesta categoria.</h2>
              <p>Escolha outra categoria para ver seus objetivos.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
