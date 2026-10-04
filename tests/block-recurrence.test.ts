import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { database } from './database';
import { BlockSeriesRepository } from '../src/features/calendar/block-series-repository';
import {
  expandBlockDates,
  defaultBlockRecurrence,
  recurringBlockId,
} from '../src/features/calendar/block-recurrence';
import {
  PlannerRepository,
  FocusRepository,
  defaultBlock,
} from '../src/features/calendar/planner-repository';
import { NotificationsRepository } from '../src/features/notifications/repository';
import { defaultNotifications } from '../src/features/notifications/domain';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
describe('Recurring time reservations', () => {
  let db: ReturnType<typeof database>, series: BlockSeriesRepository, planner: PlannerRepository;
  beforeEach(() => {
    db = database();
    series = new BlockSeriesRepository(db.connection);
    planner = new PlannerRepository(db.connection);
  });
  afterEach(() => db.sqlite.close());
  const draft = () => ({ ...defaultBlock('2026-09-28', '19:00', 60), title: 'Estudar' });
  const weekly = () => ({ ...defaultBlockRecurrence(), weekdays: [1, 3, 5] });
  it('expands only Monday Wednesday Friday in a week, without storing occurrences', async () => {
    await series.save(draft(), weekly());
    expect((await planner.range('2026-09-28', '2026-10-04')).map((b) => b.block_date)).toEqual([
      '2026-09-28',
      '2026-09-30',
      '2026-10-02',
    ]);
    expect(db.sqlite.prepare('SELECT count(*) n FROM planner_time_blocks').get()).toMatchObject({
      n: 0,
    });
  });
  it('supports daily interval, weekdays, end date and count', () => {
    expect(
      expandBlockDates('2026-09-28', '2026-09-28', '2026-10-04', {
        ...weekly(),
        frequency: 'daily',
        interval: 2,
        count: 2,
      }),
    ).toEqual(['2026-09-28', '2026-09-30']);
    expect(
      expandBlockDates('2026-09-28', '2026-09-28', '2026-10-04', {
        ...weekly(),
        frequency: 'weekdays',
        until: '2026-10-02',
      }),
    ).toHaveLength(5);
    expect(
      expandBlockDates('2026-09-28', '2026-10-01', '2026-10-08', { ...weekly(), count: 3 }),
    ).toEqual(['2026-10-02']);
  });
  it('clamps monthly day 31 and returns to 31 after February', () => {
    expect(
      expandBlockDates('2026-01-31', '2026-01-01', '2026-03-31', {
        ...weekly(),
        frequency: 'monthly',
      }),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  it('moves and resizes only Wednesday, including movement outside source query range', async () => {
    const id = await series.save(draft(), weekly());
    await planner.move(recurringBlockId(id, '2026-09-30'), '2026-10-06', '20:00', '21:30');
    expect((await planner.range('2026-09-28', '2026-10-04')).map((b) => b.block_date)).toEqual([
      '2026-09-28',
      '2026-10-02',
    ]);
    expect((await planner.range('2026-10-06', '2026-10-06'))[0]).toMatchObject({
      start_time: '20:00',
      end_time: '21:30',
      occurrence_date: '2026-09-30',
    });
    expect((await series.get(id))?.start_time).toBe('19:00');
  });
  it('cancels one occurrence and archives future series while preserving past and Focus', async () => {
    const id = await series.save(draft(), weekly());
    await planner.remove(recurringBlockId(id, '2026-09-30'));
    const focus = new FocusRepository(db.connection);
    const session = await focus.start(
      'Estudar',
      null,
      recurringBlockId(id, '2026-09-28'),
      '2026-09-28T22:00:00Z',
    );
    await focus.finish(session.id, '2026-09-28T22:00:10Z');
    await series.archive(id, '2026-10-01');
    expect((await planner.range('2026-09-28', '2026-10-04')).map((b) => b.block_date)).toEqual([
      '2026-09-28',
    ]);
    expect(
      db.sqlite.prepare('SELECT time_block_id,time_block_series_id FROM focus_sessions').get(),
    ).toMatchObject({ time_block_id: null, time_block_series_id: id });
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('edits whole series while preserving independently edited exceptions', async () => {
    const id = await series.save(draft(), weekly());
    await planner.move(recurringBlockId(id, '2026-09-30'), '2026-09-30', '20:00', '21:00');
    await series.save({ ...draft(), start_time: '18:00', end_time: '19:00' }, weekly(), id);
    expect((await planner.range('2026-09-28', '2026-10-04')).map((b) => b.start_time)).toEqual([
      '18:00',
      '20:00',
      '18:00',
    ]);
  });
  it('does not couple Task deadlines with block recurrence or completion', async () => {
    db.sqlite.exec(
      "INSERT INTO tasks(id,title,due_date,created_at,updated_at) VALUES('t','Tarefa','2026-10-15','2026-09-28','2026-09-28')",
    );
    const id = await series.save({ ...draft(), entity_type: 'task', entity_id: 't' }, weekly());
    await planner.move(recurringBlockId(id, '2026-09-30'), '2026-10-01', '20:00', '21:00');
    expect(db.sqlite.prepare("SELECT due_date FROM tasks WHERE id='t'").get()).toMatchObject({
      due_date: '2026-10-15',
    });
    db.sqlite.exec("DELETE FROM tasks WHERE id='t'");
    expect((await planner.range('2026-09-28', '2026-09-28'))[0]).toMatchObject({
      name: 'Tarefa',
      entity_type: null,
    });
  });
  it('reuses notification opt-in and delivery idempotency for virtual occurrences', async () => {
    await series.save({ ...draft(), remind_minutes_before: 0 }, weekly());
    const repo = new NotificationsRepository(db.connection),
      now = new Date(2026, 8, 28, 19, 0);
    const reminders = await repo.due(now, { ...defaultNotifications, enabled: true, blocks: true });
    expect(reminders).toHaveLength(1);
    expect(await repo.claim(reminders[0])).toBe(true);
    expect(await repo.claim(reminders[0])).toBe(false);
  });
  it('rejects malformed rules and invalid source links', async () => {
    await expect(series.save(draft(), { ...weekly(), interval: 0 })).rejects.toThrow();
    await expect(
      series.save({ ...draft(), entity_type: 'task', entity_id: 'missing' }, weekly()),
    ).rejects.toThrow();
  });
  it('counts distant finite recurrence mathematically without expanding historical years', () => {
    expect(
      expandBlockDates('2000-01-31', '2026-09-01', '2026-09-30', {
        ...weekly(),
        frequency: 'monthly',
        count: 10,
      }),
    ).toEqual([]);
    expect(
      expandBlockDates('2026-09-30', '2026-10-01', '2026-10-20', {
        ...weekly(),
        interval: 2,
        count: 3,
      }),
    ).toEqual(['2026-10-02', '2026-10-12']);
  });
  it('queries 500 rules and 5000 requested occurrences in bounded batches', async () => {
    const sql = db.sqlite.prepare(
      'INSERT INTO planner_time_block_series(id,start_date,start_time,end_time,title,recurrence_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    );
    db.sqlite.exec('BEGIN');
    for (let i = 0; i < 500; i++)
      sql.run(
        `series-${i}`,
        '2026-01-01',
        '19:00',
        '20:00',
        `Estudar ${i}`,
        JSON.stringify({ ...weekly(), frequency: 'daily' }),
        '2026-01-01',
        '2026-01-01',
      );
    db.sqlite.exec('COMMIT');
    let queries = 0;
    const measured = {
      ...db.connection,
      select: async <T>(query: string, values: unknown[] = []) => {
        queries++;
        return db.connection.select<T>(query, values);
      },
    };
    const start = performance.now(),
      rows = await new BlockSeriesRepository(measured).range('2026-09-21', '2026-09-30'),
      elapsed = performance.now() - start;
    expect(rows).toHaveLength(5000);
    expect(queries).toBe(6);
    expect(elapsed).toBeLessThan(2000);
    console.info(
      `Recurring rules SQLite + expansion: 500 series, 5000 occurrences, ${elapsed.toFixed(2)} ms, ${queries} queries (not native rendering).`,
    );
  });
  it('preserves rules, moved exceptions and Focus association across closing and reopening SQLite', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'rumo-recurring-test-')),
      path = join(folder, 'isolated.db');
    let stored = database(path);
    try {
      const repo = new BlockSeriesRepository(stored.connection),
        id = await repo.save(draft(), weekly());
      await new PlannerRepository(stored.connection).move(
        recurringBlockId(id, '2026-09-30'),
        '2026-09-30',
        '20:00',
        '21:30',
      );
      const focus = new FocusRepository(stored.connection),
        session = await focus.start(
          'Estudar',
          null,
          recurringBlockId(id, '2026-09-30'),
          '2026-09-30T23:00:00Z',
        );
      await focus.pause(session.id, '2026-09-30T23:00:10Z');
      stored.sqlite.close();
      stored = database(path);
      const rows = await new PlannerRepository(stored.connection).range('2026-09-28', '2026-10-04');
      expect(rows.map((b) => [b.block_date, b.start_time, b.end_time])).toEqual([
        ['2026-09-28', '19:00', '20:00'],
        ['2026-09-30', '20:00', '21:30'],
        ['2026-10-02', '19:00', '20:00'],
      ]);
      expect(await new FocusRepository(stored.connection).open()).toMatchObject({
        id: session.id,
        status: 'paused',
        focused_seconds: 10,
      });
      expect(
        stored.sqlite
          .prepare('SELECT time_block_series_id,time_block_series_date FROM focus_sessions')
          .get(),
      ).toMatchObject({ time_block_series_id: id, time_block_series_date: '2026-09-30' });
      expect(stored.sqlite.prepare('PRAGMA integrity_check').get()).toMatchObject({
        integrity_check: 'ok',
      });
    } finally {
      stored.sqlite.close();
      unlinkSync(path);
      rmdirSync(folder);
    }
  });
});
