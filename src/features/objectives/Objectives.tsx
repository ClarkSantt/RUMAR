import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Link2, Plus, ShoppingBag, Target, Trash2, X } from 'lucide-react';
import type { RumoStore } from '../../hooks/useRumo';
import { getDatabase } from '../../lib/database/connection';
import { FocusRepository } from '../calendar/planner-repository';
import { Attachments } from '../attachments/Attachments';
import { Milestones } from './Milestones';
import { ObjectiveCard } from './ObjectiveCard';
import { ObjectiveDetailOverview } from './ObjectiveDetailOverview';
import { VersionHistory } from '../versions/VersionHistory';
import {
  ObjectivesRepository,
  emptyObjectiveDraft,
  emptyWishDraft,
  objectiveHorizons,
  progressStrategies,
  objectiveCategories,
  type Objective,
  type ObjectiveDraft,
  type ObjectiveLink,
  type ObjectiveLinkType,
  type ObjectiveProgress,
  type ObjectiveCategory,
  type ObjectiveUpdate,
  type WishDetails,
  type WishDraft,
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
  cancelled: 'Cancelado',
  archived: 'Arquivado',
};
const horizonLabels = {
  long_term: 'Longo prazo',
  year: 'Ano',
  quarter: 'Trimestre',
  month: 'Mês',
  week: 'Semana',
  none: 'Sem prazo',
} as const;
const progressLabels = {
  none: 'Sem indicador',
  manual: 'Percentual manual',
  tasks: 'Tasks vinculadas',
  projects: 'Projects vinculados',
  habits: 'Hábitos vinculados',
  numeric: 'Meta numérica',
  financial_goal: 'Meta financeira vinculada',
} as const;
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
  const [counts, wishes] = await Promise.all([repo.milestoneCounts(), repo.wishes()]);
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
    wishes: Object.fromEntries(wishes.map((wish) => [wish.objective_id, wish])) as Record<
      string,
      WishDetails
    >,
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
  store,
}: {
  initialId?: string;
  onNavigate: (page: Page, id?: string, type?: string) => void;
  onTimeline: (id: string) => void;
  store: RumoStore;
}) {
  const [rows, setRows] = useState<(Objective & { link_count: number })[]>([]);
  const [listProgress, setListProgress] = useState<Record<string, ObjectiveProgress | null>>({});
  const [wishRows, setWishRows] = useState<Record<string, WishDetails>>({});
  const [milestoneCounts, setMilestoneCounts] = useState<
    Record<string, { total: number; completed: number }>
  >({});
  const [categoryFilter, setCategoryFilter] = useState<ObjectiveCategory | 'all'>(
    rememberedObjectiveCategory,
  );
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [draft, setDraft] = useState<ObjectiveDraft | null>(null);
  const [wishDraft, setWishDraft] = useState<WishDraft>(emptyWishDraft());
  const [wish, setWish] = useState<WishDetails | null>(null);
  const [financeGoals, setFinanceGoals] = useState<{ id: string; name: string }[]>([]);
  const [transactions, setTransactions] = useState<{ id: string; name: string }[]>([]);
  const [overviewFilter, setOverviewFilter] = useState<'active' | 'wishes' | 'completed' | 'all'>(
    'active',
  );
  const [horizonFilter, setHorizonFilter] = useState<Objective['horizon'] | 'all'>('all');
  const [wishStatusFilter, setWishStatusFilter] = useState<WishDetails['effective_status'] | 'all'>(
    'all',
  );
  const [wishSort, setWishSort] = useState<'priority' | 'closest' | 'expensive' | 'recent'>(
    'priority',
  );
  const [updateLinkedGoal, setUpdateLinkedGoal] = useState(false);
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
  const visibleObjectives = objectivesForCategory(rows, categoryFilter)
    .filter((row) => horizonFilter === 'all' || row.horizon === horizonFilter)
    .filter((row) => {
      if (overviewFilter === 'wishes') {
        const wishRow = wishRows[row.id];
        return (
          row.objective_kind === 'wish' &&
          row.lifecycle_status !== 'archived' &&
          (wishStatusFilter === 'all' || wishRow?.effective_status === wishStatusFilter)
        );
      }
      if (overviewFilter === 'completed') return row.lifecycle_status === 'completed';
      if (overviewFilter === 'active')
        return (
          row.objective_kind === 'objective' && ['active', 'paused'].includes(row.lifecycle_status)
        );
      return true;
    })
    .sort((left, right) => {
      if (overviewFilter !== 'wishes') return 0;
      const a = wishRows[left.id];
      const b = wishRows[right.id];
      if (!a || !b) return 0;
      if (wishSort === 'closest')
        return (listProgress[right.id]?.percent ?? -1) - (listProgress[left.id]?.percent ?? -1);
      if (wishSort === 'expensive') return b.target_price_cents - a.target_price_cents;
      if (wishSort === 'recent') return b.created_at.localeCompare(a.created_at);
      return (
        ({ high: 0, normal: 1, low: 2 }[a.priority] ?? 3) -
        ({ high: 0, normal: 1, low: 2 }[b.priority] ?? 3)
      );
    });

  async function refresh(id = selected) {
    const repo = new ObjectivesRepository(await getDatabase());
    const { list, indicators, milestones, wishes } = await loadOverview(repo);
    setRows(list);
    setListProgress(indicators);
    setMilestoneCounts(milestones);
    setWishRows(wishes);
    if (id) {
      const found = list.find((row) => row.id === id);
      if (found) {
        const [relations, notes, indicator, focused, wishRow] = await Promise.all([
          repo.links(id),
          repo.updates(id),
          repo.progress(found),
          new FocusRepository(await getDatabase()).objectiveSeconds(id),
          repo.wish(id),
        ]);
        setLinks(relations);
        setUpdates(notes);
        setProgress(indicator);
        setFocusSeconds(focused);
        setWish(wishRow);
      } else setSelected(null);
    }
  }
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => loadOverview(new ObjectivesRepository(db)))
      .then(({ list, indicators, milestones, wishes }) => {
        if (active) {
          setRows(list);
          setListProgress(indicators);
          setMilestoneCounts(milestones);
          setWishRows(wishes);
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
        const [relations, notes, indicator, focused, wishRow] = await Promise.all([
          repo.links(selected),
          repo.updates(selected),
          repo.progress(found),
          new FocusRepository(db).objectiveSeconds(selected),
          repo.wish(selected),
        ]);
        return { relations, notes, indicator, focused, wishRow };
      })
      .then((result) => {
        if (active && result) {
          setLinks(result.relations);
          setUpdates(result.notes);
          setProgress(result.indicator);
          setFocusSeconds(result.focused);
          setWish(result.wishRow);
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
    void getDatabase()
      .then(async (db) => {
        const repo = new ObjectivesRepository(db);
        const [goals, recentTransactions] = await Promise.all([
          repo.financeGoals(),
          repo.financeTransactions(),
        ]);
        setFinanceGoals(goals);
        setTransactions(recentTransactions);
      })
      .catch(() => setError('Não foi possível carregar opções financeiras.'));
  }, []);
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
  async function trashCurrent() {
    if (!current) return;
    const id = current.id;
    const repo = new ObjectivesRepository(await getDatabase());
    setBusy(true);
    setError('');
    try {
      await repo.trash(id);
      setSelected(null);
      await refresh(null);
      await store.retry();
      store.setNotice({
        message: `${current.objective_kind === 'wish' ? 'Desejo' : 'Objetivo'} movido para a Lixeira.`,
        undo: async () => {
          await new ObjectivesRepository(await getDatabase()).trash(id, false);
          await store.retry();
          return true;
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível mover para a Lixeira.');
    } finally {
      setBusy(false);
    }
  }
  function startNew(kind: 'objective' | 'wish' = 'objective') {
    setSelected(null);
    setDraft({ ...emptyObjectiveDraft(), objective_kind: kind });
    setWishDraft(emptyWishDraft());
    setUpdateLinkedGoal(false);
    setEditing(true);
    setError('');
  }
  useEffect(() => {
    const open = (event: Event) =>
      startNew((event as CustomEvent<'objective' | 'wish'>).detail ?? 'objective');
    window.addEventListener('rumar-new-objective', open);
    return () => window.removeEventListener('rumar-new-objective', open);
  }, []);
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
      objective_kind: row.objective_kind,
      horizon: row.horizon,
      horizon_label: row.horizon_label,
      progress_strategy: row.progress_strategy,
      progress_direction: row.progress_direction,
      numeric_start: row.numeric_start,
      numeric_current: row.numeric_current,
      numeric_target: row.numeric_target,
      numeric_unit: row.numeric_unit,
      next_step: row.next_step,
    });
    setWishDraft(
      wish
        ? {
            product_url: wish.product_url,
            current_price_cents: wish.current_price_cents,
            target_price_cents: wish.target_price_cents,
            original_price_cents: wish.original_price_cents,
            currency: wish.currency,
            priority: wish.priority,
            desired_date: wish.desired_date,
            category: wish.category,
            notes: wish.notes,
            status: wish.status,
            finance_goal_id: wish.finance_goal_id,
            purchase_transaction_id: wish.purchase_transaction_id,
          }
        : emptyWishDraft(),
    );
    setUpdateLinkedGoal(false);
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
      if (draft.objective_kind === 'wish') {
        await repo.saveWish(id, wishDraft);
        if (updateLinkedGoal && wishDraft.finance_goal_id)
          await repo.updateFinanceGoalTarget(
            wishDraft.finance_goal_id,
            wishDraft.target_price_cents,
          );
        await repo.setFinancialGoalLink(id, wishDraft.finance_goal_id);
      } else {
        await repo.setFinancialGoalLink(
          id,
          draft.progress_strategy === 'financial_goal' ? draft.progress_ref : null,
        );
      }
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
  const wishFields = (key: keyof WishDraft, value: WishDraft[keyof WishDraft]) =>
    setWishDraft((current) => ({ ...current, [key]: value }));
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
          <div className="review-actions">
            <button className="secondary-button" onClick={() => startNew('wish')}>
              <ShoppingBag size={17} /> Novo desejo
            </button>
            <button className="primary-button" onClick={() => startNew('objective')}>
              <Plus size={17} /> Novo objetivo
            </button>
          </div>
        </header>
      )}
      {error && <p role="alert">{error}</p>}
      {editing && draft ? (
        <section className="review-section objective-editor">
          <h2>
            {selected ? 'Editar' : 'Novo'} {draft.objective_kind === 'wish' ? 'desejo' : 'objetivo'}
          </h2>
          <div className="objective-fields">
            <div>
              <label htmlFor="objective-kind">Tipo</label>
              <select
                id="objective-kind"
                value={draft.objective_kind}
                onChange={(e) =>
                  fields('objective_kind', e.target.value as ObjectiveDraft['objective_kind'])
                }
              >
                <option value="objective">Objetivo</option>
                <option value="wish">Desejo / compra</option>
              </select>
            </div>
            <div>
              <label htmlFor="objective-horizon">Horizonte</label>
              <select
                id="objective-horizon"
                value={draft.horizon}
                onChange={(e) => fields('horizon', e.target.value as ObjectiveDraft['horizon'])}
              >
                {objectiveHorizons.map((horizon) => (
                  <option key={horizon} value={horizon}>
                    {horizonLabels[horizon]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="objective-horizon-label">Período</label>
              <input
                id="objective-horizon-label"
                value={draft.horizon_label}
                maxLength={80}
                placeholder="Ex.: Q1 2027"
                onChange={(e) => fields('horizon_label', e.target.value)}
              />
            </div>
          </div>
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
          {draft.objective_kind === 'objective' ? (
            <>
              <label htmlFor="objective-progress-strategy">Como medir o progresso</label>
              <select
                id="objective-progress-strategy"
                value={draft.progress_strategy}
                onChange={(e) =>
                  fields('progress_strategy', e.target.value as ObjectiveDraft['progress_strategy'])
                }
              >
                {progressStrategies.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {progressLabels[strategy]}
                  </option>
                ))}
              </select>
              {draft.progress_strategy === 'manual' && (
                <div>
                  <label htmlFor="objective-manual-percent">Progresso atual (%)</label>
                  <input
                    id="objective-manual-percent"
                    type="number"
                    min="0"
                    max="100"
                    value={draft.numeric_current ?? ''}
                    onChange={(e) =>
                      fields(
                        'numeric_current',
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                  />
                </div>
              )}
              {draft.progress_strategy === 'numeric' && (
                <div className="objective-fields">
                  <div>
                    <label htmlFor="objective-numeric-start">Início</label>
                    <input
                      id="objective-numeric-start"
                      type="number"
                      step="any"
                      value={draft.numeric_start ?? ''}
                      onChange={(e) =>
                        fields(
                          'numeric_start',
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="objective-numeric-current">Atual</label>
                    <input
                      id="objective-numeric-current"
                      type="number"
                      step="any"
                      value={draft.numeric_current ?? ''}
                      onChange={(e) =>
                        fields(
                          'numeric_current',
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="objective-numeric-target">Meta</label>
                    <input
                      id="objective-numeric-target"
                      type="number"
                      step="any"
                      value={draft.numeric_target ?? ''}
                      onChange={(e) =>
                        fields(
                          'numeric_target',
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="objective-numeric-unit">Unidade</label>
                    <input
                      id="objective-numeric-unit"
                      value={draft.numeric_unit}
                      onChange={(e) => fields('numeric_unit', e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="objective-direction">Direção</label>
                    <select
                      id="objective-direction"
                      value={draft.progress_direction}
                      onChange={(e) =>
                        fields(
                          'progress_direction',
                          e.target.value as ObjectiveDraft['progress_direction'],
                        )
                      }
                    >
                      <option value="increase">Aumentar</option>
                      <option value="decrease">Reduzir</option>
                    </select>
                  </div>
                </div>
              )}
              {draft.progress_strategy === 'financial_goal' && (
                <div>
                  <label htmlFor="objective-finance-goal">Meta financeira</label>
                  <select
                    id="objective-finance-goal"
                    value={draft.progress_ref ?? ''}
                    onChange={(e) => fields('progress_ref', e.target.value || null)}
                  >
                    <option value="">Selecione</option>
                    {financeGoals.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label htmlFor="objective-next-step">Próximo passo</label>
              <input
                id="objective-next-step"
                value={draft.next_step}
                maxLength={500}
                placeholder="A ação mais útil agora"
                onChange={(e) => fields('next_step', e.target.value)}
              />
            </>
          ) : (
            <div className="wish-fields">
              <div className="objective-fields">
                <div>
                  <label htmlFor="wish-target-price">Preço-alvo</label>
                  <input
                    id="wish-target-price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={wishDraft.target_price_cents ? wishDraft.target_price_cents / 100 : ''}
                    onChange={(e) =>
                      wishFields(
                        'target_price_cents',
                        Math.round(Number(e.target.value || 0) * 100),
                      )
                    }
                  />
                </div>
                <div>
                  <label htmlFor="wish-current-price">Preço atual</label>
                  <input
                    id="wish-current-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      wishDraft.current_price_cents === null
                        ? ''
                        : wishDraft.current_price_cents / 100
                    }
                    onChange={(e) =>
                      wishFields(
                        'current_price_cents',
                        e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                      )
                    }
                  />
                </div>
                <div>
                  <label htmlFor="wish-original-price">Preço observado inicialmente</label>
                  <input
                    id="wish-original-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      wishDraft.original_price_cents === null
                        ? ''
                        : wishDraft.original_price_cents / 100
                    }
                    onChange={(e) =>
                      wishFields(
                        'original_price_cents',
                        e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                      )
                    }
                  />
                </div>
                <div>
                  <label htmlFor="wish-currency">Moeda</label>
                  <select
                    id="wish-currency"
                    value={wishDraft.currency}
                    onChange={(e) => wishFields('currency', e.target.value)}
                  >
                    <option value="BRL">BRL</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="wish-priority">Prioridade</label>
                  <select
                    id="wish-priority"
                    value={wishDraft.priority}
                    onChange={(e) =>
                      wishFields('priority', e.target.value as WishDraft['priority'])
                    }
                  >
                    <option value="low">Baixa</option>
                    <option value="normal">Normal</option>
                    <option value="high">Alta</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="wish-date">Data desejada</label>
                  <input
                    id="wish-date"
                    type="date"
                    value={wishDraft.desired_date ?? ''}
                    onChange={(e) => wishFields('desired_date', e.target.value || null)}
                  />
                </div>
              </div>
              <label htmlFor="wish-url">Link do produto</label>
              <input
                id="wish-url"
                type="url"
                value={wishDraft.product_url}
                placeholder="https://"
                onChange={(e) => wishFields('product_url', e.target.value)}
              />
              <div className="objective-fields">
                <div>
                  <label htmlFor="wish-category">Categoria</label>
                  <input
                    id="wish-category"
                    value={wishDraft.category}
                    onChange={(e) => wishFields('category', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="wish-goal">Meta financeira vinculada</label>
                  <select
                    id="wish-goal"
                    value={wishDraft.finance_goal_id ?? ''}
                    onChange={(e) => wishFields('finance_goal_id', e.target.value || null)}
                  >
                    <option value="">Sem meta financeira</option>
                    {financeGoals.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="wish-status">Status</label>
                  <select
                    id="wish-status"
                    value={wishDraft.status}
                    onChange={(e) => wishFields('status', e.target.value as WishDraft['status'])}
                  >
                    <option value="wanted">Desejado</option>
                    <option value="saving">Guardando</option>
                    <option value="purchased">Comprado</option>
                    <option value="abandoned">Abandonado</option>
                    <option value="archived">Arquivado</option>
                  </select>
                </div>
              </div>
              {wishDraft.finance_goal_id && (
                <label className="checkbox-row" htmlFor="wish-update-finance-goal">
                  <input
                    id="wish-update-finance-goal"
                    type="checkbox"
                    checked={updateLinkedGoal}
                    onChange={(event) => setUpdateLinkedGoal(event.target.checked)}
                  />
                  Atualizar explicitamente a meta financeira para o preço-alvo deste desejo
                </label>
              )}
              <label htmlFor="wish-transaction">Transação da compra (opcional)</label>
              <select
                id="wish-transaction"
                value={wishDraft.purchase_transaction_id ?? ''}
                onChange={(e) => wishFields('purchase_transaction_id', e.target.value || null)}
              >
                <option value="">Nenhuma</option>
                {transactions.map((transaction) => (
                  <option key={transaction.id} value={transaction.id}>
                    {transaction.name}
                  </option>
                ))}
              </select>
              <label htmlFor="wish-notes">Notas</label>
              <textarea
                id="wish-notes"
                rows={3}
                value={wishDraft.notes}
                onChange={(e) => wishFields('notes', e.target.value)}
              />
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
              Salvar {draft.objective_kind === 'wish' ? 'desejo' : 'objetivo'}
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
            status={statuses[current.lifecycle_status]}
            progress={progress}
            focusSeconds={focusSeconds}
            actions={
              <>
                <button className="secondary-button" onClick={() => startEdit(current)}>
                  Editar
                </button>
                <VersionHistory
                  type="objective"
                  entityId={current.id}
                  onRestored={() => refresh(current.id)}
                />
                <button className="secondary-button" onClick={() => onTimeline(current.id)}>
                  Ver Timeline <ArrowRight size={15} />
                </button>
                <select
                  aria-label="Status do objetivo"
                  value={current.lifecycle_status}
                  onChange={(e) =>
                    void mutate((repo) =>
                      repo.status(current.id, e.target.value as Objective['lifecycle_status']),
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
          {current.next_step && (
            <section className="review-section">
              <h2>Próximo passo</h2>
              <p>{current.next_step}</p>
            </section>
          )}
          {current.objective_kind === 'wish' && wish && (
            <section className="review-section wish-detail">
              <h2>Compra desejada</h2>
              <div className="objective-fields">
                <p>
                  <strong>Status</strong>
                  <br />
                  {wish.effective_status === 'ready'
                    ? 'Pronto para comprar'
                    : wish.effective_status}
                </p>
                <p>
                  <strong>Preço-alvo</strong>
                  <br />
                  {progress?.hidden
                    ? '••••'
                    : (wish.target_price_cents / 100).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: wish.currency,
                      })}
                </p>
                <p>
                  <strong>Guardado</strong>
                  <br />
                  {progress?.hidden
                    ? '••••'
                    : ((wish.saved_cents ?? 0) / 100).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: wish.currency,
                      })}
                </p>
                <p>
                  <strong>Falta</strong>
                  <br />
                  {progress?.hidden
                    ? '••••'
                    : (
                        Math.max(0, wish.target_price_cents - (wish.saved_cents ?? 0)) / 100
                      ).toLocaleString('pt-BR', { style: 'currency', currency: wish.currency })}
                </p>
              </div>
              {wish.product_url && (
                <a href={wish.product_url} target="_blank" rel="noreferrer">
                  Abrir link do produto
                </a>
              )}
              {wish.notes && <p>{wish.notes}</p>}
            </section>
          )}
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
          <Attachments
            entityType="objective"
            entityId={current.id}
            imagesOnly={current.objective_kind === 'wish'}
            title={current.objective_kind === 'wish' ? 'Foto do produto' : undefined}
            maxFiles={current.objective_kind === 'wish' ? 1 : undefined}
          />
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
          <section className="review-section danger-zone">
            <h2>Lixeira</h2>
            <p>Remover preserva o item até a exclusão permanente em Configurações.</p>
            <button
              className="secondary-button danger"
              disabled={busy}
              onClick={() => void trashCurrent()}
            >
              <Trash2 size={15} /> Mover para a Lixeira
            </button>
          </section>
        </>
      ) : (
        <>
          <nav className="tabs objective-category-tabs" aria-label="Visões de objetivos">
            {(
              [
                ['active', 'Ativos'],
                ['wishes', 'Desejos'],
                ['completed', 'Concluídos'],
                ['all', 'Todos'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                aria-current={overviewFilter === key ? 'page' : undefined}
                onClick={() => setOverviewFilter(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="objective-list-controls">
            <label htmlFor="objective-horizon-filter">Horizonte</label>
            <select
              id="objective-horizon-filter"
              value={horizonFilter}
              onChange={(event) =>
                setHorizonFilter(event.target.value as Objective['horizon'] | 'all')
              }
            >
              <option value="all">Todos</option>
              {objectiveHorizons.map((horizon) => (
                <option key={horizon} value={horizon}>
                  {horizonLabels[horizon]}
                </option>
              ))}
            </select>
            {overviewFilter === 'wishes' && (
              <>
                <label htmlFor="wish-status-filter">Status</label>
                <select
                  id="wish-status-filter"
                  value={wishStatusFilter}
                  onChange={(event) =>
                    setWishStatusFilter(
                      event.target.value as WishDetails['effective_status'] | 'all',
                    )
                  }
                >
                  <option value="all">Todos</option>
                  <option value="wanted">Desejado</option>
                  <option value="saving">Guardando</option>
                  <option value="ready">Pronto para comprar</option>
                  <option value="purchased">Comprado</option>
                  <option value="abandoned">Abandonado</option>
                </select>
                <label htmlFor="wish-sort">Ordenar</label>
                <select
                  id="wish-sort"
                  value={wishSort}
                  onChange={(event) => setWishSort(event.target.value as typeof wishSort)}
                >
                  <option value="priority">Prioridade</option>
                  <option value="closest">Mais próximo de atingir</option>
                  <option value="expensive">Mais caro</option>
                  <option value="recent">Mais recente</option>
                </select>
              </>
            )}
          </div>
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
              <button className="primary-button" onClick={() => startNew('objective')}>
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
