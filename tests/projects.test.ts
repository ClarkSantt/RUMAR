import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { database } from './database';
import { ProjectsRepository } from '../src/features/projects/repository';
import { Repository } from '../src/services/repository';
import type { ProjectInput } from '../src/features/projects/types';

const input: ProjectInput = {
  name: 'Reset da Vida',
  description: 'Organização pessoal',
  start_date: '2026-09-01',
  target_date: '2026-12-31',
};
describe('Projetos e relações no SQLite real', () => {
  let db: ReturnType<typeof database>, repo: ProjectsRepository, tasks: Repository;
  beforeEach(() => {
    db = database();
    repo = new ProjectsRepository(db.connection);
    tasks = new Repository(db.connection);
  });
  afterEach(() => db.sqlite.close());
  async function task(
    projectId: string,
    sectionId: string | null = null,
    title = 'Organizar arquivos',
  ) {
    return tasks.createTask({
      title,
      description: '',
      priority: 'normal',
      due_date: null,
      due_time: null,
      recurrence: null,
      project_id: projectId,
      project_section_id: sectionId,
    });
  }
  it('cria e edita datas e mantém progresso vazio sem inventar tarefas', async () => {
    const id = await repo.create(input);
    expect((await repo.list())[0]).toMatchObject({
      ...input,
      task_count: 0,
      completed_count: 0,
      next_task: null,
      status: 'active',
    });
    await repo.update(id, { ...input, name: 'Casa', target_date: '2027-01-01' });
    expect((await repo.list())[0]).toMatchObject({ name: 'Casa', target_date: '2027-01-01' });
    await expect(repo.create({ ...input, name: ' ' })).rejects.toThrow();
    await expect(repo.update(id, { ...input, target_date: '2025-01-01' })).rejects.toThrow();
  });
  it('pausa, conclui, reabre e arquiva com datas coerentes', async () => {
    const id = await repo.create(input);
    await repo.setStatus(id, 'paused');
    expect(await repo.list('paused')).toHaveLength(1);
    await repo.setStatus(id, 'completed');
    expect((await repo.list('completed'))[0].completed_at).toBeTruthy();
    await repo.setStatus(id, 'active');
    expect((await repo.list())[0].completed_at).toBeNull();
    await repo.setStatus(id, 'archived');
    expect(await repo.list()).toHaveLength(0);
    expect(await repo.list('archived')).toHaveLength(1);
    await repo.setStatus(id, 'active');
    expect((await repo.list())[0].archived_at).toBeNull();
  });
  it('exige confirmação para concluir pendências e não conclui tarefas', async () => {
    const id = await repo.create(input);
    await task(id);
    await expect(repo.setStatus(id, 'completed')).rejects.toThrow('Confirme');
    expect((await repo.list())[0].status).toBe('active');
    await repo.setStatus(id, 'completed', true);
    expect((await tasks.snapshot()).tasks[0].status).toBe('pending');
  });
  it('deriva progresso e próxima tarefa pela ordem das seções e tarefas', async () => {
    const id = await repo.create(input),
      a = await repo.createSection(id, 'Casa'),
      b = await repo.createSection(id, 'Digital');
    await task(id, b, 'Segunda seção');
    const first = await task(id, a, 'Primeira seção');
    expect((await repo.list())[0]).toMatchObject({
      task_count: 2,
      completed_count: 0,
      next_task: 'Primeira seção',
    });
    const row = (await tasks.snapshot()).tasks.find((t) => t.id === first)!;
    await tasks.setComplete(row, null, true);
    expect((await repo.list())[0]).toMatchObject({
      task_count: 2,
      completed_count: 1,
      next_task: 'Segunda seção',
    });
    await tasks.archiveTask(first);
    expect((await repo.list())[0].task_count).toBe(1);
  });
  it('renomeia, reordena e exclui seções preservando tarefas no projeto', async () => {
    const id = await repo.create(input),
      a = await repo.createSection(id, 'Casa'),
      b = await repo.createSection(id, 'Digital');
    await task(id, a);
    await repo.renameSection(a, 'Lar');
    await repo.moveSection(id, b, -1);
    expect((await repo.sections(id)).map((s) => s.name)).toEqual(['Digital', 'Lar']);
    await repo.deleteSection(a);
    expect((await tasks.snapshot()).tasks[0]).toMatchObject({
      project_id: id,
      project_section_id: null,
    });
  });
  it('impede seção de outro projeto e permite mover tarefa corretamente', async () => {
    const a = await repo.create(input),
      b = await repo.create({ ...input, name: 'Outro' }),
      section = await repo.createSection(a, 'Casa');
    await expect(task(b, section)).rejects.toThrow();
    const id = await task(a, section),
      row = (await tasks.snapshot()).tasks[0];
    await tasks.updateTask(id, { ...row, project_id: b, project_section_id: null });
    expect((await tasks.snapshot()).tasks[0]).toMatchObject({
      project_id: b,
      project_section_id: null,
    });
  });
  it('exclusão padrão desvincula tarefas e remove seções', async () => {
    const id = await repo.create(input),
      section = await repo.createSection(id, 'Casa');
    await task(id, section);
    await repo.remove(id);
    expect(await repo.list()).toEqual([]);
    expect(await repo.sections(id)).toEqual([]);
    expect((await tasks.snapshot()).tasks[0]).toMatchObject({
      project_id: null,
      project_section_id: null,
    });
  });
  it('exclusão explícita remove tarefas e subtarefas atomicamente', async () => {
    const id = await repo.create(input),
      tid = await task(id);
    await tasks.addSubtask(tid, 'Etapa');
    await repo.remove(id, true);
    expect(await repo.list()).toEqual([]);
    expect((await tasks.snapshot()).tasks).toEqual([]);
    expect((await tasks.snapshot()).subtasks).toEqual([]);
  });
  it('falha na exclusão reverte também remoção de tarefas', async () => {
    const id = await repo.create(input);
    await task(id);
    db.sqlite.exec(
      "CREATE TRIGGER reject_project_delete AFTER DELETE ON projects BEGIN SELECT RAISE(ABORT,'forced failure'); END",
    );
    await expect(repo.remove(id, true)).rejects.toThrow('forced failure');
    expect(await repo.list()).toHaveLength(1);
    expect((await tasks.snapshot()).tasks).toHaveLength(1);
    expect(
      db.sqlite.prepare('SELECT delete_tasks FROM projects WHERE id=?').get(id)?.delete_tasks,
    ).toBe(0);
  });
});
