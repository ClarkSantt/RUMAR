import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Dumbbell,
  Folder,
  HeartPulse,
  ListTodo,
  NotebookPen,
  Plus,
  Wallet,
} from 'lucide-react';
import { addDays, localDate } from '../../lib/dates';
import { getDatabase } from '../../lib/database/connection';
import { Dialog } from '../../components/Dialog';
import { TimelineRepository, type TimelineEvent, type TimelineGroup } from './repository';
import { ObjectivesRepository, type Objective } from '../objectives/repository';
import { Attachments } from '../attachments/Attachments';

const groups: { value: TimelineGroup | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'organization', label: 'Organização' },
  { value: 'health', label: 'Saúde' },
  { value: 'finance', label: 'Finanças' },
  { value: 'personal', label: 'Pessoal' },
];
const sources: { value: string; label: string }[] = [
  { value: 'focus', label: 'Foco' },
  { value: '', label: 'Todos os módulos' },
  { value: 'task', label: 'Tarefas' },
  { value: 'project', label: 'Projetos' },
  { value: 'habit', label: 'Hábitos' },
  { value: 'routine', label: 'Rotinas' },
  { value: 'workout', label: 'Treinos' },
  { value: 'body', label: 'Progresso corporal' },
  { value: 'steps', label: 'Passos' },
  { value: 'nutrition', label: 'Alimentação' },
  { value: 'finance', label: 'Finanças' },
  { value: 'financial_goal', label: 'Metas financeiras' },
  { value: 'objective', label: 'Objetivos' },
  { value: 'milestone', label: 'Marcos' },
  { value: 'objective_update', label: 'Atualizações' },
  { value: 'thought', label: 'Pensamentos' },
  { value: 'moment', label: 'Momentos' },
];
const icons: Record<string, typeof ListTodo> = {
  task: ListTodo,
  project: Folder,
  habit: HeartPulse,
  routine: CalendarDays,
  workout: Dumbbell,
  body: HeartPulse,
  steps: HeartPulse,
  nutrition: HeartPulse,
  finance: Wallet,
  financial_goal: Wallet,
  objective: Folder,
  objective_update: Folder,
  thought: NotebookPen,
  moment: BookOpen,
};
type Page =
  | 'tasks'
  | 'projects'
  | 'habits'
  | 'routines'
  | 'workouts'
  | 'nutrition'
  | 'finance'
  | 'thoughts'
  | 'calendar'
  | 'objectives';
function dayLabel(day: string) {
  const today = localDate();
  if (day === today) return 'Hoje';
  if (day === addDays(today, -1)) return 'Ontem';
  return day.split('-').reverse().join('/');
}

export function Timeline({
  objectiveId,
  initialQuery,
  onNavigate,
}: {
  objectiveId?: string;
  initialQuery?: string;
  onNavigate: (page: Page, id?: string) => void;
}) {
  const [from, setFrom] = useState(() => addDays(localDate(), -90));
  const [to, setTo] = useState(() => localDate());
  const [group, setGroup] = useState<TimelineGroup | 'all'>('all');
  const [source, setSource] = useState('');
  const [objective, setObjective] = useState(objectiveId ?? '');
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [query, setQuery] = useState(initialQuery ?? '');
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [cursor, setCursor] = useState<{ sortAt: string; id: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [privateMode, setPrivateMode] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [selectedMoment, setSelectedMoment] = useState<TimelineEvent | null>(null);
  const [noteDate, setNoteDate] = useState(localDate());
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => {
        const [rows, privateValue] = await Promise.all([
          new ObjectivesRepository(db).list(),
          new TimelineRepository(db).privateMode(),
        ]);
        return { rows, privateValue };
      })
      .then((result) => {
        if (active) {
          setObjectives(result.rows);
          setPrivateMode(result.privateValue);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        setError('');
        void getDatabase()
          .then((db) =>
            new TimelineRepository(db).page({
              from,
              to,
              group,
              source: source || undefined,
              objectiveId: objective || undefined,
              query,
            }),
          )
          .then((page) => {
            if (active) {
              setEvents(page.events);
              setCursor(page.next);
              setHasMore(!!page.next);
              setLoading(false);
            }
          })
          .catch(() => {
            if (active) {
              setError('Não foi possível carregar a Timeline.');
              setLoading(false);
            }
          });
      },
      query ? 180 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [from, to, group, source, objective, query, privateMode, refreshKey]);
  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await new TimelineRepository(await getDatabase()).page({
        from,
        to,
        group,
        source: source || undefined,
        objectiveId: objective || undefined,
        query,
        before: cursor,
      });
      setEvents((current) => [...current, ...page.events]);
      setCursor(page.next);
      setHasMore(!!page.next);
    } catch {
      setError('Não foi possível carregar mais eventos.');
    } finally {
      setLoading(false);
    }
  }
  async function saveNote() {
    setError('');
    try {
      await new TimelineRepository(await getDatabase()).saveNote(
        noteDate,
        noteTitle,
        noteContent,
        objective || null,
      );
      setNoteOpen(false);
      setNoteTitle('');
      setNoteContent('');
      setRefreshKey((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível registrar o momento.');
    }
  }
  async function togglePrivate() {
    try {
      const next = !privateMode;
      await new TimelineRepository(await getDatabase()).setPrivateMode(next);
      setPrivateMode(next);
    } catch {
      setError('Não foi possível salvar a preferência de privacidade.');
    }
  }
  const grouped = new Map<string, TimelineEvent[]>();
  for (const event of events)
    grouped.set(event.event_date, [...(grouped.get(event.event_date) ?? []), event]);
  const destination: Record<string, Page> = {
    task: 'tasks',
    project: 'projects',
    habit: 'habits',
    routine: 'routines',
    workout: 'workouts',
    body: 'workouts',
    steps: 'workouts',
    nutrition: 'nutrition',
    finance: 'finance',
    financial_goal: 'finance',
    objective: 'objectives',
    objective_update: 'objectives',
    thought: 'thoughts',
    moment: 'objectives',
  };
  return (
    <>
      <header className="page-header">
        <p className="eyebrow">PESSOAL</p>
        <h1>Timeline</h1>
        <p>O que foi registrado ao longo do tempo, reunido por dia.</p>
      </header>
      <div className="review-actions">
        <button className="primary-button" onClick={() => setNoteOpen(true)}>
          <Plus size={16} /> Registrar momento
        </button>
        <label className="timeline-private">
          <input type="checkbox" checked={privateMode} onChange={() => void togglePrivate()} />{' '}
          Ocultar conteúdo sensível
        </label>
      </div>
      <div className="timeline-filters">
        <div role="group" aria-label="Área da Timeline" className="timeline-chips">
          {groups.map((item) => (
            <button
              key={item.value}
              className={group === item.value ? 'active' : ''}
              aria-pressed={group === item.value}
              onClick={() => setGroup(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label>
          Período inicial
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Período final
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Módulo
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {sources.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Objetivo
          <select value={objective} onChange={(e) => setObjective(e.target.value)}>
            <option value="">Todos</option>
            {objectives.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Buscar
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar na Timeline…"
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && !events.length && <p role="status">Carregando Timeline…</p>}
      {!loading && !events.length && !error && (
        <section className="empty-state">
          <h2>Nenhum registro neste período.</h2>
          <p>Você pode ampliar as datas ou registrar um momento.</p>
        </section>
      )}
      <div className="timeline-days">
        {Array.from(grouped, ([day, items]) => (
          <section key={day} className="timeline-day">
            <h2>{dayLabel(day)}</h2>
            <div>
              {items.map((event) => {
                const Icon = icons[event.source_type] ?? BookOpen;
                const time = event.sort_at.endsWith('T00:00:00') ? '' : event.sort_at.slice(11, 16);
                return (
                  <button
                    className="timeline-event"
                    key={event.id}
                    onClick={() => {
                      if (event.source_type === 'moment') setSelectedMoment(event);
                      else if (event.source_type === 'focus')
                        onNavigate(
                          event.link_id ? 'tasks' : 'calendar',
                          event.link_id ?? undefined,
                        );
                      else if (event.source_type === 'milestone')
                        onNavigate('objectives', event.objective_id ?? undefined);
                      else
                        onNavigate(destination[event.source_type] ?? 'objectives', event.source_id);
                    }}
                  >
                    <Icon size={17} />
                    <span>
                      <strong>{event.title}</strong>
                      {event.summary && <small>{event.summary}</small>}
                    </span>
                    {time && <time>{time}</time>}
                    <ArrowRight size={14} />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {hasMore && (
        <button className="secondary-button" disabled={loading} onClick={() => void loadMore()}>
          {loading ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
      {!hasMore && events.length > 0 && (
        <button className="text-button" onClick={() => setFrom(addDays(from, -90))}>
          Buscar também nos 90 dias anteriores
        </button>
      )}
      {noteOpen && (
        <Dialog title="Registrar momento" onClose={() => setNoteOpen(false)} error={error}>
          <div className="dialog-content timeline-note-dialog">
            <label htmlFor="moment-date">Data</label>
            <input
              id="moment-date"
              type="date"
              value={noteDate}
              onChange={(e) => setNoteDate(e.target.value)}
            />
            <label htmlFor="moment-name">Título</label>
            <input
              id="moment-name"
              autoFocus
              value={noteTitle}
              maxLength={160}
              onChange={(e) => setNoteTitle(e.target.value)}
            />
            <label htmlFor="moment-content">Detalhes opcionais</label>
            <textarea
              id="moment-content"
              rows={3}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
            />
            <div className="form-actions">
              <button className="secondary-button" onClick={() => setNoteOpen(false)}>
                Cancelar
              </button>
              <button
                className="primary-button"
                disabled={!noteTitle.trim()}
                onClick={() => void saveNote()}
              >
                Salvar momento
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {selectedMoment && (
        <Dialog title={selectedMoment.title} onClose={() => setSelectedMoment(null)}>
          <div className="dialog-content">
            <p>{dayLabel(selectedMoment.event_date)}</p>
            {selectedMoment.summary && <p>{selectedMoment.summary}</p>}
            <Attachments entityType="moment" entityId={selectedMoment.source_id} />
            {selectedMoment.objective_id && (
              <button
                className="text-button"
                onClick={() => onNavigate('objectives', selectedMoment.objective_id!)}
              >
                Abrir objetivo relacionado
              </button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
