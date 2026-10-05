import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { getDatabase } from '../../lib/database/connection';
import { addDays, fullDate, localDate, parseDate, weekdays } from '../../lib/dates';
import { Dialog } from '../../components/Dialog';
import type { TaskOccurrence } from '../../types/models';
import { calendarRange, type CalendarItem } from './repository';
import { CalendarPreferences, calendarSources, type CalendarSource } from './preferences';
import './calendar.css';
import { PlannerRepository, type TimeBlock } from './planner-repository';
const labels = {
  task: 'Tarefas',
  habit: 'Hábitos',
  routine: 'Rotinas',
  project: 'Prazos de projetos',
  objective: 'Prazos de objetivos',
  workout: 'Treinos',
  block: 'Time Blocks',
  milestone: 'Marcos',
  external: 'Eventos importados',
};
export function Calendar({
  day,
  onOpen,
  onNavigate,
  revision,
  embedded = false,
  onBlock,
}: {
  day: string;
  revision?: unknown;
  embedded?: boolean;
  onBlock?: (block: TimeBlock) => void;
  onOpen: (row: TaskOccurrence) => void;
  onNavigate: (
    page: 'habits' | 'routines' | 'projects' | 'workouts' | 'objectives',
    id?: string,
  ) => void;
}) {
  const [month, setMonth] = useState(day.slice(0, 7) + '-01'),
    [items, setItems] = useState<CalendarItem[]>([]),
    [blocks, setBlocks] = useState<TimeBlock[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [filters, setFilters] = useState(false),
    [preferences, setPreferences] = useState<Partial<Record<CalendarSource, boolean>>>({}),
    [filterRevision, setFilterRevision] = useState(0),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    void getDatabase()
      .then((db) => new CalendarPreferences(db).sources())
      .then((rows) => {
        if (live) setPreferences(Object.fromEntries(rows.map((r) => [r.source_type, !!r.visible])));
      })
      .catch(() => {
        if (live) setError('Erro ao carregar filtros.');
      });
    return () => {
      live = false;
    };
  }, [filterRevision]);
  const first = addDays(month, -((parseDate(month).getDay() + 6) % 7)),
    last = addDays(first, 41);
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) =>
        Promise.all([
          calendarRange(db, first, last),
          new PlannerRepository(db).visibleRange(first, last),
        ]),
      )
      .then(([value, planned]) => {
        if (active) {
          setItems(value);
          setBlocks(planned);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError('Não foi possível carregar o calendário.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [first, last, revision, filterRevision]);
  function move(offset: number) {
    const date = parseDate(month);
    date.setMonth(date.getMonth() + offset);
    setLoading(true);
    setError('');
    setMonth(localDate(date));
  }
  return (
    <>
      {!embedded && (
        <header className="page-header module-header">
          <div className="module-heading">
            <span className="module-heading-icon">
              <CalendarDays size={22} />
            </span>
            <div>
              <h1>Calendário</h1>
              <p>Tarefas, hábitos, rotinas, treinos e prazos em um só lugar.</p>
            </div>
          </div>
        </header>
      )}
      <div className="calendar-toolbar">
        <button
          className="secondary-button calendar-today"
          onClick={() => {
            setLoading(true);
            setMonth(day.slice(0, 7) + '-01');
            if (month === day.slice(0, 7) + '-01') setLoading(false);
          }}
        >
          Hoje
        </button>
        <button
          className="icon-button"
          aria-label="Mês anterior"
          title="Mês anterior"
          onClick={() => move(-1)}
        >
          <ChevronLeft size={20} />
        </button>
        <h2 aria-live="polite">
          {parseDate(month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </h2>
        <button
          className="icon-button"
          aria-label="Próximo mês"
          title="Próximo mês"
          onClick={() => move(1)}
        >
          <ChevronRight size={20} />
        </button>
        <button className="secondary-button calendar-filters" onClick={() => setFilters(true)}>
          <SlidersHorizontal size={16} /> Filtros
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {filters && (
        <Dialog title="Filtros do calendário" onClose={() => setFilters(false)} busy={saving}>
          <div className="dialog-content">
            {calendarSources.map((kind) => (
              <label key={kind} style={{ display: 'block', marginBottom: 12 }}>
                <input
                  type="checkbox"
                  disabled={saving}
                  checked={preferences[kind] ?? true}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setPreferences((current) => ({ ...current, [kind]: next }));
                    setSaving(true);
                    void getDatabase()
                      .then((db) => new CalendarPreferences(db).source(kind, next))
                      .then(() => setFilterRevision((n) => n + 1))
                      .catch(() => {
                        setPreferences((current) => ({ ...current, [kind]: !next }));
                        setError('Erro ao salvar filtros.');
                      })
                      .finally(() => setSaving(false));
                  }}
                />{' '}
                {labels[kind]}
              </label>
            ))}
            <p className="field-help">
              Filtros persistem e afetam apenas o calendário. A visibilidade individual pode ser
              alterada no editor de hábitos e rotinas.
            </p>
          </div>
        </Dialog>
      )}
      {loading && <p role="status">Carregando calendário…</p>}
      <div className="calendar-grid" aria-label="Calendário mensal">
        {weekdays.map((w) => (
          <div className="calendar-weekday" key={w.value}>
            {w.short}
          </div>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const date = addDays(first, i),
            rows = [
              ...items.filter((item) => item.date === date),
              ...blocks
                .filter((b) => b.block_date === date)
                .map((b) => ({
                  id: b.id,
                  kind: 'block',
                  name: b.name,
                  time: b.start_time,
                  completed: !!b.completed,
                })),
            ];
          return (
            <button
              key={date}
              className={`calendar-cell ${date.slice(0, 7) !== month.slice(0, 7) ? 'outside-month' : ''}`}
              aria-label={`${fullDate(date)}: ${rows.length} itens`}
              aria-current={date === day ? 'date' : undefined}
              aria-pressed={date === selected}
              onClick={() => setSelected(date)}
            >
              <strong className="calendar-day-number">{parseDate(date).getDate()}</strong>
              {rows.slice(0, 2).map((item) => (
                <span
                  key={item.kind + item.id}
                  data-kind={item.kind}
                  className={`calendar-event ${item.completed ? 'calendar-done' : ''}`}
                >
                  {item.time ? item.time + ' ' : ''}
                  {item.name}
                </span>
              ))}
              {rows.length > 2 && <small>+{rows.length - 2}</small>}
            </button>
          );
        })}
      </div>
      {selected && (
        <Dialog title={fullDate(selected)} onClose={() => setSelected(null)} drawer>
          <div className="drawer-body">
            {Object.entries(labels).map(([kind, label]) => (
              <section className="secondary-section" key={kind}>
                <h3>{label}</h3>
                {kind === 'block' &&
                  blocks
                    .filter((b) => b.block_date === selected)
                    .map((b) => (
                      <button
                        key={b.id}
                        className="calendar-detail-item"
                        onClick={() => {
                          setSelected(null);
                          onBlock?.(b);
                        }}
                      >
                        {b.start_time}–{b.end_time} {b.name}
                      </button>
                    ))}
                {items
                  .filter((i) => i.date === selected && i.kind === kind)
                  .map((i) =>
                    i.kind === 'external' ? (
                      <div key={i.id} className="calendar-detail-item">
                        <span>
                          {i.time ? `${i.time} ` : ''}
                          {i.name}
                        </span>
                        {i.description && <p className="field-help">{i.description}</p>}
                      </div>
                    ) : (
                      <button
                        key={i.id}
                        className="calendar-detail-item"
                        onClick={() => {
                          setSelected(null);
                          if (i.task)
                            onOpen({ task: i.task, date: i.date, completed: i.completed });
                          else
                            onNavigate(
                              i.kind === 'objective' || i.kind === 'milestone'
                                ? 'objectives'
                                : i.kind === 'habit'
                                  ? 'habits'
                                  : i.kind === 'workout'
                                    ? 'workouts'
                                    : i.kind === 'routine'
                                      ? 'routines'
                                      : 'projects',
                              i.objectiveId ?? i.id,
                            );
                        }}
                      >
                        <span>
                          {i.completed ? '✓ ' : ''}
                          {i.time ? i.time + ' ' : ''}
                          {i.name}
                        </span>
                      </button>
                    ),
                  )}
                {!items.some((i) => i.date === selected && i.kind === kind) &&
                  !(kind === 'block' && blocks.some((b) => b.block_date === selected)) && (
                    <p className="field-help">Nenhum item.</p>
                  )}
              </section>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
