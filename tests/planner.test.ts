import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { database } from './database';
import { Repository } from '../src/services/repository';
import {
  PlannerRepository,
  FocusRepository,
  defaultBlock,
} from '../src/features/calendar/planner-repository';
import {
  checkpointSeconds,
  layoutOverlaps,
  movedTimes,
} from '../src/features/calendar/planner-domain';
import { CalendarPreferences } from '../src/features/calendar/preferences';
import { parseQuickAdd } from '../src/features/quick-add/parser';
import { NotificationsRepository } from '../src/features/notifications/repository';
import { defaultNotifications } from '../src/features/notifications/domain';
import { TimelineRepository } from '../src/features/timeline/repository';
import { WeeklyReviewRepository } from '../src/features/weekly-review/repository';
import { calendarRange } from '../src/features/calendar/repository';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Daily planning and durable focus', () => {
  let db: ReturnType<typeof database>, planner: PlannerRepository, focus: FocusRepository;
  beforeEach(() => {
    db = database();
    planner = new PlannerRepository(db.connection);
    focus = new FocusRepository(db.connection);
  });
  afterEach(() => db.sqlite.close());
  it('creates multiple blocks without changing task deadlines and moves only planning', async () => {
    const id = await new Repository(db.connection).createTask({
      title: 'Escrever',
      description: '',
      priority: 'normal',
      due_date: '2026-10-02',
      due_time: '12:00',
      recurrence: null,
    });
    const first = await planner.save({
      ...defaultBlock('2026-09-28'),
      entity_type: 'task',
      entity_id: id,
    });
    await planner.save({
      ...defaultBlock('2026-09-28', '14:00'),
      entity_type: 'task',
      entity_id: id,
    });
    await planner.move(first, '2026-09-29', '10:00', '11:00');
    expect(await planner.range('2026-09-28', '2026-09-29')).toHaveLength(2);
    expect(
      db.sqlite.prepare('SELECT due_date,due_time FROM tasks WHERE id=?').get(id),
    ).toMatchObject({ due_date: '2026-10-02', due_time: '12:00' });
    await planner.remove(first);
    expect(db.sqlite.prepare('SELECT id FROM tasks WHERE id=?').get(id)).toBeTruthy();
  });
  it('atomically creates an undated task with a block and rejects invalid times', async () => {
    const id = await planner.createTaskBlock('Estudar', '2026-09-28', '09:00', '10:00');
    expect(
      db.sqlite.prepare('SELECT due_date,due_time FROM tasks WHERE id=?').get(id),
    ).toMatchObject({ due_date: null, due_time: null });
    expect((await planner.range('2026-09-28', '2026-09-28'))[0].entity_id).toBe(id);
    await expect(
      planner.createTaskBlock('Inválida', '2026-09-28', '23:30', '00:30'),
    ).rejects.toThrow();
    expect(db.sqlite.prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({ n: 1 });
  });
  it('keeps a readable block after source deletion', async () => {
    const id = await planner.createTaskBlock('Título preservado', '2026-09-28', '09:00', '10:00');
    db.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(id);
    expect((await planner.range('2026-09-28', '2026-09-28'))[0]).toMatchObject({
      entity_type: null,
      entity_id: null,
      name: 'Título preservado',
    });
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('reflects task completion across duplicated blocks without duplicating the task', async () => {
    const id = await planner.createTaskBlock('Concluir', '2026-09-28', '09:00', '10:00');
    const block = (await planner.range('2026-09-28', '2026-09-28'))[0];
    await planner.duplicate(block, '2026-09-29');
    const repo = new Repository(db.connection),
      task = (await repo.snapshot()).tasks.find((t) => t.id === id)!;
    await repo.setComplete(task, null, true);
    expect((await planner.range('2026-09-28', '2026-09-29')).map((b) => b.completed)).toEqual([
      1, 1,
    ]);
    expect((await repo.snapshot()).tasks).toHaveLength(1);
  });
  it('keeps routine schedules and workout weekdays independent of occurrence planning', async () => {
    db.sqlite.exec(
      "INSERT INTO routines(id,name,frequency,time_of_day,created_at,updated_at) VALUES('routine','Rotina da noite','daily','21:00','2026','2026'); INSERT INTO workout_plans(id,name,active,created_at,updated_at) VALUES('plan','Plano',1,'2026','2026'); INSERT INTO workout_days(id,workout_plan_id,name,created_at,updated_at) VALUES('upper','plan','Upper','2026','2026'); INSERT INTO workout_day_weekdays VALUES('upper',1)",
    );
    const routine = await planner.save({
      ...defaultBlock('2026-09-28', '20:00'),
      entity_type: 'routine',
      entity_id: 'routine',
      occurrence_date: '2026-09-28',
    });
    const workout = await planner.save({
      ...defaultBlock('2026-09-28', '18:00'),
      entity_type: 'workout',
      entity_id: 'upper',
      occurrence_date: '2026-09-28',
    });
    await planner.move(workout, '2026-09-29', '19:00', '20:00');
    expect(db.sqlite.prepare('SELECT weekday FROM workout_day_weekdays').get()).toMatchObject({
      weekday: 1,
    });
    expect(db.sqlite.prepare('SELECT time_of_day FROM routines').get()).toMatchObject({
      time_of_day: '21:00',
    });
    expect(
      (await calendarRange(db.connection, '2026-09-28', '2026-09-28')).filter(
        (i) => i.kind === 'routine',
      ),
    ).toHaveLength(1);
    await planner.remove(routine);
    expect(db.sqlite.prepare('SELECT id FROM routines').get()).toMatchObject({ id: 'routine' });
  });
  it('queries only the selected period with a multi-year planning dataset', async () => {
    db.sqlite.exec('BEGIN');
    const insert = db.sqlite.prepare(
      "INSERT INTO planner_time_blocks(id,block_date,start_time,end_time,title,created_at,updated_at) VALUES(?,?,'09:00','09:30','Sintético','2026','2026')",
    );
    for (let i = 0; i < 5000; i++) insert.run(String(i), i < 4990 ? '2025-01-01' : '2026-09-28');
    db.sqlite.exec('COMMIT');
    const started = performance.now();
    expect(await planner.visibleRange('2026-09-28', '2026-10-04')).toHaveLength(10);
    expect(await planner.plannedSeconds('2026-09-28', '2026-10-04')).toBe(18000);
    const elapsed = performance.now() - started;
    console.info('Planner: 5000 blocks, week query and summary:', Math.round(elapsed), 'ms');
    expect(elapsed).toBeLessThan(1500);
  });
  it('persists block visibility without deleting planning', async () => {
    await planner.save({ ...defaultBlock('2026-09-28'), title: 'Leitura' });
    await db.connection.execute(
      "INSERT INTO calendar_source_preferences(source_type,visible) VALUES('block',0)",
    );
    expect(await planner.visibleRange('2026-09-28', '2026-09-28')).toEqual([]);
    expect(await planner.range('2026-09-28', '2026-09-28')).toHaveLength(1);
    expect(
      (await new CalendarPreferences(db.connection).sources()).find(
        (s) => s.source_type === 'block',
      )?.visible,
    ).toBe(0);
  });
  it('records elapsed time exactly once, excluding pauses and offline gaps', async () => {
    const s = await focus.start('Leitura', null, null, '2026-09-28T10:00:00.000Z');
    await focus.checkpoint(s.id, '2026-09-28T10:00:05.000Z');
    await focus.checkpoint(s.id, '2026-09-28T10:00:05.000Z');
    await focus.pause(s.id, '2026-09-28T10:00:10.000Z');
    expect((await focus.open())?.focused_seconds).toBe(10);
    await focus.resume(s.id, '2026-09-28T11:00:00.000Z');
    await focus.checkpoint(s.id, '2026-09-28T11:00:05.000Z');
    await focus.checkpoint(s.id, '2026-09-28T12:00:00.000Z');
    await focus.finish(s.id, '2026-09-28T12:00:05.000Z');
    expect(
      db.sqlite.prepare('SELECT focused_seconds,status FROM focus_sessions WHERE id=?').get(s.id),
    ).toMatchObject({ focused_seconds: 20, status: 'completed' });
    await focus.finish(s.id, '2026-09-28T13:00:00.000Z');
    expect(
      db.sqlite.prepare('SELECT focused_seconds FROM focus_sessions WHERE id=?').get(s.id),
    ).toMatchObject({ focused_seconds: 20 });
  });
  it('recovers running focus paused and enforces a single open session', async () => {
    const s = await focus.start('Primeira', null, null, '2026-09-28T10:00:00.000Z');
    await focus.checkpoint(s.id, '2026-09-28T10:00:05.000Z');
    await expect(focus.start('Segunda')).rejects.toThrow();
    expect(await focus.recover()).toMatchObject({ id: s.id, status: 'paused', focused_seconds: 5 });
    expect(checkpointSeconds('2026-09-28T10:00:00Z', '2026-09-29T10:00:00Z')).toBe(0);
  });
  it('preserves the recurring task occurrence even after its block is deleted', async () => {
    const repo = new Repository(db.connection);
    const id = await repo.createTask({
      title: 'Diária',
      description: '',
      priority: 'normal',
      due_date: '2026-09-01',
      due_time: null,
      recurrence: { frequency: 'daily' },
    });
    const block = await planner.save({
      ...defaultBlock('2026-09-28'),
      entity_type: 'task',
      entity_id: id,
      occurrence_date: '2026-09-27',
    });
    const session = await focus.start('Diária', id, block, '2026-09-28T10:00:00Z');
    expect(session.occurrence_date).toBe('2026-09-27');
    await planner.remove(block);
    expect(await focus.recover()).toMatchObject({
      occurrence_date: '2026-09-27',
      time_block_id: null,
    });
    await focus.finish(session.id);
    expect(
      (await focus.start('Diária', id, null, '2026-09-28T10:00:00Z', '2026-09-26')).occurrence_date,
    ).toBe('2026-09-26');
  });
  it('lays conflicts side by side and keeps duration when dragging near midnight', () => {
    const rows = layoutOverlaps([
      { id: 'a', start_time: '09:00', end_time: '10:00' },
      { id: 'b', start_time: '09:30', end_time: '10:30' },
      { id: 'c', start_time: '10:30', end_time: '11:00' },
    ]);
    expect(rows.map((r) => [r.column, r.columns, r.conflict])).toEqual([
      [0, 2, true],
      [1, 2, true],
      [0, 1, false],
    ]);
    expect(movedTimes('09:00', '10:00', 1435)).toEqual({ start: '23:00', end: '24:00' });
  });
  it('parses duration and explicit free blocks without silently crossing midnight', () => {
    expect(parseQuickAdd('Estudar amanhã 09:00 por 1h', 'auto', '2026-09-28')).toEqual({
      kind: 'task',
      title: 'Estudar',
      date: '2026-09-29',
      time: '09:00',
      endTime: '10:00',
    });
    expect(parseQuickAdd('/bloco Almoço 12:30 1h', 'auto', '2026-09-28')).toEqual({
      kind: 'block',
      title: 'Almoço',
      date: '2026-09-28',
      time: '12:30',
      endTime: '13:30',
    });
    expect(parseQuickAdd('/bloco Trabalho 23:30 1h', 'auto', '2026-09-28').kind).toBe('inbox');
  });
  it('upgrades schema 14 without changing any existing table rows', () => {
    const folder = mkdtempSync(join(tmpdir(), 'rumo-planner-upgrade-'));
    let old: ReturnType<typeof database> | undefined,
      upgraded: ReturnType<typeof database> | undefined;
    try {
      const path = join(folder, 'upgrade.db');
      old = database(path, 14);
      old.sqlite.exec(
        "INSERT INTO tasks(id,title,created_at,updated_at) VALUES('old-task','Preservar','2026','2026'); INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES('old-thought','Nota','Conteúdo','2026','2026'); UPDATE settings SET value='Validação' WHERE key='name'; INSERT INTO calendar_source_preferences VALUES('habit',0)",
      );
      const names = old.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='test_migrations'",
        )
        .all()
        .map((r) => String(r.name));
      const snapshot = Object.fromEntries(
        names.map((n) => [n, old!.sqlite.prepare(`SELECT * FROM "${n}" ORDER BY rowid`).all()]),
      );
      old.sqlite.close();
      old = undefined;
      upgraded = database(path, 15);
      for (const n of names)
        expect(upgraded.sqlite.prepare(`SELECT * FROM "${n}" ORDER BY rowid`).all(), n).toEqual(
          snapshot[n],
        );
      expect(upgraded.sqlite.prepare('PRAGMA integrity_check').get()).toMatchObject({
        integrity_check: 'ok',
      });
      expect(upgraded.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      old?.sqlite.close();
      upgraded?.sqlite.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it('preserves blocks and focus checkpoints after closing and reopening SQLite', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'rumo-focus-restart-'));
    let disk: ReturnType<typeof database> | undefined;
    try {
      const path = join(folder, 'restart.db');
      disk = database(path);
      const p = new PlannerRepository(disk.connection),
        f = new FocusRepository(disk.connection);
      await p.save({ ...defaultBlock('2026-09-28'), title: 'Retomar' });
      const s = await f.start('Retomar', null, null, '2026-09-28T10:00:00Z');
      await f.checkpoint(s.id, '2026-09-28T10:00:10Z');
      disk.sqlite.close();
      disk = database(path);
      expect(await new FocusRepository(disk.connection).recover()).toMatchObject({
        id: s.id,
        status: 'paused',
        focused_seconds: 10,
      });
      expect(
        await new PlannerRepository(disk.connection).range('2026-09-28', '2026-09-28'),
      ).toHaveLength(1);
    } finally {
      disk?.sqlite.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it('delivers local block reminders once, respecting opt-in', async () => {
    await planner.save({
      ...defaultBlock('2026-09-28', '09:00'),
      title: 'Leitura',
      remind_minutes_before: 5,
    });
    const repo = new NotificationsRepository(db.connection);
    const now = new Date('2026-09-28T08:55:00');
    expect(await repo.due(now, defaultNotifications)).toEqual([]);
    const rows = await repo.due(now, { ...defaultNotifications, enabled: true, blocks: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('blocks');
    expect(await repo.claim(rows[0])).toBe(true);
    expect(await repo.claim(rows[0])).toBe(false);
  });
  it('adds completed focus to Timeline and weekly review without treating planning as execution', async () => {
    await planner.save({ ...defaultBlock('2026-09-28'), title: 'Leitura' });
    const s = await focus.start('Leitura', null, null, '2026-09-28T10:00:00Z');
    await focus.checkpoint(s.id, '2026-09-28T10:00:10Z');
    await focus.finish(s.id, '2026-09-28T10:00:15Z');
    const timeline = await new TimelineRepository(db.connection).page({
      from: '2026-09-28',
      to: '2026-09-28',
      source: 'focus',
    });
    expect(timeline.events).toHaveLength(1);
    const review = await new WeeklyReviewRepository(db.connection).load('2026-09-28');
    expect(review.planning).toEqual({ plannedSeconds: 1800, focusedSeconds: 15 });
  });
});
