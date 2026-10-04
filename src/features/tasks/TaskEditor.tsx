import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import type { RumoStore } from '../../hooks/useRumo';
import { formatDate, localDate, weekdays } from '../../lib/dates';
import type { Priority, Recurrence, TaskInput, TaskOccurrence } from '../../types/models';
import { Subtasks } from './Subtasks';
import { ProjectFields } from './ProjectFields';
import { SaveTemplateButton } from '../templates/SaveTemplateButton';
import { requestFocus } from '../calendar/focus';
export function TaskEditor({
  row,
  store,
  onClose,
}: {
  row: TaskOccurrence | null;
  store: RumoStore;
  onClose: () => void;
}) {
  const task = row ? (store.data!.tasks.find((t) => t.id === row.task.id) ?? row.task) : undefined;
  const [initial] = useState<TaskInput>(() =>
    task
      ? {
          title: task.title,
          description: task.description,
          priority: task.priority,
          due_date: task.due_date,
          due_time: task.due_time,
          remind_minutes_before: task.remind_minutes_before ?? null,
          recurrence: task.recurrence,
          project_id: task.project_id ?? null,
          project_section_id: task.project_section_id ?? null,
        }
      : {
          title: '',
          description: '',
          priority: 'normal',
          due_date: null,
          due_time: null,
          remind_minutes_before: null,
          recurrence: null,
        },
  );
  const [draft, setDraft] = useState(initial),
    [confirm, setConfirm] = useState<'close' | 'delete' | null>(null);
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const change = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  function close() {
    if (dirty) setConfirm('close');
    else onClose();
  }
  async function save() {
    if (
      await store.run(
        (repo) => (task ? repo.updateTask(task.id, draft) : repo.createTask(draft)),
        'Tarefa salva.',
      )
    )
      onClose();
  }
  async function remove() {
    if (!task) return;
    if (await store.run((repo) => repo.archiveTask(task.id))) {
      store.setNotice({
        message: 'Tarefa excluída.',
        undo: () => store.run((repo) => repo.archiveTask(task.id, false), 'Tarefa restaurada.'),
      });
      onClose();
    }
  }
  return (
    <Dialog
      title={task ? 'Detalhes da tarefa' : 'Nova tarefa'}
      onClose={close}
      drawer
      busy={store.busy}
      error={store.notice?.error ? store.notice.message : undefined}
    >
      <div className="drawer-body">
        <form
          id="task-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={store.busy}>
            <label htmlFor="task-title">Título</label>
            <input
              id="task-title"
              className="title-input"
              autoFocus
              required
              maxLength={500}
              value={draft.title}
              placeholder="O que você quer fazer?"
              onChange={(e) => change('title', e.target.value)}
            />
            <label htmlFor="task-description">
              Descrição <span>opcional</span>
            </label>
            <textarea
              id="task-description"
              rows={4}
              value={draft.description}
              placeholder="Detalhes, ideias ou um próximo passo…"
              onChange={(e) => change('description', e.target.value)}
            />
            <div className="form-grid">
              <div>
                <label htmlFor="task-date">
                  {draft.recurrence ? 'Início da recorrência' : 'Data'}
                </label>
                <input
                  type="date"
                  id="task-date"
                  value={draft.due_date ?? ''}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      due_date: e.target.value || null,
                      remind_minutes_before: e.target.value ? current.remind_minutes_before : null,
                    }))
                  }
                />
              </div>
              <div>
                <label htmlFor="task-time">Horário</label>
                <input
                  type="time"
                  id="task-time"
                  value={draft.due_time ?? ''}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      due_time: e.target.value || null,
                      remind_minutes_before: e.target.value ? current.remind_minutes_before : null,
                    }))
                  }
                />
              </div>
            </div>
            <label htmlFor="task-reminder">Lembrete local</label>
            <select
              id="task-reminder"
              value={draft.remind_minutes_before ?? ''}
              disabled={!draft.due_date || !draft.due_time}
              onChange={(e) =>
                change(
                  'remind_minutes_before',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
            >
              <option value="">Sem lembrete</option>
              <option value="0">No horário</option>
              <option value="5">5 minutos antes</option>
              <option value="15">15 minutos antes</option>
              <option value="30">30 minutos antes</option>
              <option value="60">1 hora antes</option>
            </select>
            <ProjectFields draft={draft} onChange={setDraft} />
            <label htmlFor="task-priority">Prioridade</label>
            <select
              id="task-priority"
              value={draft.priority}
              onChange={(e) => change('priority', e.target.value as Priority)}
            >
              <option value="low">Baixa</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
            </select>
            <label htmlFor="task-recurrence">Repetir</label>
            <select
              id="task-recurrence"
              value={draft.recurrence?.frequency ?? 'none'}
              onChange={(e) => {
                const frequency = e.target.value;
                setDraft((d) => ({
                  ...d,
                  due_date: frequency !== 'none' ? d.due_date || localDate() : d.due_date,
                  recurrence:
                    frequency === 'none'
                      ? null
                      : {
                          frequency: frequency as Recurrence['frequency'],
                          weekdays: frequency === 'weekdays' ? [1, 3, 5] : undefined,
                          until: d.recurrence?.until,
                        },
                }));
              }}
            >
              <option value="none">Não repetir</option>
              <option value="daily">Diariamente</option>
              <option value="weekdays">Dias específicos da semana</option>
              <option value="weekly">Semanalmente</option>
              <option value="monthly">Mensalmente</option>
            </select>
            {draft.recurrence?.frequency === 'weekdays' && (
              <div className="weekday-picker" role="group" aria-label="Dias da semana">
                {weekdays.map((day) => (
                  <button
                    type="button"
                    key={day.value}
                    title={day.label}
                    aria-label={day.label}
                    aria-pressed={draft.recurrence?.weekdays?.includes(day.value) ?? false}
                    onClick={() => {
                      const selected = draft.recurrence?.weekdays ?? [];
                      change('recurrence', {
                        ...draft.recurrence!,
                        weekdays: selected.includes(day.value)
                          ? selected.filter((v) => v !== day.value)
                          : [...selected, day.value],
                      });
                    }}
                  >
                    {day.short}
                  </button>
                ))}
              </div>
            )}
            {draft.recurrence && (
              <>
                <label htmlFor="recurrence-end">
                  Repetir até <span>opcional</span>
                </label>
                <input
                  id="recurrence-end"
                  type="date"
                  min={draft.due_date ?? undefined}
                  value={draft.recurrence.until ?? ''}
                  onChange={(e) =>
                    change('recurrence', {
                      ...draft.recurrence!,
                      until: e.target.value || undefined,
                    })
                  }
                />
                <p className="field-help">
                  {draft.recurrence.frequency === 'monthly'
                    ? 'Meses mais curtos usam o último dia do mês. '
                    : ''}
                  Concluir um dia mantém a próxima ocorrência pendente.
                </p>
              </>
            )}
            {task?.recurrence && (
              <p className="field-help">
                A edição altera a série. Conclusões anteriores são preservadas.
                {row?.date ? ` Ocorrência selecionada: ${formatDate(row.date)}.` : ''}
              </p>
            )}
          </fieldset>
        </form>
        {task ? (
          <Subtasks store={store} task={task} date={row?.date ?? null} />
        ) : (
          <p className="field-help">Salve a tarefa para adicionar subtarefas.</p>
        )}
        {confirm && (
          <div className="confirmation" role="alert">
            <p>
              {confirm === 'delete'
                ? 'Excluir a tarefa e suas subtarefas da lista?'
                : 'Descartar as alterações não salvas?'}
            </p>
            <div>
              <button
                className="danger-button"
                disabled={store.busy}
                onClick={() => (confirm === 'delete' ? void remove() : onClose())}
              >
                {confirm === 'delete' ? 'Excluir tarefa' : 'Descartar'}
              </button>
              <button className="text-button" onClick={() => setConfirm(null)}>
                Continuar editando
              </button>
            </div>
          </div>
        )}
      </div>
      <footer className="drawer-footer">
        {task && (
          <button
            className="secondary-button"
            disabled={dirty || store.busy}
            onClick={() => {
              onClose();
              requestFocus({ title: task.title, taskId: task.id, occurrenceDate: row?.date });
            }}
          >
            Focar
          </button>
        )}
        {task && (
          <button
            className="secondary-button"
            disabled={dirty || store.busy}
            onClick={() => {
              onClose();
              window.dispatchEvent(
                new CustomEvent('rumo-schedule-task', {
                  detail: { id: task.id, date: row?.date ?? null },
                }),
              );
            }}
          >
            Agendar bloco
          </button>
        )}
        {task && <SaveTemplateButton kind="task" sourceId={task.id} initialName={task.title} />}
        {task && (
          <button
            className="icon-button danger"
            disabled={store.busy}
            onClick={() => setConfirm('delete')}
            aria-label="Excluir tarefa"
          >
            <Trash2 size={18} />
          </button>
        )}
        <span className="spacer" />
        <button className="secondary-button" disabled={store.busy} onClick={close}>
          Cancelar
        </button>
        <button
          className="primary-button"
          form="task-form"
          disabled={store.busy || !draft.title.trim()}
        >
          {store.busy ? 'Salvando…' : 'Salvar tarefa'}
        </button>
      </footer>
    </Dialog>
  );
}
