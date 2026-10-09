import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { database } from './database';
import { PlanningRepository } from '../src/features/planning/repository';
import { HabitsRepository } from '../src/features/habits/repository';
import { PlannerRepository } from '../src/features/calendar/planner-repository';

const opened: ReturnType<typeof database>[] = [];
const open = (path = ':memory:', version = 29) => {
  const value = database(path, version);
  opened.push(value);
  return value;
};
afterEach(() => {
  while (opened.length) opened.pop()!.sqlite.close();
});

describe('planning foundation', () => {
  it('creates the new schema with integrity and no foreign-key violations', () => {
    const db = open();
    expect(db.sqlite.prepare('PRAGMA integrity_check').get()).toMatchObject({
      integrity_check: 'ok',
    });
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='planning_templates'").get(),
    ).toBeTruthy();
    expect(db.sqlite.prepare('PRAGMA table_info(planner_time_blocks)').all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'schedule_kind' }),
        expect.objectContaining({ name: 'status' }),
        expect.objectContaining({ name: 'source_type' }),
      ]),
    );
  });

  it('upgrades schema 28 while preserving routine and habit history', () => {
    const folder = mkdtempSync(join(tmpdir(), 'rumar-planning-'));
    const path = join(folder, 'legacy.sqlite');
    const legacy = open(path, 28);
    legacy.sqlite.exec(`
      INSERT INTO routines(id,name,frequency,created_at,updated_at) VALUES('routine','Manhã','daily','2026','2026');
      INSERT INTO routine_items(id,routine_id,title,sort_order,created_at,updated_at) VALUES('step','routine','Água',0,'2026','2026');
      INSERT INTO routine_occurrences(id,routine_id,occurrence_date,started_at,completed_at) VALUES('occurrence','routine','2026-10-01','2026','2026');
      INSERT INTO routine_item_completions(occurrence_id,item_id,completed_at) VALUES('occurrence','step','2026');
      INSERT INTO habits(id,name,frequency,kind,start_date,created_at,updated_at) VALUES('habit','Ler','daily','boolean','2026-01-01','2026','2026');
      INSERT INTO habit_entries(habit_id,entry_date,value,updated_at) VALUES('habit','2026-10-01',1,'2026');
    `);
    legacy.sqlite.close();
    opened.pop();
    const upgraded = open(path, 29);
    expect(
      upgraded.sqlite.prepare('SELECT name,legacy_routine_id FROM planning_templates').get(),
    ).toMatchObject({ name: 'Manhã', legacy_routine_id: 'routine' });
    expect(
      upgraded.sqlite.prepare('SELECT count(*) n FROM routine_occurrences').get(),
    ).toMatchObject({ n: 1 });
    expect(
      upgraded.sqlite.prepare('SELECT count(*) n FROM routine_item_completions').get(),
    ).toMatchObject({ n: 1 });
    expect(upgraded.sqlite.prepare('SELECT count(*) n FROM habit_entries').get()).toMatchObject({
      n: 1,
    });
    upgraded.sqlite.close();
    opened.pop();
    rmSync(folder, { recursive: true, force: true });
  });

  it('plans tasks and projects repeatedly without changing their completion', async () => {
    const db = open();
    const repo = new PlanningRepository(db.connection);
    db.sqlite.exec(
      "INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Projeto','2026','2026'); INSERT INTO tasks(id,title,status,project_id,created_at,updated_at) VALUES('t','Tarefa','pending','p','2026','2026')",
    );
    const draft = {
      date: '2026-10-08',
      title: 'Tarefa',
      notes: '',
      schedule: 'fixed' as const,
      startTime: '09:00',
      endTime: '09:30',
      dayPeriod: null,
      sourceType: 'task' as const,
      sourceId: 't',
    };
    const first = await repo.save(draft);
    await repo.save({ ...draft, startTime: '14:00', endTime: '14:30' });
    await repo.save({
      ...draft,
      title: 'Projeto',
      schedule: 'flexible',
      startTime: null,
      endTime: null,
      sourceType: 'project',
      sourceId: 'p',
    });
    await repo.setStatus(first, 'completed');
    expect(await repo.list('2026-10-08', '2026-10-08')).toHaveLength(3);
    expect(db.sqlite.prepare("SELECT status FROM tasks WHERE id='t'").get()).toMatchObject({
      status: 'pending',
    });
    expect(db.sqlite.prepare('SELECT count(*) n FROM planning_history').get()).toMatchObject({
      n: 1,
    });
  });

  it('supports standalone fixed, period and flexible items in the shared calendar store', async () => {
    const db = open();
    const repo = new PlanningRepository(db.connection);
    const calendar = new PlannerRepository(db.connection);
    await repo.save({
      date: '2026-10-08',
      title: 'Foco',
      notes: '',
      schedule: 'fixed',
      startTime: '10:00',
      endTime: '11:00',
      dayPeriod: null,
      sourceType: 'standalone',
      sourceId: null,
    });
    await repo.save({
      date: '2026-10-08',
      title: 'Resolver',
      notes: '',
      schedule: 'period',
      startTime: null,
      endTime: null,
      dayPeriod: 'afternoon',
      sourceType: 'standalone',
      sourceId: null,
    });
    await repo.save({
      date: '2026-10-08',
      title: 'Quando puder',
      notes: '',
      schedule: 'flexible',
      startTime: null,
      endTime: null,
      dayPeriod: null,
      sourceType: 'standalone',
      sourceId: null,
    });
    expect((await repo.list('2026-10-08', '2026-10-08')).map((i) => i.schedule_kind)).toEqual([
      'fixed',
      'period',
      'flexible',
    ]);
    expect(await calendar.range('2026-10-08', '2026-10-08')).toHaveLength(3);
  });

  it('supports all habit tracking types and only auto-completes an unambiguous occurrence', async () => {
    const db = open();
    const habits = new HabitsRepository(db.connection);
    const planning = new PlanningRepository(db.connection);
    const ids: Record<string, string> = {};
    for (const [name, tracking, kind, target, unit] of [
      ['check', 'check', 'boolean', 1, ''],
      ['quantity', 'quantity', 'quantity', 8, 'copos'],
      ['duration', 'duration', 'quantity', 30, 'minutos'],
      ['frequency', 'frequency', 'boolean', 1, 'vezes'],
    ] as const) {
      ids[name] = await habits.save({
        name,
        description: '',
        frequency: tracking === 'frequency' ? 'weekly_target' : 'daily',
        weekdays: [1, 2, 3, 4, 5],
        weekly_target: 3,
        kind,
        tracking_type: tracking,
        target_value: target,
        unit,
        start_date: '2026-01-01',
        end_date: null,
        project_id: null,
        active: 1,
      });
    }
    await planning.save({
      date: '2026-10-08',
      title: 'Quantidade',
      notes: '',
      schedule: 'flexible',
      startTime: null,
      endTime: null,
      dayPeriod: null,
      sourceType: 'habit',
      sourceId: ids.quantity,
    });
    await habits.record(ids.quantity, '2026-10-08', 8);
    expect((await planning.list('2026-10-08', '2026-10-08'))[0].status).toBe('completed');
    await planning.save({
      date: '2026-10-08',
      title: 'Duração 1',
      notes: '',
      schedule: 'flexible',
      startTime: null,
      endTime: null,
      dayPeriod: null,
      sourceType: 'habit',
      sourceId: ids.duration,
    });
    await planning.save({
      date: '2026-10-08',
      title: 'Duração 2',
      notes: '',
      schedule: 'period',
      startTime: null,
      endTime: null,
      dayPeriod: 'evening',
      sourceType: 'habit',
      sourceId: ids.duration,
    });
    await habits.record(ids.duration, '2026-10-08', 30);
    expect(
      (await planning.list('2026-10-08', '2026-10-08'))
        .filter((i) => i.source_id === ids.duration)
        .every((i) => i.status === 'planned'),
    ).toBe(true);
  });

  it('migrates legacy routines into reusable single or expanded models', async () => {
    const db = open();
    const repo = new PlanningRepository(db.connection);
    const id = await repo.saveTemplate({
      name: 'Saída',
      description: 'Preparar',
      default_mode: 'single',
      active: 1,
    });
    await repo.addTemplateItem(id, 'Chaves');
    await repo.addTemplateItem(id, 'Água');
    const single = await repo.applyTemplate(id, '2026-10-08', 'single');
    expect(await repo.checklist(single[0])).toHaveLength(2);
    expect(await repo.applyTemplate(id, '2026-10-09', 'expanded')).toHaveLength(2);
  });
});
