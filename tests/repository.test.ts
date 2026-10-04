import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from '../src/services/repository';
import { database } from './database';
import { addDays, localDate } from '../src/lib/dates';
import { completedTasks, todayTasks } from '../src/features/tasks/domain';
import type { TaskInput } from '../src/types/models';
const input: TaskInput = {
  title: 'Organizar computador',
  description: 'Documentos e arquivos',
  priority: 'high',
  due_date: localDate(),
  due_time: null,
  recurrence: null,
};
describe('Repository against real SQLite and versioned migration', () => {
  let db: ReturnType<typeof database>, repo: Repository;
  beforeEach(() => {
    db = database();
    repo = new Repository(db.connection);
  });
  afterEach(() => db.sqlite.close());
  it('starts empty with only initial settings', async () => {
    const data = await repo.snapshot();
    expect(data.tasks).toEqual([]);
    expect(data.inbox).toEqual([]);
    expect(data.settings).toEqual({ name: 'Gustavo', theme: 'system' });
  });
  it('creates, edits, completes, undoes, archives and restores tasks', async () => {
    const id = await repo.createTask(input);
    let task = (await repo.snapshot()).tasks[0];
    expect(task.title).toBe(input.title);
    expect(task.id).toMatch(/^[\da-f-]{36}$/);
    await repo.updateTask(id, { ...input, title: 'Título editado', due_time: '18:30' });
    task = (await repo.snapshot()).tasks[0];
    expect(task.title).toBe('Título editado');
    expect(task.due_time).toBe('18:30');
    await repo.setComplete(task, task.due_date, true);
    expect((await repo.snapshot()).tasks[0].completed_at).toBeTruthy();
    expect(completedTasks(await repo.snapshot())).toHaveLength(1);
    await repo.setComplete(task, task.due_date, false);
    expect((await repo.snapshot()).tasks[0].status).toBe('pending');
    await repo.archiveTask(id);
    expect((await repo.snapshot()).tasks).toHaveLength(0);
    await repo.archiveTask(id, false);
    expect((await repo.snapshot()).tasks).toHaveLength(1);
  });
  it('allows title only and rejects invalid input without writing', async () => {
    await repo.createTask({ ...input, title: 'Simples', due_date: null });
    await expect(repo.createTask({ ...input, title: '  ' })).rejects.toThrow();
    await expect(repo.createTask({ ...input, due_time: '25:00' })).rejects.toThrow();
    await expect(repo.createTask({ ...input, due_date: '2026-02-30' })).rejects.toThrow();
    expect((await repo.snapshot()).tasks).toHaveLength(1);
  });
  it('completes occurrences independently and deduplicates repeated clicks', async () => {
    await repo.createTask({
      ...input,
      title: 'Skincare',
      recurrence: { frequency: 'daily' },
      due_date: addDays(localDate(), -1),
      due_time: '22:00',
    });
    const task = (await repo.snapshot()).tasks[0];
    await Promise.all([
      repo.setComplete(task, localDate(), true),
      repo.setComplete(task, localDate(), true),
    ]);
    let data = await repo.snapshot();
    expect(data.completions).toHaveLength(1);
    expect(data.tasks[0].status).toBe('pending');
    expect(todayTasks(data, localDate())[0].completed).toBe(true);
    expect(todayTasks(data, addDays(localDate(), 1))[0].completed).toBe(false);
    await repo.setComplete(task, localDate(), false);
    data = await repo.snapshot();
    expect(data.completions).toHaveLength(0);
    await expect(repo.setComplete(task, addDays(localDate(), 1), true)).rejects.toThrow();
  });
  it('preserves and can undo history after changing a recurrence', async () => {
    const id = await repo.createTask({ ...input, recurrence: { frequency: 'daily' } });
    await repo.setComplete((await repo.snapshot()).tasks[0], localDate(), true);
    await repo.updateTask(id, input);
    const data = await repo.snapshot();
    expect(completedTasks(data)).toHaveLength(1);
    await repo.setComplete(data.tasks[0], localDate(), false, true);
    expect(completedTasks(await repo.snapshot())).toHaveLength(0);
  });
  it('creates, edits, checks, unchecks and deletes subtasks', async () => {
    const id = await repo.createTask(input);
    await repo.addSubtask(id, 'Limpar Downloads');
    const data = await repo.snapshot(),
      subtask = data.subtasks[0],
      task = data.tasks[0];
    await repo.editSubtask(subtask.id, 'Organizar Downloads');
    await repo.setSubtaskComplete(subtask, task, localDate(), true);
    expect((await repo.snapshot()).subtasks[0]).toMatchObject({
      title: 'Organizar Downloads',
      completed: 1,
    });
    await repo.setSubtaskComplete(subtask, task, localDate(), false);
    expect((await repo.snapshot()).subtasks[0].completed).toBe(0);
    await repo.deleteSubtask(subtask.id);
    expect((await repo.snapshot()).subtasks).toHaveLength(0);
  });
  it('keeps recurring subtask completion independent per day', async () => {
    const id = await repo.createTask({ ...input, recurrence: { frequency: 'daily' } });
    await repo.addSubtask(id, 'Separar produtos');
    const { tasks, subtasks } = await repo.snapshot();
    await repo.setSubtaskComplete(subtasks[0], tasks[0], localDate(), true);
    await repo.setSubtaskComplete(subtasks[0], tasks[0], localDate(), true);
    expect((await repo.snapshot()).subtaskCompletions).toHaveLength(1);
    expect((await repo.snapshot()).subtasks[0].completed).toBe(0);
    await repo.setSubtaskComplete(subtasks[0], tasks[0], localDate(), false);
    expect((await repo.snapshot()).subtaskCompletions).toHaveLength(0);
    await repo.setSubtaskComplete(subtasks[0], tasks[0], localDate(), true);
    await repo.deleteSubtask(subtasks[0].id);
    expect((await repo.snapshot()).subtaskCompletions).toHaveLength(0);
  });
  it('creates, edits, archives and restores inbox items', async () => {
    await repo.createInbox('Comprar pasta térmica');
    const id = (await repo.snapshot()).inbox[0].id;
    await repo.editInbox(id, 'Pesquisar pasta térmica');
    expect((await repo.snapshot()).inbox[0].content).toBe('Pesquisar pasta térmica');
    await repo.archiveInbox(id);
    expect((await repo.snapshot()).inbox).toHaveLength(0);
    await repo.archiveInbox(id, false);
    expect((await repo.snapshot()).inbox).toHaveLength(1);
  });
  it('converts inbox atomically and prevents duplicate conversion', async () => {
    const content = "Comprar pasta térmica\nVer opções d'água";
    await repo.createInbox(content);
    const id = (await repo.snapshot()).inbox[0].id;
    const ids = await Promise.all([
      repo.convertInbox(id),
      repo.convertInbox(id),
      repo.convertInbox(id),
    ]);
    expect(new Set(ids).size).toBe(1);
    const data = await repo.snapshot();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe(content);
    expect(data.tasks[0].source_inbox_id).toBe(id);
    expect(data.inbox).toHaveLength(0);
    expect(
      db.sqlite.prepare('SELECT status,processed_at FROM inbox_items WHERE id=?').get(id),
    ).toMatchObject({ status: 'processed', processed_at: expect.any(String) });
  });
  it('rolls back task insertion if processing the source fails', async () => {
    await repo.createInbox('Captura');
    const id = (await repo.snapshot()).inbox[0].id;
    db.sqlite.exec(
      "CREATE TRIGGER fail_processing BEFORE UPDATE ON inbox_items BEGIN SELECT RAISE(ABORT, 'disk failure simulation'); END;",
    );
    await expect(repo.convertInbox(id)).rejects.toThrow();
    expect((await repo.snapshot()).tasks).toHaveLength(0);
    expect((await repo.snapshot()).inbox).toHaveLength(1);
  });
  it('preserves a long capture in the description and keeps the converted task editable', async () => {
    const content = 'Uma captura extensa. '.repeat(80);
    await repo.createInbox(content);
    await repo.convertInbox((await repo.snapshot()).inbox[0].id);
    const task = (await repo.snapshot()).tasks[0];
    expect(task.title).toHaveLength(500);
    expect(task.description).toBe(content.trim());
    await repo.updateTask(task.id, { ...task, title: 'Captura organizada' });
    expect((await repo.snapshot()).tasks[0].description).toBe(content.trim());
  });
  it('separates completion of a former series from its historical occurrence', async () => {
    const id = await repo.createTask({ ...input, recurrence: { frequency: 'daily' } });
    await repo.setComplete((await repo.snapshot()).tasks[0], localDate(), true);
    await repo.updateTask(id, input);
    const task = (await repo.snapshot()).tasks[0];
    await repo.setComplete(task, localDate(), true);
    expect(completedTasks(await repo.snapshot())).toHaveLength(2);
    await repo.setComplete(task, localDate(), false);
    expect((await repo.snapshot()).tasks[0].status).toBe('pending');
    expect((await repo.snapshot()).completions).toHaveLength(1);
    await repo.setComplete(task, localDate(), false, true);
    expect((await repo.snapshot()).completions).toHaveLength(0);
  });
  it('keeps Unicode captures editable using the same character count as SQLite', async () => {
    const content = '🎸'.repeat(600);
    await repo.createInbox(content);
    await repo.convertInbox((await repo.snapshot()).inbox[0].id);
    const task = (await repo.snapshot()).tasks[0];
    expect(Array.from(task.title)).toHaveLength(500);
    await repo.updateTask(task.id, task);
    expect((await repo.snapshot()).tasks[0].description).toBe(content);
  });
  it('persists settings with validation', async () => {
    await repo.saveSetting('theme', 'dark');
    await repo.saveSetting('name', 'Ana');
    expect((await repo.snapshot()).settings).toEqual({ name: 'Ana', theme: 'dark' });
    await expect(repo.saveSetting('name', ' ')).rejects.toThrow();
    await expect(repo.saveSetting('theme', 'invalid')).rejects.toThrow();
  });
});
it('survives a real database close/reopen and does not reapply the migration', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'rumo-test-')),
    path = join(folder, 'rumo.db');
  let db = database(path);
  try {
    let repo = new Repository(db.connection);
    const id = await repo.createTask(input);
    for (const title of ['Limpar Downloads', 'Organizar Documentos', 'Limpar desktop'])
      await repo.addSubtask(id, title);
    await repo.createTask({
      ...input,
      title: 'Estudar',
      recurrence: { frequency: 'weekdays', weekdays: [1, 3, 5] },
      due_time: '19:00',
    });
    await repo.createInbox('Comprar pasta térmica');
    await repo.convertInbox((await repo.snapshot()).inbox[0].id);
    await repo.createInbox('Pesquisar depois');
    await repo.setComplete(
      (await repo.snapshot()).tasks.find((t) => t.id === id)!,
      localDate(),
      true,
    );
    await repo.saveSetting('name', 'Gustavo de teste');
    await repo.saveSetting('theme', 'dark');
    const before = await repo.snapshot();
    db.sqlite.close();
    db = database(path);
    repo = new Repository(db.connection);
    expect(await repo.snapshot()).toEqual(before);
  } finally {
    db.sqlite.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
