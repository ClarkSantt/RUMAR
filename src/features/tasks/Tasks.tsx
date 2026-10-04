import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { RumoStore } from '../../hooks/useRumo';
import type { Snapshot, TaskOccurrence } from '../../types/models';
import { allTasks, completedTasks, todayTasks, upcomingTasks } from './domain';
import { TaskList } from './TaskList';
import { formatDate, fullDate } from '../../lib/dates';
import { QuickEntry } from '../../components/QuickEntry';
import { getDatabase } from '../../lib/database/connection';
import { Repository } from '../../services/repository';
const tabs = ['Hoje', 'Próximas', 'Todas', 'Concluídas'] as const;
export function Tasks({
  store,
  day,
  onOpen,
  onCreate,
}: {
  store: RumoStore;
  day: string;
  onOpen: (row: TaskOccurrence) => void;
  onCreate: () => void;
}) {
  const [view, setView] = useState<(typeof tabs)[number]>('Hoje');
  const [history, setHistory] = useState<{
    source: Snapshot | null;
    data: Snapshot | null;
    error: string;
  } | null>(null);
  const source = store.data;
  useEffect(() => {
    if (view !== 'Concluídas') return;
    let active = true;
    void getDatabase()
      .then((db) => new Repository(db).snapshot(true))
      .then((data) => {
        if (active) setHistory({ source, data, error: '' });
      })
      .catch(() => {
        if (active)
          setHistory({
            source,
            data: null,
            error: 'Não foi possível carregar o histórico. Troque de aba para tentar novamente.',
          });
      });
    return () => {
      active = false;
    };
  }, [source, view]);
  const loading = view === 'Concluídas' && history?.source !== source;
  const historyError = view === 'Concluídas' && history?.source === source ? history.error : '';
  const data =
    (view === 'Concluídas' && history?.source === source ? history.data : source) ?? source!;
  const listStore = view === 'Concluídas' ? { ...store, data, busy: store.busy || loading } : store;
  const rows =
    view === 'Hoje'
      ? todayTasks(data, day)
      : view === 'Próximas'
        ? upcomingTasks(data, day)
        : view === 'Todas'
          ? allTasks(data, day)
          : loading || historyError
            ? []
            : completedTasks(data);
  const groups = view === 'Próximas' ? [...new Set(rows.map((r) => r.date!))] : [];
  return (
    <>
      <header className="page-header header-with-action">
        <div>
          <p className="eyebrow">ESPAÇO PARA O QUE IMPORTA</p>
          <h1>Tarefas</h1>
          <p>Organize o que vem pela frente.</p>
        </div>
        <button className="primary-button" onClick={onCreate}>
          <Plus size={17} />
          Nova tarefa
        </button>
      </header>
      <nav className="tabs" aria-label="Visualizações de tarefas">
        {tabs.map((tab) => (
          <button
            key={tab}
            aria-current={view === tab ? 'page' : undefined}
            onClick={() => setView(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
      {view === 'Próximas' && (
        <p className="view-note">Recorrências dos próximos 30 dias e todas as tarefas futuras.</p>
      )}
      {loading && <p role="status">Carregando histórico…</p>}
      {historyError && <p role="alert">{historyError}</p>}
      {view !== 'Concluídas' && (
        <QuickEntry
          placeholder={
            view === 'Hoje' ? 'Adicionar tarefa para hoje…' : 'Adicionar tarefa sem data…'
          }
          busy={store.busy}
          onSave={(title) =>
            store.run(
              (repo) =>
                repo.createTask({
                  title,
                  description: '',
                  priority: 'normal',
                  due_date: view === 'Hoje' ? day : null,
                  due_time: null,
                  recurrence: null,
                }),
              'Tarefa adicionada.',
            )
          }
        />
      )}
      {!loading &&
        !historyError &&
        (groups.length ? (
          groups.map((date) => (
            <section className="date-group" key={date}>
              <h2>
                {fullDate(date)} <span>{formatDate(date)}</span>
              </h2>
              <TaskList rows={rows.filter((r) => r.date === date)} store={store} onOpen={onOpen} />
            </section>
          ))
        ) : (
          <TaskList rows={rows} store={listStore} onOpen={onOpen} showDate={view !== 'Hoje'} />
        ))}
    </>
  );
}
