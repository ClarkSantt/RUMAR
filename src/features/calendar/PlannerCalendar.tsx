import { useEffect, useRef, useState, memo } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  GripVertical,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { getDatabase } from '../../lib/database/connection';
import { addDays, fullDate, localDate, parseDate } from '../../lib/dates';
import type { RumoStore } from '../../hooks/useRumo';
import type { TaskOccurrence } from '../../types/models';
import { Calendar as MonthCalendar } from './Calendar';
import { calendarRange, type CalendarItem } from './repository';
import { CalendarPreferences, calendarSources, type CalendarSource } from './preferences';
import {
  PlannerRepository,
  defaultBlock,
  type TimeBlock,
  type BlockDraft,
  type PlannerPreferences,
} from './planner-repository';
import { layoutOverlaps, minuteOf, timeOf, movedTimes } from './planner-domain';
import { requestFocus } from './focus';
import './planner.css';
import { BlockRecurrenceFields } from './BlockRecurrenceFields';
import { GoogleMirrorControl } from '../integrations/google-calendar/GoogleMirrorControl';
import { BlockSeriesRepository } from './block-series-repository';
import { recurrenceSummary, type BlockRecurrence } from './block-recurrence';
type View = 'day' | 'workweek' | 'week' | 'month';
const labels: Record<CalendarSource, string> = {
  task: 'Tarefas',
  project: 'Projetos',
  objective: 'Objetivos',
  habit: 'Hábitos',
  routine: 'Rotinas',
  workout: 'Treinos',
  block: 'Time Blocks',
  milestone: 'Marcos',
  external: 'Eventos importados',
};
const scale = 1.2;
const NowLine = memo(function NowLine({ day }: { day: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return localDate(now) === day ? (
    <div className="planner-now" style={{ top: (now.getHours() * 60 + now.getMinutes()) * scale }}>
      <span>{timeOf(now.getHours() * 60 + now.getMinutes())}</span>
    </div>
  ) : null;
});
type Page = 'habits' | 'routines' | 'projects' | 'workouts' | 'objectives';
export function PlannerCalendar({
  day,
  store,
  onOpen,
  onCreate,
  onNavigate,
  scheduleTask,
  onScheduleConsumed,
}: {
  day: string;
  store: RumoStore;
  onOpen: (row: TaskOccurrence) => void;
  onCreate: () => void;
  scheduleTask?: { id: string; date: string | null; request: number } | null;
  onScheduleConsumed: () => void;
  onNavigate: (page: Page, id?: string) => void;
}) {
  const [view, setView] = useState<View>('day'),
    [date, setDate] = useState(scheduleTask?.date ?? day),
    [blocks, setBlocks] = useState<TimeBlock[]>([]),
    [items, setItems] = useState<CalendarItem[]>([]),
    [candidates, setCandidates] = useState<
      { id: string; type: TimeBlock['entity_type']; name: string; date: string }[]
    >([]),
    [prefs, setPrefs] = useState<PlannerPreferences>({
      visual_start: 7,
      visual_end: 23,
      default_minutes: 30,
      week_start: 1,
    }),
    [filters, setFilters] = useState(false),
    [visibility, setVisibility] = useState<Partial<Record<CalendarSource, boolean>>>({}),
    [panel, setPanel] = useState(true),
    [panelFilter, setPanelFilter] = useState('all'),
    [draft, setDraft] = useState<BlockDraft | null>(() =>
      scheduleTask
        ? {
            ...defaultBlock(scheduleTask.date ?? day),
            entity_type: 'task',
            entity_id: scheduleTask.id,
            occurrence_date: scheduleTask.date,
          }
        : null,
    ),
    [editing, setEditing] = useState<string | undefined>(),
    [selected, setSelected] = useState<TimeBlock | null>(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [keyboardMinute, setKeyboardMinute] = useState(9 * 60);
  const [recurrence, setRecurrence] = useState<BlockRecurrence | null>(null);
  const [editingSeries, setEditingSeries] = useState<string | undefined>();
  const [scope, setScope] = useState<{
    block: TimeBlock;
    action: 'edit' | 'move' | 'remove';
    draft?: BlockDraft;
  } | null>(null);
  const scroll = useRef<HTMLDivElement>(null),
    todayJump = useRef(0),
    mutationLock = useRef(false);
  useEffect(() => {
    if (scheduleTask) onScheduleConsumed();
  }, [scheduleTask, onScheduleConsumed]);
  const week = addDays(date, -((parseDate(date).getDay() - prefs.week_start + 7) % 7));
  const first =
    view === 'day'
      ? date
      : view === 'workweek'
        ? addDays(date, -((parseDate(date).getDay() + 6) % 7))
        : week;
  const days = Array.from({ length: view === 'day' ? 1 : view === 'workweek' ? 5 : 7 }, (_, i) =>
      addDays(first, i),
    ),
    last = days.at(-1)!;
  useEffect(() => {
    let live = true;
    void getDatabase()
      .then(async (db) => {
        const repo = new PlannerRepository(db);
        const [p, b, i, c, v] = await Promise.all([
          repo.preferences(),
          repo.visibleRange(first, last),
          calendarRange(db, first, last),
          repo.candidates(date),
          new CalendarPreferences(db).sources(),
        ]);
        return { p, b, i, c, v };
      })
      .then((r) => {
        if (live) {
          setPrefs(r.p);
          setBlocks(r.b);
          setItems(r.i);
          setCandidates(r.c);
          setVisibility(Object.fromEntries(r.v.map((v) => [v.source_type, !!v.visible])));
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : 'Erro ao carregar planejador.');
      });
    return () => {
      live = false;
    };
  }, [first, last, date, revision, store.data]);
  useEffect(() => {
    if (view === 'month') return;
    const now = new Date();
    const minute =
      localDate(now) >= first &&
      localDate(now) <= last &&
      now.getHours() >= prefs.visual_start &&
      now.getHours() < prefs.visual_end
        ? Math.max(0, now.getHours() * 60 + now.getMinutes() - 120)
        : prefs.visual_start * 60;
    scroll.current?.scrollTo({ top: minute * scale });
  }, [first, last, view, prefs.visual_start, prefs.visual_end]);
  async function mutate(action: (repo: PlannerRepository) => Promise<unknown>) {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setBusy(true);
    setError('');
    try {
      await action(new PlannerRepository(await getDatabase()));
      setRevision((n) => n + 1);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar bloco.');
      return false;
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  function newBlock(day = date, start = '09:00', candidate?: (typeof candidates)[number]) {
    setRecurrence(null);
    setEditingSeries(undefined);
    setEditing(undefined);
    setSelected(null);
    setDraft({
      ...defaultBlock(day, start, prefs.default_minutes),
      ...(candidate
        ? { entity_type: candidate.type, entity_id: candidate.id, occurrence_date: candidate.date }
        : {}),
    });
  }
  async function applyScope(all: boolean) {
    if (!scope) return;
    const { block, action, draft: next } = scope;
    if (action === 'edit') {
      if (all) {
        const s = await new BlockSeriesRepository(await getDatabase()).get(block.series_id!);
        if (!s) return;
        setDraft({ ...s, block_date: s.start_date, occurrence_date: null });
        setRecurrence(JSON.parse(s.recurrence_json) as BlockRecurrence);
        setEditingSeries(s.id);
        setEditing(undefined);
      } else {
        setDraft(block);
        setRecurrence(null);
        setEditing(block.id);
        setEditingSeries(undefined);
      }
      setSelected(null);
      setScope(null);
      return;
    }
    const ok = await mutate(async (r) => {
      const repo = new BlockSeriesRepository(await getDatabase());
      if (action === 'remove') {
        if (all) await repo.archive(block.series_id!);
        else await r.remove(block.id);
      } else if (next) {
        if (all) {
          const s = await repo.get(block.series_id!);
          if (!s) throw Error('Série não encontrada.');
          const delta = Math.round(
            (parseDate(next.block_date).getTime() - parseDate(block.block_date).getTime()) /
              86400000,
          );
          const rule = JSON.parse(s.recurrence_json) as BlockRecurrence;
          await repo.save(
            { ...s, ...next, block_date: addDays(s.start_date, delta) },
            {
              ...rule,
              weekdays: rule.weekdays.map((d) => (d + (delta % 7) + 7) % 7),
              until: rule.until ? addDays(rule.until, delta) : null,
            },
            s.id,
          );
        } else await r.save(next, block.id);
      }
    });
    if (ok) {
      setScope(null);
      setSelected(null);
    }
  }
  function moveDate(offset: number) {
    if (view === 'month') {
      const d = parseDate(date);
      d.setDate(1);
      d.setMonth(d.getMonth() + offset);
      setDate(localDate(d));
    } else setDate(addDays(date, offset * (view === 'day' ? 1 : 7)));
  }
  const openSource = (b: TimeBlock) => {
    setSelected(null);
    if (b.entity_type === 'task') {
      const task = store.data?.tasks.find((t) => t.id === b.entity_id);
      if (task) onOpen({ task, date: b.occurrence_date ?? b.block_date, completed: !!b.completed });
    } else if (b.entity_type)
      onNavigate(
        b.entity_type === 'workout'
          ? 'workouts'
          : b.entity_type === 'routine'
            ? 'routines'
            : 'habits',
        b.entity_id ?? undefined,
      );
  };
  const scheduled = (i: CalendarItem) =>
    blocks.some(
      (b) =>
        b.entity_type === i.kind &&
        b.entity_id === i.id &&
        (b.occurrence_date ?? b.block_date) === i.date,
    );
  const derived = items.filter((i) => i.time && !scheduled(i));
  const visibleCandidates = candidates.filter(
    (candidate) => panelFilter === 'all' || candidate.type === panelFilter,
  );
  async function drop(event: React.DragEvent<HTMLDivElement>, targetDate: string) {
    event.preventDefault();
    if (busy) return;
    const minute = Math.min(
      1425,
      Math.max(
        0,
        Math.round((event.clientY - event.currentTarget.getBoundingClientRect().top) / scale / 15) *
          15,
      ),
    );
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/rumo-planner')) as {
        id: string;
        kind: 'block' | 'candidate';
      };
      if (payload.kind === 'block') {
        const b = blocks.find((b) => b.id === payload.id);
        if (!b) return;
        const times = movedTimes(b.start_time, b.end_time, minute);
        if (b.series_id)
          setScope({
            block: b,
            action: 'move',
            draft: { ...b, block_date: targetDate, start_time: times.start, end_time: times.end },
          });
        else await mutate((r) => r.move(b.id, targetDate, times.start, times.end));
      } else {
        const c = candidates.find((c) => c.id === payload.id);
        if (c) {
          const d = {
            ...defaultBlock(targetDate, timeOf(minute), prefs.default_minutes),
            entity_type: c.type,
            entity_id: c.id,
            occurrence_date: c.date,
          };
          await mutate((r) => r.save(d));
        }
      }
    } catch {
      setError('Não foi possível mover o bloco. Use Editar horário.');
    }
  }
  return (
    <>
      <header className="page-header module-header">
        <div className="module-heading">
          <span className="module-heading-icon">
            <CalendarDays size={22} />
          </span>
          <div>
            <h1>Calendário</h1>
            <p>O prazo diz o que precisa ser feito. O bloco reserva quando você pretende fazer.</p>
          </div>
        </div>
      </header>
      <div className="planner-toolbar">
        <button
          className="secondary-button"
          onClick={() => {
            setDate(day);
            // Month navigation is handled by the existing monthly calendar.
            todayJump.current++;
            const n = new Date();
            scroll.current?.scrollTo({
              top: Math.max(0, n.getHours() * 60 + n.getMinutes() - 120) * scale,
            });
          }}
          hidden={view === 'month'}
        >
          Hoje
        </button>
        <button
          hidden={view === 'month'}
          className="icon-button"
          aria-label="Período anterior"
          title="Período anterior"
          onClick={() => moveDate(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          hidden={view === 'month'}
          className="icon-button"
          aria-label="Próximo período"
          title="Próximo período"
          onClick={() => moveDate(1)}
        >
          <ChevronRight size={18} />
        </button>
        <strong hidden={view === 'month'}>
          {view === 'day'
            ? fullDate(date)
            : `${first.split('-').reverse().join('/')} – ${last.split('-').reverse().join('/')}`}
        </strong>
        <div className="planner-views" aria-label="Visualização do calendário">
          {(
            [
              ['day', 'Dia'],
              ['workweek', 'Semana útil'],
              ['week', 'Semana'],
              ['month', 'Mês'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
        <button
          hidden={view === 'month'}
          className="secondary-button"
          onClick={() => setFilters(true)}
        >
          <SlidersHorizontal size={16} /> Filtros
        </button>
        {view !== 'month' && (
          <button
            className="secondary-button planner-panel-toggle"
            aria-expanded={panel}
            onClick={() => setPanel(!panel)}
          >
            Não agendado
          </button>
        )}
        <button className="primary-button" onClick={() => newBlock()}>
          <Plus size={15} />
          Novo bloco
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {view === 'month' ? (
        <MonthCalendar
          key={date.slice(0, 7)}
          embedded
          day={date}
          revision={{ revision, data: store.data }}
          onOpen={onOpen}
          onNavigate={onNavigate}
          onBlock={setSelected}
        />
      ) : (
        <div className={`planner-layout ${panel ? '' : 'panel-hidden'}`}>
          <div className="planner-scroll" ref={scroll}>
            <div
              className="planner-sheet"
              style={{ minWidth: view === 'day' ? 0 : days.length * 135 + 56 }}
            >
              <div
                className="planner-head"
                style={{ gridTemplateColumns: `56px repeat(${days.length},minmax(0,1fr))` }}
              >
                <span />
                <>
                  {days.map((d) => (
                    <strong key={d} aria-current={d === day ? 'date' : undefined}>
                      {parseDate(d).toLocaleDateString('pt-BR', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </strong>
                  ))}
                </>
              </div>
              <div
                className="planner-all-day"
                style={{ gridTemplateColumns: `56px repeat(${days.length},minmax(0,1fr))` }}
              >
                <small>Dia todo</small>
                {days.map((d) => (
                  <div key={d}>
                    {items
                      .filter((i) => i.date === d && !i.time && !scheduled(i))
                      .map((i) => (
                        <button
                          key={i.kind + i.id}
                          onClick={() => {
                            if (i.task)
                              onOpen({ task: i.task, date: i.date, completed: i.completed });
                            else
                              onNavigate(
                                i.kind === 'workout'
                                  ? 'workouts'
                                  : i.kind === 'objective' || i.kind === 'milestone'
                                    ? 'objectives'
                                    : i.kind === 'project'
                                      ? 'projects'
                                      : i.kind === 'routine'
                                        ? 'routines'
                                        : 'habits',
                                i.objectiveId ?? i.id,
                              );
                          }}
                        >
                          {i.completed ? '✓ ' : ''}
                          {i.name}
                        </button>
                      ))}
                  </div>
                ))}
              </div>
              <div
                className="planner-grid"
                style={{ gridTemplateColumns: `56px repeat(${days.length},minmax(0,1fr))` }}
              >
                <div className="planner-hours">
                  {Array.from({ length: 24 }, (_, h) => (
                    <span key={h} style={{ top: h * 60 * scale }}>
                      {timeOf(h * 60)}
                    </span>
                  ))}
                </div>
                {days.map((d) => {
                  const dayBlocks = blocks.filter((b) => b.block_date === d);
                  const all: TimeBlock[] = [
                    ...dayBlocks,
                    ...derived
                      .filter((i) => i.date === d)
                      .map((i) => ({
                        ...defaultBlock(d, i.time!, 30),
                        id: `derived:${i.kind}:${i.id}`,
                        name: i.name,
                        project_name: null,
                        completed: Number(i.completed),
                        entity_type: i.kind as TimeBlock['entity_type'],
                        entity_id: i.id,
                        occurrence_date: d,
                        created_at: '',
                        updated_at: '',
                      })),
                  ];
                  return (
                    <div
                      key={d}
                      className="planner-column"
                      style={{ height: 1440 * scale }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${fullDate(d)}. Setas escolhem horário, Enter cria bloco às ${timeOf(keyboardMinute)}.`}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          setKeyboardMinute((m) =>
                            Math.min(1425, Math.max(0, m + (e.key === 'ArrowDown' ? 15 : -15))),
                          );
                        }
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          newBlock(d, timeOf(keyboardMinute));
                        }
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => void drop(e, d)}
                      onClick={(e) => {
                        if (e.target !== e.currentTarget) return;
                        const minute = Math.min(
                          1425,
                          Math.max(
                            0,
                            Math.floor(
                              (e.clientY - e.currentTarget.getBoundingClientRect().top) /
                                scale /
                                15,
                            ) * 15,
                          ),
                        );
                        newBlock(d, timeOf(minute));
                      }}
                    >
                      {layoutOverlaps(all).map((b) => (
                        <div
                          className={`planner-block source-${b.entity_type ?? 'custom'} ${b.completed ? 'is-completed' : ''}`}
                          key={b.id}
                          style={{
                            top: minuteOf(b.start_time) * scale,
                            height: Math.max(
                              18,
                              (minuteOf(b.end_time) - minuteOf(b.start_time)) * scale,
                            ),
                            left: `calc(${(b.column / b.columns) * 100}% + 3px)`,
                            width: `calc(${100 / b.columns}% - 6px)`,
                          }}
                          draggable={!b.id.startsWith('derived:') && !busy}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              'application/rumo-planner',
                              JSON.stringify({ kind: 'block', id: b.id }),
                            );
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                        >
                          <button
                            className="planner-block-open"
                            aria-label={`${b.name}, ${b.start_time}–${b.end_time}${b.conflict ? ', conflito de horário' : ''}`}
                            onClick={() => {
                              if (b.id.startsWith('derived:')) {
                                if (b.entity_type === 'task') {
                                  const task = store.data?.tasks.find((t) => t.id === b.entity_id);
                                  if (task) onOpen({ task, date: d, completed: !!b.completed });
                                } else
                                  onNavigate(
                                    b.entity_type === 'routine' ? 'routines' : 'workouts',
                                    b.entity_id ?? undefined,
                                  );
                              } else setSelected(b);
                            }}
                          >
                            <strong>
                              {b.completed ? '✓ ' : ''}
                              {b.name}
                            </strong>
                            <small>
                              {b.start_time}–{b.end_time}
                            </small>
                            {b.project_name && <small>{b.project_name}</small>}
                          </button>
                          {!b.id.startsWith('derived:') && (
                            <button
                              className="planner-resize"
                              aria-label={`Redimensionar ${b.name}. Use o detalhe para editar por teclado.`}
                              tabIndex={-1}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                const handle = e.currentTarget;
                                handle.setPointerCapture(e.pointerId);
                                handle.dataset.startY = String(e.clientY);
                                handle.dataset.originalEnd = String(minuteOf(b.end_time));
                                handle.dataset.end = String(minuteOf(b.end_time));
                              }}
                              onPointerMove={(e) => {
                                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                                const minute = Math.min(
                                  1440,
                                  Math.max(
                                    minuteOf(b.start_time) + 15,
                                    Math.round(
                                      (Number(e.currentTarget.dataset.originalEnd) +
                                        (e.clientY - Number(e.currentTarget.dataset.startY)) /
                                          scale) /
                                        15,
                                    ) * 15,
                                  ),
                                );
                                e.currentTarget.parentElement!.style.height = `${(minute - minuteOf(b.start_time)) * scale}px`;
                                e.currentTarget.dataset.end = String(minute);
                              }}
                              onPointerUp={(e) => {
                                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                                e.currentTarget.releasePointerCapture(e.pointerId);
                                const element = e.currentTarget.parentElement!;
                                const end = Number(
                                  e.currentTarget.dataset.end ?? minuteOf(b.end_time),
                                );
                                if (b.series_id) {
                                  element.style.height = `${(minuteOf(b.end_time) - minuteOf(b.start_time)) * scale}px`;
                                  setScope({
                                    block: b,
                                    action: 'move',
                                    draft: { ...b, end_time: timeOf(end) },
                                  });
                                  return;
                                }
                                void mutate((r) =>
                                  r.move(b.id, b.block_date, b.start_time, timeOf(end)),
                                ).then((saved) => {
                                  if (!saved)
                                    element.style.height = `${(minuteOf(b.end_time) - minuteOf(b.start_time)) * scale}px`;
                                });
                              }}
                              onPointerCancel={(e) => {
                                e.currentTarget.parentElement!.style.height = `${(minuteOf(b.end_time) - minuteOf(b.start_time)) * scale}px`;
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <GripVertical size={10} />
                            </button>
                          )}
                        </div>
                      ))}
                      <NowLine day={d} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {panel && (
            <aside className="planner-unscheduled">
              <div className="planner-unscheduled-heading">
                <h2>Não agendado</h2>
                <span>{visibleCandidates.length}</span>
              </div>
              <p className="field-help">Arraste para um horário ou use Agendar.</p>
              <label>
                Mostrar
                <select value={panelFilter} onChange={(e) => setPanelFilter(e.target.value)}>
                  <option value="all">Todos</option>
                  <option value="task">Tarefas</option>
                  <option value="routine">Rotinas</option>
                  <option value="workout">Treinos</option>
                </select>
              </label>
              {visibleCandidates.map((c) => (
                <div
                  className="planner-candidate"
                  key={c.type + c.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      'application/rumo-planner',
                      JSON.stringify({ kind: 'candidate', id: c.id }),
                    );
                  }}
                >
                  <span>{c.name}</span>
                  <button className="text-button" onClick={() => newBlock(date, '09:00', c)}>
                    Agendar
                  </button>
                </div>
              ))}
              {!visibleCandidates.length && (
                <p className="field-help">Nenhum item para encaixar.</p>
              )}
              <button className="secondary-button" onClick={onCreate}>
                + Nova tarefa
              </button>
            </aside>
          )}
        </div>
      )}
      {filters && (
        <Dialog title="Filtros do calendário" onClose={() => setFilters(false)} busy={busy}>
          <div className="dialog-content">
            {calendarSources.map((kind) => (
              <label className="preference-row" key={kind}>
                <input
                  type="checkbox"
                  checked={visibility[kind] ?? true}
                  disabled={busy}
                  onChange={(e) => {
                    const next = e.target.checked;
                    void mutate(async () =>
                      new CalendarPreferences(await getDatabase()).source(kind, next),
                    );
                  }}
                />
                {labels[kind]}
              </label>
            ))}
            <p className="field-help">Ocultar uma fonte não altera tarefas, blocos ou histórico.</p>
          </div>
        </Dialog>
      )}
      {selected && !scope && (
        <Dialog
          title={selected.name}
          onClose={() => setSelected(null)}
          drawer
          error={error}
          busy={busy}
        >
          <div className="drawer-body">
            <p>
              {fullDate(selected.block_date)} · {selected.start_time}–{selected.end_time}
            </p>
            <p>
              Origem: {selected.entity_type ?? 'Bloco livre'}
              {selected.project_name ? ` · ${selected.project_name}` : ''}
            </p>
            {selected.notes && <p>{selected.notes}</p>}
            {selected.recurrence && (
              <p className="field-help">Recorrente · {recurrenceSummary(selected.recurrence)}</p>
            )}
            <GoogleMirrorControl
              kind={selected.series_id ? 'block_series' : 'block'}
              id={selected.series_id ?? selected.id}
            />
            {blocks.some(
              (b) =>
                b.id !== selected.id &&
                b.block_date === selected.block_date &&
                b.start_time < selected.end_time &&
                b.end_time > selected.start_time,
            ) && (
              <p className="field-help">Conflito de horário. Os dois blocos permanecem válidos.</p>
            )}
            <div className="review-actions">
              {selected.entity_type && (
                <button className="secondary-button" onClick={() => openSource(selected)}>
                  Abrir origem
                </button>
              )}
              <button
                className="secondary-button"
                onClick={() => {
                  if (selected.series_id) {
                    setScope({ block: selected, action: 'edit' });
                    return;
                  }
                  setRecurrence(null);
                  setEditingSeries(undefined);
                  setEditing(selected.id);
                  setDraft(selected);
                  setSelected(null);
                }}
              >
                Editar horário
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  const b = selected;
                  setSelected(null);
                  requestFocus({
                    title: b.name,
                    taskId: b.entity_type === 'task' ? b.entity_id : null,
                    blockId: b.id,
                    occurrenceDate: b.occurrence_date ?? b.block_date,
                  });
                }}
              >
                <Play size={14} />
                Iniciar foco
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void mutate((r) => r.duplicate(selected, addDays(selected.block_date, 1))).then(
                    (ok) => {
                      if (ok) setSelected(null);
                    },
                  )
                }
              >
                Duplicar para amanhã
              </button>
              {selected.entity_type === 'task' && !selected.completed && (
                <button
                  className="secondary-button"
                  disabled={store.busy}
                  onClick={() => {
                    const task = store.data?.tasks.find((t) => t.id === selected.entity_id);
                    if (task)
                      void store
                        .run((r) =>
                          r.setComplete(
                            task,
                            selected.occurrence_date ?? selected.block_date,
                            true,
                          ),
                        )
                        .then((ok) => {
                          if (ok) setSelected(null);
                        });
                  }}
                >
                  Marcar tarefa como concluída
                </button>
              )}
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() =>
                  selected.series_id
                    ? setScope({ block: selected, action: 'remove' })
                    : void mutate((r) => r.remove(selected.id)).then((ok) => {
                        if (ok) setSelected(null);
                      })
                }
              >
                Remover do calendário
              </button>
            </div>
            <p className="field-help">
              Remover o bloco preserva a entidade de origem e as sessões de foco.
            </p>
          </div>
        </Dialog>
      )}
      {draft && (
        <Dialog
          title={editing ? 'Editar bloco' : 'Novo bloco'}
          onClose={() => setDraft(null)}
          error={error}
          busy={busy}
        >
          <form
            className="dialog-content"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(async (r) =>
                recurrence
                  ? new BlockSeriesRepository(await getDatabase()).save(
                      draft,
                      recurrence,
                      editingSeries,
                    )
                  : r.save(draft, editing),
              ).then((ok) => {
                if (ok) setDraft(null);
              });
            }}
          >
            <label>
              Título
              <input
                autoFocus
                value={
                  draft.entity_type
                    ? (candidates.find((c) => c.id === draft.entity_id)?.name ??
                      blocks.find((b) => b.id === editing)?.name ??
                      draft.title)
                    : draft.title
                }
                disabled={!!draft.entity_type}
                required={!draft.entity_type}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            {!editing && (
              <label>
                Vincular
                <select
                  value={draft.entity_id ?? ''}
                  onChange={(e) => {
                    const c = candidates.find((c) => c.id === e.target.value);
                    setDraft({
                      ...draft,
                      entity_type: c?.type ?? null,
                      entity_id: c?.id ?? null,
                      occurrence_date: c?.date ?? null,
                    });
                  }}
                >
                  <option value="">Bloco livre</option>
                  {draft.entity_id && !candidates.some((c) => c.id === draft.entity_id) && (
                    <option value={draft.entity_id}>
                      {store.data?.tasks.find((t) => t.id === draft.entity_id)?.title ??
                        'Origem vinculada'}
                    </option>
                  )}
                  {candidates.map((c) => (
                    <option key={c.type + c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="form-grid">
              <label>
                Data
                <input
                  type="date"
                  required
                  value={draft.block_date}
                  onChange={(e) => setDraft({ ...draft, block_date: e.target.value })}
                />
              </label>
              <label>
                Início
                <input
                  type="time"
                  step="900"
                  required
                  value={draft.start_time}
                  onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
                />
              </label>
              <label>
                Fim
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
                  placeholder="HH:mm"
                  required
                  value={draft.end_time}
                  onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
                />
              </label>
            </div>
            {!editing && (
              <BlockRecurrenceFields
                value={recurrence}
                onChange={setRecurrence}
                allowNone={!editingSeries}
              />
            )}
            <label>
              Notas
              <textarea
                rows={3}
                maxLength={4000}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </label>
            <label>
              Lembrete
              <select
                value={draft.remind_minutes_before ?? 'none'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    remind_minutes_before:
                      e.target.value === 'none' ? null : Number(e.target.value),
                  })
                }
              >
                <option value="none">Nenhum</option>
                <option value="0">No horário</option>
                <option value="5">5 min antes</option>
                <option value="15">15 min antes</option>
              </select>
            </label>
            <p className="field-help">
              Horários locais. O bloco não altera o prazo da tarefa. Lembretes exigem notificações
              ativadas.
            </p>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setDraft(null)}>
                Cancelar
              </button>
              <button className="primary-button" disabled={busy}>
                Salvar bloco
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {scope && (
        <Dialog
          title={scope.action === 'remove' ? 'Remover bloco recorrente' : 'Editar bloco recorrente'}
          onClose={() => setScope(null)}
          error={error}
          busy={busy}
        >
          <div className="dialog-content">
            <p>Esta alteração deve afetar somente a ocorrência selecionada ou toda a série?</p>
            {scope.action === 'remove' && (
              <p className="field-help">
                Toda a série remove o planejamento de hoje em diante. O histórico anterior e sessões
                de foco permanecem.
              </p>
            )}
            <div className="form-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void applyScope(false)}
              >
                Somente este bloco
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void applyScope(true)}
              >
                Toda a série
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
