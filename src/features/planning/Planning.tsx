import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  Copy,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { getDatabase } from '../../lib/database/connection';
import { addDays, localDate } from '../../lib/dates';
import { Habits } from '../habits/Habits';
import {
  periodLabels,
  planningTimeLabel,
  type DayPeriod,
  type PlanningDraft,
  type PlanningItem,
  type PlanningSchedule,
  type PlanningSourceOption,
} from './domain';
import { PlanningRepository, type PlanningTemplate, type PlanningTemplateItem } from './repository';
import './planning.css';

type Tab = 'plan' | 'today' | 'habits' | 'models';
const repository = async () => new PlanningRepository(await getDatabase());
const emptyDraft = (date: string): PlanningDraft => ({
  date,
  title: '',
  notes: '',
  schedule: 'flexible',
  startTime: '09:00',
  endTime: '09:30',
  dayPeriod: null,
  sourceType: 'standalone',
  sourceId: null,
});

export function Planning({ initialTab = 'plan' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [day, setDay] = useState(localDate());
  const [items, setItems] = useState<PlanningItem[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ draft: PlanningDraft; id?: string } | null>(null);
  useEffect(() => {
    let current = true;
    void repository()
      .then((repo) => repo.list(day, day))
      .then((next) => {
        if (current) {
          setItems(next);
          setError('');
        }
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      });
    return () => {
      current = false;
    };
  }, [day, revision]);
  async function act(action: (repo: PlanningRepository) => Promise<unknown>) {
    try {
      await action(await repository());
      setRevision((value) => value + 1);
      setError('');
    } catch (reason) {
      setError(String(reason));
    }
  }
  function edit(item: PlanningItem) {
    setEditor({
      id: item.id,
      draft: {
        date: item.block_date,
        title: item.display_title,
        notes: item.notes,
        schedule: item.schedule_kind,
        startTime: item.start_time,
        endTime: item.end_time,
        dayPeriod: item.day_period,
        sourceType: item.source_type,
        sourceId: item.source_id,
      },
    });
  }
  return (
    <section className="planning-page">
      <header className="page-header planning-header">
        <div>
          <h1>Planejamento</h1>
          <p>Organize o tempo sem alterar a conclusão de tarefas e projetos.</p>
        </div>
        <button className="primary-button" onClick={() => setEditor({ draft: emptyDraft(day) })}>
          <Plus size={17} /> Novo item
        </button>
      </header>
      <nav className="tabs planning-tabs" aria-label="Áreas de planejamento">
        {(
          [
            ['plan', 'Planejar'],
            ['today', 'Hoje'],
            ['habits', 'Hábitos'],
            ['models', 'Modelos'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {tab === 'habits' ? (
        <Habits embedded />
      ) : tab === 'models' ? (
        <Models
          day={day}
          onApplied={() => {
            setTab('plan');
            setRevision((v) => v + 1);
          }}
        />
      ) : (
        <>
          <DateBar day={day} onChange={setDay} />
          {tab === 'plan' ? (
            <PlanBoard
              items={items}
              day={day}
              onEdit={edit}
              onAct={act}
              onAdd={(source) =>
                setEditor({
                  draft: {
                    ...emptyDraft(day),
                    title: source.name,
                    sourceType: source.type,
                    sourceId: source.id,
                  },
                })
              }
            />
          ) : (
            <Today items={items} onEdit={edit} onAct={act} />
          )}
        </>
      )}
      {editor && (
        <PlanningEditor
          value={editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}

function DateBar({ day, onChange }: { day: string; onChange: (day: string) => void }) {
  return (
    <div className="planning-datebar">
      <button
        className="secondary-button"
        onClick={() => onChange(addDays(day, -1))}
        aria-label="Dia anterior"
      >
        ←
      </button>
      <label>
        <CalendarDays size={17} />
        <input type="date" value={day} onChange={(e) => onChange(e.target.value)} />
      </label>
      <button className="secondary-button" onClick={() => onChange(localDate())}>
        Hoje
      </button>
      <button
        className="secondary-button"
        onClick={() => onChange(addDays(day, 1))}
        aria-label="Próximo dia"
      >
        →
      </button>
    </div>
  );
}

function PlanBoard({
  items,
  day,
  onEdit,
  onAct,
  onAdd,
}: {
  items: PlanningItem[];
  day: string;
  onEdit: (item: PlanningItem) => void;
  onAct: (action: (repo: PlanningRepository) => Promise<unknown>) => void;
  onAdd: (source: PlanningSourceOption) => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const groups = [
    {
      key: 'morning',
      label: 'Manhã',
      items: items.filter(
        (i) =>
          (i.schedule_kind === 'fixed' && i.start_time < '12:00') || i.day_period === 'morning',
      ),
    },
    {
      key: 'afternoon',
      label: 'Tarde',
      items: items.filter(
        (i) =>
          (i.schedule_kind === 'fixed' && i.start_time >= '12:00' && i.start_time < '18:00') ||
          i.day_period === 'afternoon',
      ),
    },
    {
      key: 'evening',
      label: 'Noite',
      items: items.filter(
        (i) =>
          (i.schedule_kind === 'fixed' && i.start_time >= '18:00') || i.day_period === 'evening',
      ),
    },
    {
      key: 'flexible',
      label: 'Flexíveis',
      items: items.filter((i) => i.schedule_kind === 'flexible'),
    },
  ];
  return (
    <>
      <button
        className="secondary-button planning-source-mobile-toggle"
        onClick={() => setSourcesOpen(true)}
      >
        <Plus size={16} /> Adicionar de tarefas e projetos
      </button>
      <div className="planning-layout">
        <div className="planning-board">
          {groups.map((group) => (
            <section className="planning-period" key={group.key}>
              <header>
                <h2>{group.label}</h2>
                <span>{group.items.length}</span>
              </header>
              {group.items.length ? (
                group.items.map((item) => (
                  <PlanningRow key={item.id} item={item} onEdit={onEdit} onAct={onAct} />
                ))
              ) : (
                <p className="planning-empty">Nada planejado neste período.</p>
              )}
            </section>
          ))}
        </div>
        <SourcePanel
          day={day}
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
          onAdd={(source) => {
            onAdd(source);
            setSourcesOpen(false);
          }}
        />
      </div>
    </>
  );
}

function PlanningRow({
  item,
  onEdit,
  onAct,
}: {
  item: PlanningItem;
  onEdit: (item: PlanningItem) => void;
  onAct: (action: (repo: PlanningRepository) => Promise<unknown>) => void;
}) {
  return (
    <article className={`planning-row status-${item.status}`}>
      <button
        className="planning-check"
        aria-label={item.status === 'completed' ? 'Reabrir item' : 'Concluir item'}
        onClick={() =>
          onAct((repo) =>
            repo.setStatus(item.id, item.status === 'completed' ? 'planned' : 'completed'),
          )
        }
      >
        {item.status === 'completed' && <Check size={15} />}
      </button>
      <button className="planning-row-main" onClick={() => onEdit(item)}>
        <strong>{item.display_title}</strong>
        <span>
          {planningTimeLabel(item)} ·{' '}
          {item.source_type === 'standalone' ? 'Item avulso' : item.source_type}
          {!item.source_active && item.source_type !== 'standalone' ? ' · origem concluída' : ''}
        </span>
      </button>
      <div className="planning-row-actions">
        <button
          className="icon-button"
          aria-label="Mover para cima"
          onClick={() => onAct((repo) => repo.reorder(item.id, -1))}
        >
          <ArrowUp size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Mover para baixo"
          onClick={() => onAct((repo) => repo.reorder(item.id, 1))}
        >
          <ArrowDown size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Duplicar"
          onClick={() => onAct((repo) => repo.duplicate(item.id, item.block_date))}
        >
          <Copy size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Excluir"
          onClick={() => onAct((repo) => repo.remove(item.id))}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}

function SourcePanel({
  day,
  open,
  onClose,
  onAdd,
}: {
  day: string;
  open: boolean;
  onClose: () => void;
  onAdd: (source: PlanningSourceOption) => void;
}) {
  const [type, setType] = useState<'task' | 'project'>('task');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PlanningSourceOption[]>([]);
  useEffect(() => {
    let live = true;
    void repository()
      .then((repo) => repo.sourceOptions(type, query))
      .then((next) => {
        if (live) setRows(next);
      });
    return () => {
      live = false;
    };
  }, [type, query, day]);
  return (
    <aside className={`planning-sources${open ? ' is-open' : ''}`}>
      <button
        className="icon-button planning-source-close"
        onClick={onClose}
        aria-label="Fechar tarefas e projetos"
      >
        <X size={17} />
      </button>
      <div className="planning-source-tabs">
        <button aria-pressed={type === 'task'} onClick={() => setType('task')}>
          Tarefas
        </button>
        <button aria-pressed={type === 'project'} onClick={() => setType('project')}>
          Projetos
        </button>
      </div>
      <label className="planning-search">
        <Search size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Buscar ${type === 'task' ? 'tarefas' : 'projetos'}…`}
        />
      </label>
      <div className="planning-source-list">
        {rows.map((row) => (
          <button key={row.id} onClick={() => onAdd(row)}>
            <span>
              <strong>{row.name}</strong>
              <small>{row.detail}</small>
            </span>
            <Plus size={16} />
          </button>
        ))}
      </div>
    </aside>
  );
}

function Today({
  items,
  onEdit,
  onAct,
}: {
  items: PlanningItem[];
  onEdit: (item: PlanningItem) => void;
  onAct: (action: (repo: PlanningRepository) => Promise<unknown>) => void;
}) {
  const sections = [
    ['Agora', items.filter((i) => i.status === 'planned' && i.schedule_kind === 'fixed')],
    ['Depois', items.filter((i) => i.status === 'planned' && i.schedule_kind !== 'fixed')],
    ['Pendências', items.filter((i) => i.status === 'skipped')],
    ['Concluídos', items.filter((i) => i.status === 'completed')],
  ] as const;
  return (
    <div className="today-planning">
      {sections.map(([label, rows]) => (
        <section key={label}>
          <h2>
            {label}
            <span>{rows.length}</span>
          </h2>
          {rows.length ? (
            rows.map((item) => (
              <PlanningRow key={item.id} item={item} onEdit={onEdit} onAct={onAct} />
            ))
          ) : (
            <p className="planning-empty">Nenhum item.</p>
          )}
        </section>
      ))}
    </div>
  );
}

function PlanningEditor({
  value,
  onClose,
  onSaved,
}: {
  value: { draft: PlanningDraft; id?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(value.draft);
  const [sources, setSources] = useState<PlanningSourceOption[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void repository()
      .then((repo) => repo.auxiliarySources(draft.date))
      .then(setSources)
      .catch((e) => setError(String(e)));
  }, [draft.date]);
  const change = <K extends keyof PlanningDraft>(key: K, next: PlanningDraft[K]) =>
    setDraft((old) => ({ ...old, [key]: next }));
  async function save() {
    setBusy(true);
    try {
      await (await repository()).save(draft, value.id);
      onSaved();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={value.id ? 'Editar planejamento' : 'Novo planejamento'}
      onClose={onClose}
      busy={busy}
      error={error}
    >
      <form
        className="planning-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Título
          <input
            autoFocus
            required
            maxLength={500}
            value={draft.title}
            onChange={(e) => change('title', e.target.value)}
          />
        </label>
        <div className="planning-form-grid">
          <label>
            Data
            <input
              type="date"
              required
              value={draft.date}
              onChange={(e) => change('date', e.target.value)}
            />
          </label>
          <label>
            Organização
            <select
              value={draft.schedule}
              onChange={(e) => change('schedule', e.target.value as PlanningSchedule)}
            >
              <option value="fixed">Horário</option>
              <option value="period">Período</option>
              <option value="flexible">Flexível</option>
            </select>
          </label>
        </div>
        {draft.schedule === 'fixed' && (
          <div className="planning-form-grid">
            <label>
              Início
              <input
                type="time"
                value={draft.startTime ?? ''}
                onChange={(e) => change('startTime', e.target.value)}
              />
            </label>
            <label>
              Fim
              <input
                type="time"
                value={draft.endTime ?? ''}
                onChange={(e) => change('endTime', e.target.value)}
              />
            </label>
          </div>
        )}
        {draft.schedule === 'period' && (
          <label>
            Período
            <select
              value={draft.dayPeriod ?? ''}
              onChange={(e) => change('dayPeriod', e.target.value as DayPeriod)}
            >
              <option value="" disabled>
                Escolha
              </option>
              {Object.entries(periodLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}{' '}
        {!value.id && (
          <label>
            Vincular a
            <select
              value={
                draft.sourceType === 'standalone' ? '' : `${draft.sourceType}:${draft.sourceId}`
              }
              onChange={(e) => {
                const selected = sources.find((s) => `${s.type}:${s.id}` === e.target.value);
                setDraft((old) =>
                  selected
                    ? {
                        ...old,
                        title: selected.name,
                        sourceType: selected.type,
                        sourceId: selected.id,
                      }
                    : { ...old, sourceType: 'standalone', sourceId: null },
                );
              }}
            >
              <option value="">Item avulso</option>
              {sources.map((source) => (
                <option key={`${source.type}:${source.id}`} value={`${source.type}:${source.id}`}>
                  {source.name} · {source.detail}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Notas
          <textarea
            rows={3}
            maxLength={4000}
            value={draft.notes}
            onChange={(e) => change('notes', e.target.value)}
          />
        </label>
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            Salvar
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function Models({ day, onApplied }: { day: string; onApplied: () => void }) {
  const [templates, setTemplates] = useState<PlanningTemplate[]>([]);
  const [selected, setSelected] = useState<PlanningTemplate | null>(null);
  const [items, setItems] = useState<PlanningTemplateItem[]>([]);
  const [name, setName] = useState('');
  const [newItem, setNewItem] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const repo = await repository();
    const rows = await repo.templates();
    setTemplates(rows);
    if (selected) setItems(await repo.templateItems(selected.id));
  }, [selected]);
  useEffect(() => {
    let current = true;
    void repository()
      .then(async (repo) => ({
        templates: await repo.templates(),
        items: selected ? await repo.templateItems(selected.id) : [],
      }))
      .then((next) => {
        if (current) {
          setTemplates(next.templates);
          setItems(next.items);
        }
      })
      .catch((e) => {
        if (current) setError(String(e));
      });
    return () => {
      current = false;
    };
  }, [selected]);
  async function create() {
    try {
      const repo = await repository();
      const id = await repo.saveTemplate({
        name,
        description: '',
        default_mode: 'single',
        active: 1,
      });
      setName('');
      setSelected((await repo.templates()).find((t) => t.id === id) ?? null);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="models-layout">
      <aside className="model-list">
        <h2>Modelos</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Novo modelo"
            aria-label="Nome do novo modelo"
          />
          <button className="primary-button" aria-label="Criar modelo">
            <Plus size={16} />
          </button>
        </form>
        {templates.map((template) => (
          <button
            key={template.id}
            aria-current={selected?.id === template.id ? 'true' : undefined}
            onClick={() => setSelected(template)}
          >
            <strong>{template.name}</strong>
            <small>
              {template.legacy_routine_id
                ? 'Migrado de Rotinas'
                : template.default_mode === 'single'
                  ? 'Bloco único'
                  : 'Itens expandidos'}
            </small>
          </button>
        ))}
      </aside>
      <section className="model-detail">
        {error && <p className="notice error">{error}</p>}
        {selected ? (
          <>
            <header>
              <div>
                <h2>{selected.name}</h2>
                <p>
                  {selected.description ||
                    'Use como bloco único com checklist ou expanda os itens no dia.'}
                </p>
              </div>
              <button
                className="primary-button"
                onClick={() =>
                  void repository()
                    .then((repo) => repo.applyTemplate(selected.id, day, selected.default_mode))
                    .then(onApplied)
                    .catch((e) => setError(String(e)))
                }
              >
                Aplicar em {day.slice(8, 10)}/{day.slice(5, 7)}
              </button>
            </header>
            <div className="model-mode">
              <button
                aria-pressed={selected.default_mode === 'single'}
                onClick={() =>
                  void repository()
                    .then((repo) =>
                      repo.saveTemplate({ ...selected, default_mode: 'single' }, selected.id),
                    )
                    .then(() => setSelected({ ...selected, default_mode: 'single' }))
                }
              >
                Bloco único
              </button>
              <button
                aria-pressed={selected.default_mode === 'expanded'}
                onClick={() =>
                  void repository()
                    .then((repo) =>
                      repo.saveTemplate({ ...selected, default_mode: 'expanded' }, selected.id),
                    )
                    .then(() => setSelected({ ...selected, default_mode: 'expanded' }))
                }
              >
                Expandir itens
              </button>
            </div>
            <form
              className="model-add"
              onSubmit={(e) => {
                e.preventDefault();
                void repository()
                  .then((repo) => repo.addTemplateItem(selected.id, newItem))
                  .then(() => {
                    setNewItem('');
                    void load();
                  });
              }}
            >
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder="Adicionar item"
              />
              <button className="secondary-button">
                <Plus size={16} /> Adicionar
              </button>
            </form>
            <ol className="model-items">
              {items.map((item) => (
                <li key={item.id}>
                  <span>{item.title}</span>
                  <button
                    className="icon-button"
                    aria-label={`Excluir ${item.title}`}
                    onClick={() =>
                      void repository()
                        .then((repo) => repo.removeTemplateItem(item.id))
                        .then(() => load())
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="model-placeholder">
            <MoreHorizontal />
            <h2>Escolha ou crie um modelo</h2>
            <p>Rotinas anteriores aparecem aqui sem perder o histórico já registrado.</p>
          </div>
        )}
      </section>
    </div>
  );
}
