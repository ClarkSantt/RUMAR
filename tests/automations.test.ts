import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { database } from './database';
import { AutomationsRepository } from '../src/features/automations/repository';
import {
  scheduledOccurrence,
  nextOccurrence,
  validateRule,
  type RuleDraft,
} from '../src/features/automations/domain';
import { Repository } from '../src/services/repository';
import { NotificationsRepository } from '../src/features/notifications/repository';
import { defaultNotifications, displayReminder } from '../src/features/notifications/domain';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const now = new Date('2026-09-27T19:00:30');
const created = new Date('2026-09-01T00:00:00');
const draft = (extra: Partial<RuleDraft> = {}): RuleDraft => ({
  name: 'Revisão semanal',
  enabled: true,
  trigger_type: 'schedule',
  trigger_config: { mode: 'weekly', weekday: 0, time: '19:00' },
  conditions: {},
  action_type: 'task',
  action_config: { title: 'Fazer revisão semanal' },
  missed_policy: 'ignore',
  ...extra,
});
describe('Safe local automations', () => {
  let db: ReturnType<typeof database>, repo: AutomationsRepository;
  beforeEach(() => {
    db = database();
    repo = new AutomationsRepository(db.connection);
  });
  afterEach(() => db.sqlite.close());
  it('creates edits disables and removes a rule without deleting generated entities', async () => {
    const id = await repo.save(draft(), undefined, created);
    expect((await repo.list())[0].enabled).toBe(true);
    await repo.process(now);
    expect(db.sqlite.prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({ n: 1 });
    await repo.save(draft({ name: 'Nome alterado' }), id, now);
    await repo.enable(id, false);
    await repo.process(new Date('2026-10-04T19:00:30'));
    expect(db.sqlite.prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({ n: 1 });
    await repo.remove(id);
    expect(await repo.list()).toEqual([]);
    expect(db.sqlite.prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({ n: 1 });
  });
  it('claims a scheduled occurrence exactly once even with concurrent callers', async () => {
    const id = await repo.save(draft(), undefined, created);
    await Promise.all([repo.process(now), repo.process(now)]);
    await repo.process(new Date('2026-09-27T19:01:00'));
    expect(await repo.logs(id)).toHaveLength(1);
    expect(db.sqlite.prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({ n: 1 });
  });
  it('handles daily weekly monthly clamp and a single specific date', () => {
    for (const config of [
      { mode: 'daily' as const, time: '19:00' },
      { mode: 'weekly' as const, weekday: 0, time: '19:00' },
      { mode: 'once' as const, date: '2026-09-27', time: '19:00' },
    ])
      expect(scheduledOccurrence(config, now, 'ignore', created.toISOString())).not.toBeNull();
    expect(
      scheduledOccurrence(
        { mode: 'monthly', month_day: 31, time: '19:00' },
        new Date('2026-09-30T19:00:10'),
        'ignore',
        created.toISOString(),
      )?.key,
    ).toBe('schedule:2026-09-30:19:00');
    expect(nextOccurrence({ mode: 'once', date: '2026-09-01', time: '09:00' }, now)).toBeNull();
  });
  it('ignores missed runs by default and optionally replays only the latest once', async () => {
    const late = new Date('2026-09-29T12:00:00');
    await repo.save(draft(), undefined, created);
    const catchup = await repo.save(
      draft({ name: 'Pendente', missed_policy: 'latest' }),
      undefined,
      created,
    );
    await repo.process(late);
    await repo.process(late);
    expect(await repo.logs(catchup)).toHaveLength(1);
    expect(db.sqlite.prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({ n: 1 });
  });
  it('matches durable events and project conditions without modifying the source task', async () => {
    db.sqlite
      .prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Projeto',?,?)")
      .run(created.toISOString(), created.toISOString());
    const objective = 'o';
    db.sqlite
      .prepare(
        "INSERT INTO objectives(id,name,start_date,created_at,updated_at) VALUES(?,'Objetivo','2026-09-01',?,?)",
      )
      .run(objective, created.toISOString(), created.toISOString());
    const rule = await repo.save(
      draft({
        trigger_type: 'task_created',
        trigger_config: {},
        conditions: { project_id: 'p' },
        action_type: 'link',
        action_config: { objective_id: objective },
      }),
      undefined,
      created,
    );
    db.sqlite
      .prepare(
        "INSERT INTO tasks(id,title,project_id,created_at,updated_at) VALUES('t','Tarefa','p',?,?)",
      )
      .run(now.toISOString(), now.toISOString());
    await repo.process(now);
    await repo.process(now);
    expect(
      db.sqlite.prepare("SELECT entity_id FROM objective_links WHERE objective_id='o'").get(),
    ).toMatchObject({ entity_id: 't' });
    expect((await repo.logs(rule))[0].status).toBe('done');
  });
  it('persists ignored conditions and prevents task creation loops beyond depth three', async () => {
    const rule = await repo.save(
      draft({
        trigger_type: 'task_created',
        trigger_config: {},
        action_config: { title: 'Encadeada' },
      }),
      undefined,
      created,
    );
    db.sqlite
      .prepare("INSERT INTO tasks(id,title,created_at,updated_at) VALUES('t','Origem',?,?)")
      .run(now.toISOString(), now.toISOString());
    await repo.process(now);
    await repo.process(now);
    expect(db.sqlite.prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({ n: 4 });
    const logs = await repo.logs(rule);
    expect(logs.filter((l) => l.status === 'done')).toHaveLength(3);
    expect(logs.some((l) => l.status === 'ignored' && l.reason.includes('encadeamento'))).toBe(
      true,
    );
  });
  it('rolls back failed actions, logs a technical failure, and keeps other rules working', async () => {
    const bad = await repo.save(
      draft({
        action_type: 'moment',
        action_config: { title: 'Momento', objective_id: 'missing' },
      }),
      undefined,
      created,
    );
    await repo.save(draft({ name: 'Outra' }), undefined, created);
    await repo.process(now);
    expect((await repo.logs(bad))[0].status).toBe('failed');
    expect(db.sqlite.prepare('SELECT count(*) n FROM timeline_notes').get()).toMatchObject({
      n: 0,
    });
    expect(db.sqlite.prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({ n: 1 });
  });
  it('rejects executable configs and unsupported destructive actions', () => {
    expect(() =>
      validateRule(draft({ action_type: 'shell' as RuleDraft['action_type'] })),
    ).toThrow();
    expect(() =>
      validateRule(
        draft({
          action_config: { title: 'A', sql: 'DROP TABLE tasks' } as RuleDraft['action_config'],
        }),
      ),
    ).toThrow();
    expect(() =>
      validateRule(draft({ trigger_config: { mode: 'weekly', weekday: 8, time: '19:00' } })),
    ).toThrow();
  });
  it('does not replay existing historical events when creating a new rule', async () => {
    await new Repository(db.connection).createTask({
      title: 'Antiga',
      description: '',
      priority: 'normal',
      due_date: null,
      due_time: null,
      recurrence: null,
    });
    await repo.save(
      draft({ trigger_type: 'task_created', trigger_config: {} }),
      undefined,
      new Date('2099-01-01'),
    );
    await repo.process(new Date('2099-01-02'));
    expect(db.sqlite.prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({ n: 1 });
  });
  it('queues notifications through the existing engine, respecting opt-in privacy and one delivery', async () => {
    await repo.save(
      draft({ action_type: 'notification', action_config: { title: 'Lembrete' } }),
      undefined,
      created,
    );
    await repo.process(now);
    const notifications = new NotificationsRepository(db.connection);
    expect(await notifications.due(now, defaultNotifications)).toEqual([]);
    const prefs = { ...defaultNotifications, enabled: true, automations: true };
    const reminders = await notifications.due(now, prefs);
    expect(reminders.filter((r) => r.category === 'automations')).toHaveLength(1);
    const reminder = reminders.find((r) => r.category === 'automations')!;
    expect(displayReminder(reminder, prefs).body).toBe('Você tem um lembrete.');
    expect(await notifications.claim(reminder)).toBe(true);
    expect(await notifications.claim(reminder)).toBe(false);
  });
  it('keeps rule and execution idempotency after reopening a file database', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'rumo-automations-')),
      path = join(folder, 'test.db');
    let file: ReturnType<typeof database> | undefined;
    try {
      file = database(path);
      const id = await new AutomationsRepository(file.connection).save(draft(), undefined, created);
      await new AutomationsRepository(file.connection).process(now);
      file.sqlite.close();
      file = database(path);
      await new AutomationsRepository(file.connection).process(now);
      expect(await new AutomationsRepository(file.connection).logs(id)).toHaveLength(1);
      expect(file.sqlite.prepare('SELECT count(*) n FROM tasks').get()).toMatchObject({ n: 1 });
      expect(file.sqlite.prepare('PRAGMA integrity_check').get()).toMatchObject({
        integrity_check: 'ok',
      });
    } finally {
      file?.sqlite.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it('recovers a missed deadline before today reminder time with its original occurrence key', async () => {
    const rule = await repo.save(
      draft({
        trigger_type: 'task_due',
        trigger_config: { days: 1, time: '09:00' },
        missed_policy: 'latest',
      }),
      undefined,
      created,
    );
    db.sqlite
      .prepare(
        "INSERT INTO tasks(id,title,due_date,created_at,updated_at) VALUES('due','Pagar','2026-09-30',?,?)",
      )
      .run(created.toISOString(), created.toISOString());
    const reopened = new Date('2026-09-30T08:00:00');
    await repo.process(reopened);
    await repo.process(reopened);
    const logs = await repo.logs(rule);
    expect(logs).toHaveLength(1);
    expect(logs[0].scheduled_for).toBe(new Date('2026-09-29T09:00:00').toISOString());
    expect(logs[0].status).toBe('done');
  });
  it('selects the latest already due recurring reminder instead of a future one', async () => {
    const rule = await repo.save(
      draft({
        trigger_type: 'task_due',
        trigger_config: { days: 1, time: '09:00' },
        missed_policy: 'latest',
      }),
      undefined,
      created,
    );
    db.sqlite
      .prepare(
        "INSERT INTO tasks(id,title,due_date,recurrence,created_at,updated_at) VALUES('repeat','Diária','2026-09-01',?,?,?)",
      )
      .run(JSON.stringify({ frequency: 'daily' }), created.toISOString(), created.toISOString());
    const reopened = new Date('2026-09-30T08:00:00');
    await repo.process(reopened);
    await repo.process(reopened);
    const logs = await repo.logs(rule);
    expect(logs).toHaveLength(1);
    expect(logs[0].scheduled_for).toBe(new Date('2026-09-29T09:00:00').toISOString());
    expect(
      db.sqlite
        .prepare('SELECT occurrence_key FROM automation_executions WHERE automation_id=?')
        .get(rule),
    ).toMatchObject({ occurrence_key: 'task_due:repeat:2026-09-30' });
  });
  it('emits a derived milestone crossing once and recalculates after a correction', async () => {
    db.sqlite
      .prepare(
        "INSERT INTO objectives(id,name,start_date,created_at,updated_at) VALUES('o','Carro','2026-09-01',?,?)",
      )
      .run(created.toISOString(), created.toISOString());
    db.sqlite
      .prepare(
        "INSERT INTO finance_goals(id,name,target_amount_cents,created_at,updated_at) VALUES('g','Carro',3000000,?,?)",
      )
      .run(created.toISOString(), created.toISOString());
    db.sqlite
      .prepare(
        "INSERT INTO objective_milestones(id,objective_id,title,mode,target_value,unit,financial_goal_id,created_at,updated_at) VALUES('m','o','10.000','financial_goal',10000,'BRL','g',?,?)",
      )
      .run(created.toISOString(), created.toISOString());
    const rule = await repo.save(
      draft({
        trigger_type: 'milestone_completed',
        trigger_config: {},
        action_type: 'moment',
        action_config: { title: 'Marco atingido' },
      }),
      undefined,
      created,
    );
    const contribute = db.sqlite.prepare(
      "INSERT INTO finance_goal_contributions(id,goal_id,date,amount_cents,created_at) VALUES(?,'g','2026-09-27',?,?)",
    );
    contribute.run('a', 500000, now.toISOString());
    contribute.run('b', 500000, now.toISOString());
    await repo.process(now);
    await repo.process(now);
    expect(await repo.logs(rule)).toHaveLength(1);
    db.sqlite
      .prepare("UPDATE finance_goal_contributions SET amount_cents=100000 WHERE id='b'")
      .run();
    contribute.run('c', 400000, now.toISOString());
    await repo.process(now);
    expect(await repo.logs(rule)).toHaveLength(2);
  });
  it('advances notification batches past deliveries already claimed', async () => {
    const rule = await repo.save(
      draft({ action_type: 'notification', action_config: { title: 'Aviso' } }),
      undefined,
      created,
    );
    const insert = db.sqlite.prepare(
      "INSERT INTO automation_executions(id,automation_id,occurrence_key,scheduled_for,executed_at,status,action_type,action_config) VALUES(?,?,?,?,?,'done','notification',?)",
    );
    for (let i = 0; i < 105; i++)
      insert.run(
        `delivery-${i}`,
        rule,
        `batch-${i}`,
        now.toISOString(),
        now.toISOString(),
        JSON.stringify({ title: 'Aviso' }),
      );
    const notifications = new NotificationsRepository(db.connection),
      prefs = { ...defaultNotifications, enabled: true, automations: true };
    const first = await notifications.due(now, prefs);
    expect(first).toHaveLength(100);
    for (const reminder of first) await notifications.claim(reminder);
    const second = await notifications.due(now, prefs);
    expect(second).toHaveLength(5);
    expect(second.every((r) => !first.some((f) => f.key === r.key))).toBe(true);
  });
  it('uses completed occurrence status for a recurring task event', async () => {
    const rule = await repo.save(
      draft({
        trigger_type: 'task_completed',
        trigger_config: {},
        conditions: { status: 'completed' },
        action_type: 'moment',
        action_config: { title: 'Ocorrência concluída' },
      }),
      undefined,
      created,
    );
    db.sqlite
      .prepare(
        "INSERT INTO tasks(id,title,due_date,recurrence,created_at,updated_at) VALUES('recurring','Diária','2026-09-27',?, ?,?)",
      )
      .run(
        JSON.stringify({ frequency: 'daily', interval: 1 }),
        now.toISOString(),
        now.toISOString(),
      );
    db.sqlite
      .prepare(
        "INSERT INTO task_completions(task_id,occurrence_date,completed_at) VALUES('recurring','2026-09-27',?)",
      )
      .run(now.toISOString());
    await repo.process(now);
    expect((await repo.logs(rule))[0].status).toBe('done');
    expect(db.sqlite.prepare("SELECT status FROM tasks WHERE id='recurring'").get()).toMatchObject({
      status: 'pending',
    });
    expect(db.sqlite.prepare('SELECT count(*) n FROM timeline_notes').get()).toMatchObject({
      n: 1,
    });
  });
});
