import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { database } from './database';
import { Repository } from '../src/services/repository';
import { ProjectsRepository } from '../src/features/projects/repository';
import { convertInboxTo } from '../src/features/inbox/conversions';
import { calendarRange } from '../src/features/calendar/repository';
import { addDays, localDate } from '../src/lib/dates';
import { completedTasks } from '../src/features/tasks/domain';

describe('Independent Phase 2 integration review', () => {
  let db: ReturnType<typeof database>, tasks: Repository, projects: ProjectsRepository;
  beforeEach(() => {
    db = database();
    tasks = new Repository(db.connection);
    projects = new ProjectsRepository(db.connection);
  });
  afterEach(() => db.sqlite.close());
  const project = (name: string) => ({
    name,
    description: '',
    start_date: null,
    target_date: null,
  });
  it('bounds startup history while preserving older task and subtask occurrences for explicit queries', async () => {
    const today = localDate(),
      old = addDays(today, -180);
    const id = await tasks.createTask({
      title: 'Série antiga',
      description: '',
      priority: 'normal',
      due_date: old,
      due_time: null,
      recurrence: { frequency: 'daily' },
    });
    await tasks.addSubtask(id, 'Etapa antiga');
    const initial = await tasks.snapshot(),
      task = initial.tasks[0],
      subtask = initial.subtasks[0];
    for (const date of [old, addDays(today, -30), today]) {
      await tasks.setComplete(task, date, true);
      await tasks.setSubtaskComplete(subtask, task, date, true);
    }
    const startup = await tasks.snapshot();
    expect(startup.completions.map((c) => c.occurrence_date).sort()).toEqual([
      addDays(today, -30),
      today,
    ]);
    expect(startup.subtaskCompletions).toHaveLength(2);
    const full = await tasks.snapshot(true);
    expect(completedTasks(full).map((c) => c.date)).toContain(old);
    expect(full.completions).toHaveLength(3);
    expect(full.subtaskCompletions).toHaveLength(3);
    expect(await tasks.subtaskHistory(id, old)).toEqual([
      expect.objectContaining({ subtask_id: subtask.id, occurrence_date: old }),
    ]);
    expect(await tasks.subtaskHistory('other-task', old)).toEqual([]);
    await tasks.setSubtaskComplete(subtask, task, old, false);
    await tasks.setComplete(task, old, false, true);
    expect(await tasks.subtaskHistory(id, old)).toEqual([]);
    expect(completedTasks(await tasks.snapshot(true)).some((c) => c.date === old)).toBe(false);
    expect((await tasks.snapshot()).completions).toHaveLength(2);
  });
  it('converts a pending Inbox item to exactly one destination even when destinations race', async () => {
    await tasks.createInbox('Uma captura longa '.repeat(100));
    const id = (await tasks.snapshot()).inbox[0].id;
    const results = await Promise.allSettled([
      convertInboxTo(db.connection, id, 'project'),
      convertInboxTo(db.connection, id, 'thought'),
      tasks.convertInbox(id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const counts = db.sqlite
      .prepare(
        'SELECT (SELECT count(*) FROM projects)+(SELECT count(*) FROM thoughts)+(SELECT count(*) FROM tasks) n',
      )
      .get();
    expect(counts?.n).toBe(1);
    expect(db.sqlite.prepare('SELECT status FROM inbox_items WHERE id=?').get(id)?.status).toBe(
      'processed',
    );
  });
  it('guards cross-project sections on update and clears only the section when it is removed', async () => {
    const first = await projects.create(project('Primeiro'));
    const second = await projects.create(project('Segundo'));
    const section = await projects.createSection(first, 'Etapa');
    const id = await tasks.createTask({
      title: 'Tarefa real',
      description: '',
      priority: 'normal',
      due_date: null,
      due_time: null,
      recurrence: null,
      project_id: first,
      project_section_id: section,
    });
    await expect(
      db.connection.execute('UPDATE tasks SET project_id=$1 WHERE id=$2', [second, id]),
    ).rejects.toThrow('seção');
    expect((await tasks.snapshot()).tasks[0].project_id).toBe(first);
    await projects.deleteSection(section);
    expect((await tasks.snapshot()).tasks[0]).toMatchObject({
      project_id: first,
      project_section_id: null,
    });
  });
  it('calendar queries reflect persisted task changes without creating occurrences in storage', async () => {
    const input = {
      title: 'Antes',
      description: '',
      priority: 'normal' as const,
      due_date: '2026-09-01',
      due_time: '09:30',
      recurrence: { frequency: 'daily' as const, until: '2026-09-03' },
    };
    const id = await tasks.createTask(input);
    const rows = await calendarRange(db.connection, '2026-09-01', '2026-09-07');
    expect(rows.filter((r) => r.kind === 'task').map((r) => r.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    await tasks.updateTask(id, {
      ...input,
      title: 'Depois',
      due_time: '11:45',
      due_date: '2026-09-05',
      recurrence: null,
    });
    const updated = await calendarRange(db.connection, '2026-09-01', '2026-09-07');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id, name: 'Depois', date: '2026-09-05', time: '11:45' });
    expect(db.sqlite.prepare('SELECT count(*) n FROM task_completions').get()?.n).toBe(0);
  });
});
