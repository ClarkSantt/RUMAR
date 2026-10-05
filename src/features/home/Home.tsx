import { ArrowRight, Inbox } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { QuickEntry } from '../../components/QuickEntry';
import type { RumoStore } from '../../hooks/useRumo';
import { fullDate, greeting, localDate } from '../../lib/dates';
import type { TaskOccurrence } from '../../types/models';
import { overdueTasks, todayTasks } from '../tasks/domain';
import { TaskList } from '../tasks/TaskList';
export function Home({
  store,
  now,
  onOpen,
  onInbox,
  onReview,
  quickSummary,
  continuation,
}: {
  store: RumoStore;
  now: Date;
  onOpen: (row: TaskOccurrence) => void;
  onInbox: () => void;
  onReview: () => void;
  quickSummary?: ReactNode;
  continuation?: ReactNode;
}) {
  const [showOverdue, setShowOverdue] = useState(false);
  const data = store.data!,
    day = localDate(now),
    rows = todayTasks(data, day),
    overdue = overdueTasks(data, day),
    completed = rows.filter((r) => r.completed).length;
  return (
    <>
      <header className="page-header home-header">
        <h1>
          {greeting(now)}, {data.settings.name}.
        </h1>
        <p className="date-line">{fullDate(day)}</p>
      </header>
      {quickSummary && (
        <div className="home-pulse" role="region" aria-label="Resumo do dia">
          <section className="home-pulse-item home-task-pulse">
            <span className="summary-label">Tarefas de hoje</span>
            <strong>
              {completed} de {rows.length} concluídas
            </strong>
            <progress
              max={Math.max(rows.length, 1)}
              value={completed}
              aria-label="Progresso das tarefas de hoje"
            />
            <span className="summary-caption">{rows.length - completed} pendentes</span>
          </section>
          {quickSummary}
        </div>
      )}
      <div className="home-focus-layout">
        <section className="today-section" id="home-tasks">
          <div className="section-heading home-today-heading">
            <h2>Hoje</h2>
            {!quickSummary && (
              <span aria-live="polite">
                {rows.length
                  ? `${completed} de ${rows.length} concluídas`
                  : 'Sem tarefas previstas'}
              </span>
            )}
          </div>
          {rows.length > 0 && !quickSummary && (
            <progress
              className="day-progress"
              aria-label="Progresso de hoje"
              max={rows.length}
              value={completed}
            />
          )}
          <TaskList
            rows={rows}
            store={store}
            onOpen={onOpen}
            emptyTitle="Nada para hoje."
            emptyDescription="Adicione uma tarefa ou simplesmente aproveite o espaço livre."
          />
          <QuickEntry
            placeholder="Adicionar tarefa para hoje…"
            busy={store.busy}
            onSave={(title) =>
              store.run(
                (repo) =>
                  repo.createTask({
                    title,
                    description: '',
                    priority: 'normal',
                    due_date: day,
                    due_time: null,
                    recurrence: null,
                  }),
                'Tarefa adicionada.',
              )
            }
          />
        </section>
        {continuation && (
          <aside className="home-continuation" aria-label="Continuidade do dia">
            {continuation}
          </aside>
        )}
      </div>
      <div className="home-glance" aria-label="Outros itens do dia">
        <button onClick={onInbox}>
          <span className="summary-label">Inbox</span>
          <strong>{data.inbox.length}</strong>
          <span className="summary-caption">
            {data.inbox.length === 1 ? 'item para organizar' : 'itens para organizar'}{' '}
            <ArrowRight size={14} />
          </span>
        </button>
        <button onClick={() => setShowOverdue(!showOverdue)} aria-expanded={showOverdue}>
          <span className="summary-label">Para retomar</span>
          <strong>{overdue.length}</strong>
          <span className="summary-caption">
            {overdue.length === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}
          </span>
        </button>
      </div>
      {showOverdue && (
        <section className="secondary-section">
          <div className="section-heading">
            <h2>Para retomar</h2>
            <span>{overdue.length} atrasadas</span>
          </div>
          <TaskList
            rows={overdue}
            store={store}
            onOpen={onOpen}
            showDate
            emptyTitle="Tudo em dia."
          />
        </section>
      )}
      <button className="capture-hint" onClick={onInbox}>
        <Inbox size={16} />
        <span>Uma ideia para depois? Guarde no Inbox.</span>
        <kbd>Ctrl + Espaço</kbd>
      </button>
      <button className="capture-hint review-hint" onClick={onReview}>
        <span>
          <strong>REVISÃO SEMANAL</strong> Veja o que foi registrado e prepare a próxima semana.
        </span>
        <ArrowRight size={16} />
      </button>
    </>
  );
}
