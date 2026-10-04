import type { SqlConnection } from '../lib/database/connection';
import { addDays, localDate } from '../lib/dates';
import { occursOn, validateTask } from '../features/tasks/domain';
import type {
  Completion,
  InboxItem,
  Snapshot,
  Subtask,
  SubtaskCompletion,
  Task,
  TaskInput,
  Theme,
} from '../types/models';
type TaskRow = Omit<Task, 'recurrence'> & { recurrence: string | null };
const timestamp = () => new Date().toISOString();
function text(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('O texto não pode ficar vazio.');
  return trimmed;
}

export class Repository {
  constructor(private readonly db: SqlConnection) {}
  private reminderSupport?: Promise<boolean>;
  private supportsReminder() {
    this.reminderSupport ??= this.db
      .select<{ name: string }[]>('PRAGMA table_info(tasks)')
      .then((rows) => rows.some((row) => row.name === 'remind_minutes_before'));
    return this.reminderSupport;
  }
  async snapshot(history = false): Promise<Snapshot> {
    // The initial app state only needs recent/current occurrences. Older history is
    // explicitly requested by the completed-tasks view, never on every mutation.
    const range = history ? [] : [addDays(localDate(), -30), addDays(localDate(), 30)];
    const dateFilter = history ? '' : ' AND c.occurrence_date BETWEEN $1 AND $2';
    const [rows, subtasks, completions, subtaskCompletions, inbox, settings] = await Promise.all([
      this.db.select<TaskRow[]>(
        'SELECT * FROM tasks WHERE archived_at IS NULL ORDER BY sort_order, created_at',
      ),
      this.db.select<Subtask[]>(
        'SELECT s.* FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE t.archived_at IS NULL ORDER BY s.sort_order, s.created_at',
      ),
      this.db.select<Completion[]>(
        'SELECT c.* FROM task_completions c JOIN tasks t ON t.id=c.task_id WHERE t.archived_at IS NULL' +
          dateFilter,
        range,
      ),
      this.db.select<SubtaskCompletion[]>(
        'SELECT c.* FROM subtask_completions c JOIN subtasks s ON s.id=c.subtask_id JOIN tasks t ON t.id=s.task_id WHERE t.archived_at IS NULL' +
          dateFilter,
        range,
      ),
      this.db.select<InboxItem[]>(
        "SELECT * FROM inbox_items WHERE status = 'pending' ORDER BY created_at DESC",
      ),
      this.db.select<{ key: string; value: string }[]>('SELECT key, value FROM settings'),
    ]);
    const prefs = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    return {
      tasks: rows.map((row) => ({
        ...row,
        recurrence: row.recurrence ? (JSON.parse(row.recurrence) as Task['recurrence']) : null,
      })),
      subtasks,
      completions,
      subtaskCompletions,
      inbox,
      settings: {
        name: prefs.name ?? 'Gustavo',
        theme: ['light', 'dark', 'system'].includes(prefs.theme)
          ? (prefs.theme as Theme)
          : 'system',
      },
    };
  }
  subtaskHistory(taskId: string, date: string): Promise<SubtaskCompletion[]> {
    return this.db.select<SubtaskCompletion[]>(
      'SELECT c.* FROM subtask_completions c JOIN subtasks s ON s.id=c.subtask_id WHERE s.task_id=$1 AND c.occurrence_date=$2',
      [taskId, date],
    );
  }
  async createTask(input: TaskInput): Promise<string> {
    const value = validateTask(input),
      id = crypto.randomUUID(),
      now = timestamp();
    const reminder = await this.supportsReminder();
    await this.db.execute(
      reminder
        ? 'INSERT INTO tasks(id,title,description,priority,due_date,due_time,recurrence,created_at,updated_at,project_id,project_section_id,remind_minutes_before) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11)'
        : 'INSERT INTO tasks(id,title,description,priority,due_date,due_time,recurrence,created_at,updated_at,project_id,project_section_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10)',
      [
        id,
        value.title,
        value.description,
        value.priority,
        value.due_date,
        value.due_time,
        value.recurrence ? JSON.stringify(value.recurrence) : null,
        now,
        value.project_id ?? null,
        value.project_section_id ?? null,
        ...(reminder ? [value.remind_minutes_before ?? null] : []),
      ],
    );
    return id;
  }
  async updateTask(id: string, input: TaskInput): Promise<void> {
    const value = validateTask(input);
    const reminder = await this.supportsReminder();
    await this.db.execute(
      `UPDATE tasks SET title=$2,description=$3,priority=$4,due_date=$5,due_time=$6,recurrence=$7,updated_at=$8,project_id=$9,project_section_id=$10,${reminder ? 'remind_minutes_before=$11,' : ''}status=CASE WHEN $7 IS NOT NULL THEN 'pending' ELSE status END,completed_at=CASE WHEN $7 IS NOT NULL THEN NULL ELSE completed_at END WHERE id=$1 AND archived_at IS NULL`,
      [
        id,
        value.title,
        value.description,
        value.priority,
        value.due_date,
        value.due_time,
        value.recurrence ? JSON.stringify(value.recurrence) : null,
        timestamp(),
        value.project_id ?? null,
        value.project_section_id ?? null,
        ...(reminder ? [value.remind_minutes_before ?? null] : []),
      ],
    );
  }
  async archiveTask(id: string, archived = true): Promise<void> {
    await this.db.execute('UPDATE tasks SET archived_at=$2,updated_at=$3 WHERE id=$1', [
      id,
      archived ? timestamp() : null,
      timestamp(),
    ]);
  }
  async setComplete(
    task: Task,
    date: string | null,
    completed: boolean,
    historical = false,
  ): Promise<void> {
    // Historical occurrences remain independently undoable even after a series becomes a one-off.
    if (task.recurrence || historical) {
      if (!date || (!occursOn(task, date) && completed))
        throw new Error('Esta data não pertence à recorrência.');
      if (completed && date > localDate())
        throw new Error('A ocorrência poderá ser concluída no dia correspondente.');
      if (completed)
        await this.db.execute(
          'INSERT INTO task_completions(task_id,occurrence_date,completed_at) VALUES($1,$2,$3) ON CONFLICT(task_id,occurrence_date) DO NOTHING',
          [task.id, date, timestamp()],
        );
      else
        await this.db.execute(
          'DELETE FROM task_completions WHERE task_id=$1 AND occurrence_date=$2',
          [task.id, date],
        );
    } else {
      await this.db.execute(
        'UPDATE tasks SET status=$2,completed_at=$3,updated_at=$4 WHERE id=$1 AND archived_at IS NULL',
        [task.id, completed ? 'completed' : 'pending', completed ? timestamp() : null, timestamp()],
      );
    }
  }
  async addSubtask(taskId: string, title: string): Promise<void> {
    await this.db.execute(
      'INSERT INTO subtasks(id,task_id,title,sort_order,created_at,updated_at) VALUES($1,$2,$3,(SELECT COALESCE(MAX(sort_order),0)+1 FROM subtasks WHERE task_id=$2),$4,$4)',
      [crypto.randomUUID(), taskId, text(title), timestamp()],
    );
  }
  async editSubtask(id: string, title: string): Promise<void> {
    await this.db.execute('UPDATE subtasks SET title=$2,updated_at=$3 WHERE id=$1', [
      id,
      text(title),
      timestamp(),
    ]);
  }
  async setSubtaskComplete(
    subtask: Subtask,
    task: Task,
    date: string | null,
    completed: boolean,
  ): Promise<void> {
    if (task.recurrence) {
      if (!date || !occursOn(task, date) || date > localDate())
        throw new Error('Selecione uma ocorrência atual para marcar subtarefas.');
      if (completed)
        await this.db.execute(
          'INSERT INTO subtask_completions(subtask_id,occurrence_date,completed_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [subtask.id, date, timestamp()],
        );
      else
        await this.db.execute(
          'DELETE FROM subtask_completions WHERE subtask_id=$1 AND occurrence_date=$2',
          [subtask.id, date],
        );
    } else
      await this.db.execute('UPDATE subtasks SET completed=$2,updated_at=$3 WHERE id=$1', [
        subtask.id,
        Number(completed),
        timestamp(),
      ]);
  }
  async deleteSubtask(id: string): Promise<void> {
    await this.db.execute('DELETE FROM subtasks WHERE id=$1', [id]);
  }
  async createInbox(content: string): Promise<void> {
    await this.db.execute(
      'INSERT INTO inbox_items(id,content,created_at,updated_at) VALUES($1,$2,$3,$3)',
      [crypto.randomUUID(), text(content), timestamp()],
    );
  }
  async editInbox(id: string, content: string): Promise<void> {
    await this.db.execute(
      "UPDATE inbox_items SET content=$2,updated_at=$3 WHERE id=$1 AND status='pending'",
      [id, text(content), timestamp()],
    );
  }
  async archiveInbox(id: string, archived = true): Promise<void> {
    await this.db.execute(
      "UPDATE inbox_items SET status=$2,updated_at=$3 WHERE id=$1 AND status != 'processed'",
      [id, archived ? 'archived' : 'pending', timestamp()],
    );
  }
  async convertInbox(id: string): Promise<string> {
    const taskId = crypto.randomUUID();
    await this.db.execute(
      "INSERT INTO tasks(id,title,description,source_inbox_id,created_at,updated_at) SELECT $1,substr(content,1,500),CASE WHEN length(content)>500 THEN content ELSE '' END,id,$3,$3 FROM inbox_items WHERE id=$2 AND status='pending' ON CONFLICT(source_inbox_id) DO NOTHING",
      [taskId, id, timestamp()],
    );
    const rows = await this.db.select<{ id: string }[]>(
      'SELECT id FROM tasks WHERE source_inbox_id=$1',
      [id],
    );
    if (!rows.length) throw new Error('Este item não está mais disponível para conversão.');
    return rows[0].id;
  }
  async saveSetting(key: 'name' | 'theme', value: string): Promise<void> {
    if (key === 'name') {
      value = text(value);
      if (value.length > 80) throw new Error('Use até 80 caracteres para o nome.');
    }
    if (key === 'theme' && !['light', 'dark', 'system'].includes(value))
      throw new Error('Tema inválido.');
    await this.db.execute(
      'INSERT INTO settings(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
      [key, value, timestamp()],
    );
  }
}
