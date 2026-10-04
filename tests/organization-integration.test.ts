import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './database';
import { Repository } from '../src/services/repository';
import { convertInboxTo } from '../src/features/inbox/conversions';
import { calendarRange } from '../src/features/calendar/repository';
import { ProjectsRepository } from '../src/features/projects/repository';
import { HabitsRepository } from '../src/features/habits/repository';
import { RoutinesRepository } from '../src/features/routines/repository';
import { addDays, localDate } from '../src/lib/dates';

it('aplica migration 2 em arquivo da Fase 1 sem alterar nenhum valor existente, inclusive após reabrir', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rumo-upgrade-'));
  const path = join(directory, 'rumo.db');
  let db = database(path, 1);
  try {
    const stamp = '2026-09-01T10:00:00.000Z';
    db.sqlite
      .prepare('INSERT INTO inbox_items(id,content,created_at,updated_at) VALUES(?,?,?,?)')
      .run('capture', 'Captura original com acentos', stamp, stamp);
    db.sqlite
      .prepare(
        'INSERT INTO tasks(id,title,description,due_date,due_time,recurrence,created_at,updated_at,source_inbox_id) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        'recurring',
        'Guitarra',
        'Descrição preservada',
        '2026-09-01',
        '19:30',
        JSON.stringify({ frequency: 'weekdays', weekdays: [1, 3, 5] }),
        stamp,
        stamp,
        'capture',
      );
    db.sqlite
      .prepare(
        'INSERT INTO tasks(id,title,status,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run('done', 'Tarefa concluída', 'completed', stamp, stamp, stamp);
    db.sqlite
      .prepare(
        'INSERT INTO subtasks(id,task_id,title,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run('sub', 'recurring', 'Praticar acordes', 2.5, stamp, stamp);
    db.sqlite
      .prepare('INSERT INTO task_completions VALUES(?,?,?)')
      .run('recurring', '2026-09-02', stamp);
    db.sqlite
      .prepare('INSERT INTO subtask_completions VALUES(?,?,?)')
      .run('sub', '2026-09-02', stamp);
    db.sqlite
      .prepare('UPDATE settings SET value=?,updated_at=? WHERE key=?')
      .run('dark', stamp, 'theme');
    db.sqlite
      .prepare('UPDATE settings SET value=?,updated_at=? WHERE key=?')
      .run('Pessoa de teste', stamp, 'name');
    const tables = [
      'tasks',
      'subtasks',
      'task_completions',
      'subtask_completions',
      'inbox_items',
      'settings',
    ];
    const before = tables.map((table) => ({
      table,
      columns: (db.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
      rows: db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    }));
    db.sqlite.close();
    db = database(path, 2);
    for (const { table, columns, rows } of before)
      expect(
        db.sqlite.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY rowid`).all(),
      ).toEqual(rows);
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.sqlite.prepare('SELECT version FROM test_migrations ORDER BY version').all()).toEqual(
      [{ version: 1 }, { version: 2 }],
    );
    const repo = new Repository(db.connection),
      project = await new ProjectsRepository(db.connection).create({
        name: 'Novo projeto',
        description: '',
        start_date: null,
        target_date: null,
      });
    await repo.updateTask('recurring', {
      ...(await repo.snapshot()).tasks.find((t) => t.id === 'recurring')!,
      project_id: project,
      project_section_id: null,
    });
    db.sqlite.close();
    db = database(path, 2);
    const reopened = await new Repository(db.connection).snapshot(true);
    expect(reopened.tasks.find((t) => t.id === 'recurring')).toMatchObject({
      project_id: project,
      recurrence: { frequency: 'weekdays', weekdays: [1, 3, 5] },
    });
    expect(reopened.completions).toHaveLength(1);
    expect(reopened.subtaskCompletions).toHaveLength(1);
    expect(reopened.settings).toEqual({ name: 'Pessoa de teste', theme: 'dark' });
    expect(db.sqlite.prepare('SELECT count(*) AS count FROM test_migrations').get()?.count).toBe(2);
  } finally {
    db.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Conversões da Inbox em SQLite', () => {
  let db: ReturnType<typeof database>, repo: Repository;
  beforeEach(() => {
    db = database();
    repo = new Repository(db.connection);
  });
  afterEach(() => db.sqlite.close());
  async function capture(content = 'Um plano pessoal') {
    await repo.createInbox(content);
    return (await repo.snapshot()).inbox[0].id;
  }
  it.each(['project', 'thought'] as const)(
    'converte em %s uma vez, preserva conteúdo longo e bloqueia outro destino',
    async (target) => {
      const content = 'Texto longo com acentos e 🎸.\n'.repeat(120),
        id = await capture(content);
      const [first, again] = await Promise.all([
        convertInboxTo(db.connection, id, target),
        convertInboxTo(db.connection, id, target),
      ]);
      expect(first).toBe(again);
      const table = target === 'project' ? 'projects' : 'thoughts',
        field = target === 'project' ? 'description' : 'content';
      const rows = db.sqlite.prepare(`SELECT * FROM ${table} WHERE source_inbox_id=?`).all(id);
      expect(rows).toHaveLength(1);
      expect(rows[0][field]).toBe(content.trim());
      expect(
        db.sqlite.prepare('SELECT status,processed_at FROM inbox_items WHERE id=?').get(id),
      ).toMatchObject({ status: 'processed', processed_at: expect.any(String) });
      await expect(
        convertInboxTo(db.connection, id, target === 'project' ? 'thought' : 'project'),
      ).rejects.toThrow();
      await expect(repo.convertInbox(id)).rejects.toThrow();
      expect(
        db.sqlite
          .prepare(
            `SELECT count(*) AS count FROM ${target === 'project' ? 'thoughts' : 'projects'}`,
          )
          .get()?.count,
      ).toBe(0);
    },
  );
  it.each(['project', 'thought'] as const)(
    'reverte destino e processamento quando conversão %s falha',
    async (target) => {
      const id = await capture(),
        before = db.sqlite.prepare('SELECT * FROM inbox_items WHERE id=?').get(id),
        table = target === 'project' ? 'projects' : 'thoughts';
      db.sqlite.exec(
        `CREATE TRIGGER reject_conversion AFTER UPDATE OF status ON inbox_items WHEN NEW.status='processed' BEGIN SELECT RAISE(ABORT,'forced failure'); END`,
      );
      await expect(convertInboxTo(db.connection, id, target)).rejects.toThrow('forced failure');
      expect(db.sqlite.prepare('SELECT * FROM inbox_items WHERE id=?').get(id)).toEqual(before);
      expect(db.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count).toBe(0);
      db.sqlite.exec('DROP TRIGGER reject_conversion');
      await convertInboxTo(db.connection, id, target === 'project' ? 'thought' : 'project');
      expect((await repo.snapshot()).inbox).toHaveLength(0);
    },
  );
  it('cliques concorrentes em destinos diferentes produzem somente um resultado', async () => {
    const id = await capture();
    const results = await Promise.allSettled([
      convertInboxTo(db.connection, id, 'project'),
      convertInboxTo(db.connection, id, 'thought'),
      repo.convertInbox(id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const counts = ['projects', 'thoughts', 'tasks'].map((table) =>
      Number(
        db.sqlite.prepare(`SELECT count(*) AS count FROM ${table} WHERE source_inbox_id=?`).get(id)
          ?.count,
      ),
    );
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
  });
});

describe('Calendário como agregação dos registros reais', () => {
  let db: ReturnType<typeof database>;
  beforeEach(() => {
    db = database();
  });
  afterEach(() => db.sqlite.close());
  it('combina quatro entidades, recorrência e estados sem duplicar nem materializar calendário', async () => {
    const day = localDate(),
      previous = addDays(day, -1),
      tasks = new Repository(db.connection),
      habits = new HabitsRepository(db.connection),
      routines = new RoutinesRepository(db.connection),
      projects = new ProjectsRepository(db.connection);
    const taskId = await tasks.createTask({
      title: 'Praticar',
      description: '',
      priority: 'normal',
      due_date: previous,
      due_time: '18:30',
      recurrence: { frequency: 'daily' },
    });
    await tasks.setComplete((await tasks.snapshot()).tasks[0], day, true);
    const habitId = await habits.save({
      name: 'Água',
      description: '',
      frequency: 'daily',
      weekdays: [],
      weekly_target: 7,
      kind: 'quantity',
      target_value: 2,
      unit: 'litros',
      start_date: previous,
      end_date: null,
      project_id: null,
      active: 1,
    });
    await habits.record(habitId, day, 2);
    const routineId = await routines.save({
        name: 'Noite',
        description: '',
        frequency: 'daily',
        weekdays: [],
        time_of_day: '22:00',
        active: 1,
      }),
      item = await routines.addItem(routineId, 'Preparar amanhã'),
      occurrence = await routines.start(routineId, day);
    await routines.toggle(occurrence.id, item, true);
    await routines.complete(occurrence.id);
    const projectId = await projects.create({
      name: 'Reset',
      description: '',
      start_date: previous,
      target_date: day,
    });
    const entries = await calendarRange(db.connection, previous, day),
      today = entries.filter((e) => e.date === day);
    expect(today.map((e) => e.kind).sort()).toEqual(['habit', 'project', 'routine', 'task']);
    expect(today.find((e) => e.id === taskId)).toMatchObject({ time: '18:30', completed: true });
    expect(today.find((e) => e.id === habitId)?.completed).toBe(true);
    expect(today.find((e) => e.id === routineId)?.completed).toBe(true);
    expect(today.find((e) => e.id === projectId)?.completed).toBe(false);
    expect(entries.filter((e) => e.id === taskId)).toHaveLength(2);
    expect(entries.find((e) => e.id === taskId && e.date === previous)?.completed).toBe(false);
    expect(new Set(entries.map((e) => `${e.kind}:${e.id}:${e.date}`)).size).toBe(entries.length);
    expect(await calendarRange(db.connection, previous, day)).toEqual(entries);
    expect(
      db.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%calendar%' AND name NOT LIKE 'google_calendar_%' AND name NOT IN ('calendar_source_preferences','calendar_visibility_overrides','external_calendar_events')",
        )
        .all(),
    ).toEqual([]);
  });
  it('reflete edição, conclusão e arquivo sem eventos obsoletos', async () => {
    const day = localDate(),
      next = addDays(day, 1),
      tasks = new Repository(db.connection),
      projects = new ProjectsRepository(db.connection);
    const input = {
        title: 'Original',
        description: '',
        priority: 'normal' as const,
        due_date: day,
        due_time: '08:00',
        recurrence: null,
      },
      id = await tasks.createTask(input),
      project = await projects.create({
        name: 'Prazo',
        description: '',
        start_date: null,
        target_date: day,
      });
    expect(await calendarRange(db.connection, day, day)).toHaveLength(2);
    await tasks.updateTask(id, { ...input, title: 'Editada', due_date: next, due_time: '10:00' });
    await projects.update(project, {
      name: 'Prazo alterado',
      description: '',
      start_date: null,
      target_date: next,
    });
    expect(await calendarRange(db.connection, day, day)).toEqual([]);
    const moved = await calendarRange(db.connection, next, next);
    expect(moved).toHaveLength(2);
    expect(moved.find((e) => e.id === id)).toMatchObject({ name: 'Editada', time: '10:00' });
    await tasks.archiveTask(id);
    await projects.setStatus(project, 'archived');
    expect(await calendarRange(db.connection, day, next)).toEqual([]);
  });
});
