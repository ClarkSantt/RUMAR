import { useEffect, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import type { RumoStore } from '../../hooks/useRumo';
import type { Snapshot, Subtask, SubtaskCompletion, Task } from '../../types/models';
import { QuickEntry } from '../../components/QuickEntry';
import { localDate } from '../../lib/dates';
import { getDatabase } from '../../lib/database/connection';
import { Repository } from '../../services/repository';
function SubtaskRow({
  item,
  store,
  task,
  date,
}: {
  item: Subtask;
  store: RumoStore;
  task: Task;
  date: string | null;
}) {
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(item.title),
    [removing, setRemoving] = useState(false);
  const checked = task.recurrence
    ? Boolean(
        store.data?.subtaskCompletions.some(
          (c) => c.subtask_id === item.id && c.occurrence_date === date,
        ),
      )
    : Boolean(item.completed);
  const future = Boolean(task.recurrence && (!date || date > localDate()));
  return (
    <div className="subtask-row">
      <input
        className="task-check"
        type="checkbox"
        checked={checked}
        disabled={store.busy || future}
        aria-label={`${checked ? 'Desmarcar' : 'Concluir'} subtarefa ${item.title}`}
        onChange={() =>
          void store.run((repo) => repo.setSubtaskComplete(item, task, date, !checked))
        }
      />
      {editing ? (
        <form
          className="inline-edit"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await store.run((repo) => repo.editSubtask(item.id, title))) setEditing(false);
          }}
        >
          <input
            aria-label="Título da subtarefa"
            autoFocus
            value={title}
            maxLength={500}
            onChange={(e) => setTitle(e.target.value)}
            disabled={store.busy}
          />
          <button
            className="icon-button"
            disabled={store.busy || !title.trim()}
            aria-label="Salvar subtarefa"
          >
            <Check size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setEditing(false)}
            aria-label="Cancelar edição"
          >
            <X size={16} />
          </button>
        </form>
      ) : (
        <>
          <span className={checked ? 'struck' : ''}>{item.title}</span>
          <button
            className="icon-button"
            disabled={store.busy}
            onClick={() => {
              setTitle(item.title);
              setEditing(true);
            }}
            aria-label={`Editar subtarefa ${item.title}`}
          >
            <Pencil size={14} />
          </button>
          <button
            className="icon-button"
            disabled={store.busy}
            onClick={() => setRemoving(true)}
            aria-label={`Excluir subtarefa ${item.title}`}
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
      {removing && (
        <div className="inline-confirm">
          <span>Excluir esta subtarefa?</span>
          <button
            className="danger-button"
            disabled={store.busy}
            onClick={() =>
              void store.run((repo) => repo.deleteSubtask(item.id), 'Subtarefa excluída.')
            }
          >
            Excluir
          </button>
          <button className="text-button" onClick={() => setRemoving(false)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
export function Subtasks({
  store,
  task,
  date,
}: {
  store: RumoStore;
  task: Task;
  date: string | null;
}) {
  const source = store.data,
    taskId = task.id,
    recurring = !!task.recurrence;
  const [history, setHistory] = useState<{
    source: Snapshot | null;
    taskId: string;
    date: string;
    records: SubtaskCompletion[];
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!recurring || !date) return;
    let active = true;
    void getDatabase()
      .then((db) => new Repository(db).subtaskHistory(taskId, date))
      .then((records) => {
        if (active) setHistory({ source, taskId, date, records, error: false });
      })
      .catch(() => {
        if (active) setHistory({ source, taskId, date, records: [], error: true });
      });
    return () => {
      active = false;
    };
  }, [source, taskId, date, recurring]);
  const ready =
    !recurring ||
    !date ||
    (history?.source === source && history.taskId === taskId && history.date === date);
  const failed = ready && recurring && !!date && history?.error;
  const scopedStore =
    recurring && date
      ? {
          ...store,
          data: { ...source!, subtaskCompletions: history?.records ?? [] },
          busy: store.busy || !ready || !!failed,
        }
      : store;
  const rows = store.data!.subtasks.filter((s) => s.task_id === task.id);
  return (
    <section className="subtasks">
      <h3>
        Subtarefas <span>{rows.length}</span>
      </h3>
      {task.recurrence && (
        <p className="field-help">As marcações pertencem à ocorrência selecionada.</p>
      )}
      {!ready && <p role="status">Carregando marcações desta ocorrência…</p>}
      {failed && (
        <p role="alert">
          Não foi possível carregar as marcações. Reabra a tarefa para tentar novamente.
        </p>
      )}
      {ready &&
        !failed &&
        rows.map((item) => (
          <SubtaskRow key={item.id} item={item} store={scopedStore} task={task} date={date} />
        ))}
      <QuickEntry
        placeholder="Adicionar subtarefa…"
        busy={store.busy}
        onSave={(title) => store.run((repo) => repo.addSubtask(task.id, title))}
      />
    </section>
  );
}
