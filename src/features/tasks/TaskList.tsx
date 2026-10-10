import { useState } from 'react';
import { AlertTriangle, Flag, ListChecks, Repeat2 } from 'lucide-react';
import type { RumoStore } from '../../hooks/useRumo';
import { formatDate, localDate } from '../../lib/dates';
import type { TaskOccurrence } from '../../types/models';
import { EmptyState } from '../../components/EmptyState';

function TaskRow({
  row,
  store,
  onOpen,
  showDate,
}: {
  row: TaskOccurrence;
  store: RumoStore;
  onOpen: (row: TaskOccurrence) => void;
  showDate: boolean;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const task = row.task,
    checked = optimistic ?? row.completed;
  const subtasks = store.data?.subtasks.filter((s) => s.task_id === task.id) ?? [];
  const count = subtasks.filter((s) =>
    task.recurrence
      ? store.data?.subtaskCompletions.some(
          (c) => c.subtask_id === s.id && c.occurrence_date === row.date,
        )
      : s.completed,
  ).length;
  const future = Boolean(task.recurrence && (!row.date || row.date > localDate()));
  async function toggle() {
    setOptimistic(!checked);
    await store.run((repo) => repo.setComplete(task, row.date, !checked, row.historical));
    setOptimistic(null);
  }
  return (
    <div className={`task-row ${checked ? 'is-completed' : ''}`}>
      <input
        className="task-check"
        type="checkbox"
        aria-label={`${checked ? 'Desfazer conclusão de' : 'Concluir'} ${task.title}`}
        title={future ? 'Disponível no dia da ocorrência' : undefined}
        checked={checked}
        disabled={store.busy || future || Boolean(task.blocked)}
        aria-describedby={task.blocked ? `task-blocked-${task.id}` : undefined}
        onChange={() => void toggle()}
      />
      <button className="task-open" onClick={() => onOpen(row)}>
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {task.recurrence && (
            <span title="Tarefa recorrente">
              <Repeat2 size={13} />
              <span className="sr-only">Recorrente</span>
            </span>
          )}
          {subtasks.length > 0 && (
            <span title="Subtarefas">
              <ListChecks size={13} />
              {count}/{subtasks.length}
            </span>
          )}
          {task.priority !== 'normal' && (
            <span className={`priority ${task.priority}`}>
              <Flag size={12} />
              {task.priority === 'high' ? 'Alta' : 'Baixa'}
            </span>
          )}
          {Boolean(task.blocked) && (
            <span className="priority high" id={`task-blocked-${task.id}`}>
              <AlertTriangle size={12} /> Bloqueada
            </span>
          )}
          {showDate && row.date && <span>{formatDate(row.date)}</span>}
          {task.recurrence && !row.date && <span>Série encerrada</span>}
          {task.due_time && <span className="time">{task.due_time}</span>}
        </span>
      </button>
    </div>
  );
}
export function TaskList({
  rows,
  store,
  onOpen,
  showDate = false,
  emptyTitle = 'Nenhuma tarefa aqui.',
  emptyDescription,
  emptyIllustration,
}: {
  rows: TaskOccurrence[];
  store: RumoStore;
  onOpen: (row: TaskOccurrence) => void;
  showDate?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIllustration?: string;
}) {
  if (!rows.length)
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        illustration={emptyIllustration}
      />
    );
  return (
    <div className="task-list">
      {rows.map((row) => (
        <TaskRow
          key={`${row.task.id}-${row.date}-${row.historical ? 'history' : 'task'}`}
          row={row}
          store={store}
          onOpen={onOpen}
          showDate={showDate}
        />
      ))}
    </div>
  );
}
