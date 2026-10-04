import { expect, it } from 'vitest';
import { database } from './database';
import { PlannerRepository } from '../src/features/calendar/planner-repository';
import { AutomationsRepository } from '../src/features/automations/repository';
import { MonthlyReviewRepository } from '../src/features/monthly-review/repository';
import { ObjectivesRepository } from '../src/features/objectives/repository';
import { MilestonesRepository } from '../src/features/objectives/milestones-repository';
import { TimelineRepository } from '../src/features/timeline/repository';
import { WeeklyReviewRepository } from '../src/features/weekly-review/repository';
import { mkdirSync, writeFileSync } from 'node:fs';
import { addDays } from '../src/lib/dates';
it('measures bounded queries in an isolated multi-module dataset', async () => {
  const db = database(),
    at = '2026-09-01T00:00:00.000Z';
  try {
    db.sqlite.exec('BEGIN');
    const task = db.sqlite.prepare(
      "INSERT INTO tasks(id,title,due_date,created_at,updated_at) VALUES(?,?, '2026-09-29',?,?)",
    );
    for (let i = 0; i < 5000; i++) task.run(`task-${i}`, `Tarefa sintética ${i}`, at, at);
    const block = db.sqlite.prepare(
      "INSERT INTO planner_time_blocks(id,title,block_date,start_time,end_time,created_at,updated_at) VALUES(?,?,'2026-09-29','09:00','10:00',?,?)",
    );
    for (let i = 0; i < 1000; i++) block.run(`block-${i}`, `Bloco ${i}`, at, at);
    const series = db.sqlite.prepare(
      "INSERT INTO planner_time_block_series(id,title,start_date,start_time,end_time,recurrence_json,created_at,updated_at) VALUES(?,?,'2026-09-01','19:00','20:00',?,?,?)",
    );
    for (let i = 0; i < 500; i++)
      series.run(
        `series-${i}`,
        `Série ${i}`,
        JSON.stringify({ frequency: 'daily', interval: 1, weekdays: [], until: null, count: null }),
        at,
        at,
      );
    const objective = db.sqlite.prepare(
      "INSERT INTO objectives(id,name,start_date,created_at,updated_at) VALUES(?,?,'2026-09-01',?,?)",
    );
    for (let i = 0; i < 200; i++) objective.run(`objective-${i}`, `Objetivo ${i}`, at, at);
    const milestone = db.sqlite.prepare(
      'INSERT INTO objective_milestones(id,objective_id,title,created_at,updated_at) VALUES(?,?,?,?,?)',
    );
    for (let i = 0; i < 1000; i++)
      milestone.run(`milestone-${i}`, `objective-${i % 200}`, `Marco ${i}`, at, at);
    const rule = db.sqlite.prepare(
      "INSERT INTO automation_rules(id,name,trigger_type,trigger_config,action_type,action_config,created_at,updated_at) VALUES(?,?,'schedule',?,'task',?,?,?)",
    );
    for (let i = 0; i < 100; i++)
      rule.run(
        `rule-${i}`,
        `Regra ${i}`,
        JSON.stringify({ mode: 'daily', time: '19:00' }),
        JSON.stringify({ title: 'Ação sintética' }),
        at,
        at,
      );
    const log = db.sqlite.prepare(
      "INSERT INTO automation_executions(id,automation_id,occurrence_key,scheduled_for,executed_at,status,action_type,action_config) VALUES(?,?,?,?,?,'ignored','task','{}')",
    );
    for (let i = 0; i < 10000; i++)
      log.run(`execution-${i}`, `rule-${i % 100}`, `past-${i}`, at, at);
    const steps = db.sqlite.prepare(
      'INSERT INTO daily_activity_entries(entry_date,steps,created_at,updated_at) VALUES(?,?,?,?)',
    );
    const focus = db.sqlite.prepare(
      "INSERT INTO focus_sessions(id,title,started_at,ended_at,focused_seconds,status,last_checkpoint,created_at) VALUES(?,?,?,?,1800,'completed',?,?)",
    );
    for (let i = 0; i < 29; i++) {
      const day = addDays('2026-09-01', i);
      steps.run(day, 8000 + i, at, at);
      focus.run(
        `focus-${i}`,
        'Foco sintético',
        `${day}T09:00:00Z`,
        `${day}T09:30:00Z`,
        `${day}T09:30:00Z`,
        at,
      );
    }
    db.sqlite.exec('COMMIT');
    const timings: Record<string, number> = {};
    async function measure<T>(name: string, action: () => Promise<T>) {
      const start = performance.now();
      const value = await action();
      timings[name] = Math.round((performance.now() - start) * 100) / 100;
      return value;
    }
    const planner = new PlannerRepository(db.connection);
    expect(
      await measure('dayPlannerMs', () => planner.range('2026-09-29', '2026-09-29')),
    ).toHaveLength(1500);
    expect(
      await measure('weekPlannerMs', () => planner.range('2026-09-28', '2026-10-04')),
    ).toHaveLength(4500);
    expect(
      await measure('tenDayExpansionMs', () => planner.range('2026-09-20', '2026-09-29')),
    ).toHaveLength(6000);
    await measure('automationDueProcessingMs', () =>
      new AutomationsRepository(db.connection).process(new Date('2026-09-29T19:00:30')),
    );
    await measure('monthlyReviewMs', () =>
      new MonthlyReviewRepository(db.connection).load('2026-09-01', '2026-09-29'),
    );
    await measure('objectivesMs', () => new ObjectivesRepository(db.connection).list());
    await measure('milestonesMs', () =>
      new MilestonesRepository(db.connection).list('objective-0'),
    );
    await measure('timelineMs', () =>
      new TimelineRepository(db.connection).page({ from: '2026-09-01', to: '2026-09-29' }),
    );
    await measure('weeklyReviewMs', () =>
      new WeeklyReviewRepository(db.connection).load('2026-09-29', '2026-09-29'),
    );
    mkdirSync('artifacts/v150', { recursive: true });
    writeFileSync(
      'artifacts/v150/performance.json',
      JSON.stringify(
        {
          dataset: {
            tasks: 5000,
            timeBlocks: 1000,
            series: 500,
            objectives: 200,
            milestones: 1000,
            automations: 100,
            executionRecords: 10000,
            daysOfStepsAndFocus: 29,
          },
          timings,
          scope: 'SQLite queries and local domain processing; no native rendering measurement',
        },
        null,
        2,
      ),
    );
    expect(db.sqlite.prepare('PRAGMA integrity_check').get()).toMatchObject({
      integrity_check: 'ok',
    });
    console.log('v150 query timings', JSON.stringify(timings));
  } finally {
    db.sqlite.close();
  }
}, 30000);
