import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { database } from './database';
import { localDate, addDays } from '../src/lib/dates';
import { Repository } from '../src/services/repository';
import { PlanningRepository } from '../src/features/planning/repository';
import { HabitsRepository } from '../src/features/habits/repository';
import { PlansRepository } from '../src/features/workouts/repositories/plans';
import { SessionsRepository } from '../src/features/workouts/repositories/sessions';
import { ProjectsRepository } from '../src/features/projects/repository';
import { ThoughtsRepository } from '../src/features/thoughts/repository';
import { TimelineRepository } from '../src/features/timeline/repository';
import { HomeRepository } from '../src/features/home/repository';
import { WeeklyReviewRepository } from '../src/features/weekly-review/repository';

const planningDraft = (date: string, title: string) => ({
  date,
  title,
  notes: '',
  schedule: 'fixed' as const,
  startTime: '09:00',
  endTime: '10:00',
  dayPeriod: null,
  sourceType: 'standalone' as const,
  sourceId: null,
});

const habitDraft = (date: string, name: string, target = 1) => ({
  name,
  description: '',
  frequency: 'daily' as const,
  weekdays: [],
  weekly_target: 1,
  kind: target === 1 ? ('boolean' as const) : ('quantity' as const),
  target_value: target,
  unit: target === 1 ? '' : 'páginas',
  start_date: addDays(date, -30),
  end_date: null,
  project_id: null,
  active: 1,
});

describe('Phase 2 cross-module integrations', () => {
  let db: ReturnType<typeof database>;
  beforeEach(() => {
    db = database();
  });
  afterEach(() => db.sqlite.close());

  it('completes one linked Planning occurrence and one linked Habit from a Workout exactly once', async () => {
    const day = localDate();
    const habits = new HabitsRepository(db.connection);
    const habit = await habits.save(habitDraft(day, 'TESTE RUMAR - Academia'));
    const plans = new PlansRepository(db.connection);
    const plan = await plans.save({
      name: 'TESTE RUMAR - Workout Push',
      description: '',
      habit_id: habit,
    });
    const workoutDay = await plans.saveDay(plan, {
      name: 'Push',
      weekday: new Date().getDay(),
      notes: '',
    });
    await plans.saveExercise(workoutDay, {
      exercise_id: 'builtin-bench',
      target_sets: 1,
      min_reps: 6,
      max_reps: 10,
      rest_seconds: 90,
      notes: '',
    });
    const planning = new PlanningRepository(db.connection);
    const block = await planning.save({
      ...planningDraft(day, 'Push'),
      sourceType: 'workout',
      sourceId: workoutDay,
    });
    const sessions = new SessionsRepository(db.connection);
    const session = await sessions.start(workoutDay);
    await sessions.finish(session);
    await sessions.finish(session);

    expect(await planning.get(block)).toMatchObject({ status: 'completed' });
    expect(await habits.entries(day, day, habit)).toEqual([
      expect.objectContaining({ value: 1, source_workout_session_id: session }),
    ]);
    expect(
      db.sqlite
        .prepare(
          "SELECT event_type,COUNT(*) count FROM activity_events WHERE event_type IN('workout.completed','habit.completed','planning.completed') GROUP BY event_type ORDER BY event_type",
        )
        .all(),
    ).toEqual([
      { event_type: 'habit.completed', count: 1 },
      { event_type: 'planning.completed', count: 1 },
      { event_type: 'workout.completed', count: 1 },
    ]);
  });

  it('does not guess which Planning occurrence a Workout should complete', async () => {
    const day = localDate();
    const plans = new PlansRepository(db.connection);
    const plan = await plans.save({ name: 'TESTE RUMAR - Push', description: '', habit_id: null });
    const workoutDay = await plans.saveDay(plan, { name: 'Push', weekday: null, notes: '' });
    await plans.saveExercise(workoutDay, {
      exercise_id: 'builtin-bench',
      target_sets: 1,
      min_reps: 6,
      max_reps: 10,
      rest_seconds: 90,
      notes: '',
    });
    const planning = new PlanningRepository(db.connection);
    await planning.save({
      ...planningDraft(day, 'Push A'),
      sourceType: 'workout',
      sourceId: workoutDay,
    });
    await planning.save({
      ...planningDraft(day, 'Push B'),
      startTime: '11:00',
      endTime: '12:00',
      sourceType: 'workout',
      sourceId: workoutDay,
    });
    const sessions = new SessionsRepository(db.connection);
    const session = await sessions.start(workoutDay);
    await sessions.finish(session);
    expect((await planning.list(day, day)).map((item) => item.status)).toEqual([
      'planned',
      'planned',
    ]);
  });

  it('completes exactly one Planning occurrence when a quantitative Habit reaches its target', async () => {
    const day = localDate();
    const habits = new HabitsRepository(db.connection);
    const habit = await habits.save(habitDraft(day, 'TESTE RUMAR - Leitura', 20));
    const planning = new PlanningRepository(db.connection);
    const block = await planning.save({
      ...planningDraft(day, 'Leitura'),
      sourceType: 'habit',
      sourceId: habit,
    });
    await habits.record(habit, day, 12);
    expect(await planning.get(block)).toMatchObject({ status: 'planned' });
    await habits.record(habit, day, 20);
    await habits.record(habit, day, 20);
    expect(await planning.get(block)).toMatchObject({ status: 'completed' });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) count FROM activity_events WHERE event_type='habit.completed'")
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it('keeps Task state and future occurrences independent from Planning completion', async () => {
    const day = localDate();
    const tasks = new Repository(db.connection);
    const taskId = await tasks.createTask({
      title: 'TESTE RUMAR - Task',
      description: '',
      priority: 'high',
      due_date: day,
      due_time: null,
      recurrence: null,
    });
    const planning = new PlanningRepository(db.connection);
    const today = await planning.save({
      ...planningDraft(day, 'Task'),
      sourceType: 'task',
      sourceId: taskId,
    });
    const future = await planning.save({
      ...planningDraft(addDays(day, 1), 'Task futura'),
      sourceType: 'task',
      sourceId: taskId,
    });
    await planning.setStatus(today, 'completed');
    expect((await tasks.snapshot()).tasks.find((task) => task.id === taskId)?.status).toBe(
      'pending',
    );
    expect(await planning.get(future)).toMatchObject({ status: 'planned', source_active: 1 });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) count FROM activity_events WHERE event_type='planning.completed'")
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it('records Task and Project completion while preserving future Planning history', async () => {
    const day = localDate();
    const tasks = new Repository(db.connection);
    const taskId = await tasks.createTask({
      title: 'TESTE RUMAR - Task',
      description: '',
      priority: 'normal',
      due_date: day,
      due_time: null,
      recurrence: null,
    });
    const task = (await tasks.snapshot()).tasks.find((item) => item.id === taskId)!;
    const projects = new ProjectsRepository(db.connection);
    const projectId = await projects.create({
      name: 'TESTE RUMAR - Project',
      description: '',
      start_date: null,
      target_date: null,
    });
    const planning = new PlanningRepository(db.connection);
    const taskFuture = await planning.save({
      ...planningDraft(addDays(day, 1), 'Task futura'),
      sourceType: 'task',
      sourceId: taskId,
    });
    const projectFuture = await planning.save({
      ...planningDraft(addDays(day, 1), 'Projeto futuro'),
      startTime: '11:00',
      endTime: '12:00',
      sourceType: 'project',
      sourceId: projectId,
    });
    await tasks.setComplete(task, null, true);
    await projects.setStatus(projectId, 'completed');

    expect(await planning.sourceOptions('task')).toEqual([]);
    expect(await planning.sourceOptions('project')).toEqual([]);
    expect(await planning.get(taskFuture)).toMatchObject({ status: 'planned', source_active: 0 });
    expect(await planning.get(projectFuture)).toMatchObject({
      status: 'planned',
      source_active: 0,
    });
    expect(
      db.sqlite
        .prepare(
          "SELECT event_type FROM activity_events WHERE event_type IN('task.completed','project.completed') ORDER BY event_type",
        )
        .all(),
    ).toEqual([{ event_type: 'project.completed' }, { event_type: 'task.completed' }]);
  });

  it('orders, filters and paginates the universal Timeline', async () => {
    const now = new Date();
    const day = localDate(now);
    const insert = db.sqlite.prepare(
      `INSERT INTO activity_events(id,idempotency_key,event_type,occurred_at,event_date,source_type,source_id,title,summary,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    );
    insert.run(
      '1',
      'one',
      'task.completed',
      `${day}T09:00:00`,
      day,
      'task',
      'task',
      'Tarefa concluída',
      'A',
      `${day}T09:00:00`,
    );
    insert.run(
      '2',
      'two',
      'workout.completed',
      `${day}T10:00:00`,
      day,
      'workout',
      'workout',
      'Treino concluído',
      'B',
      `${day}T10:00:00`,
    );
    insert.run(
      '3',
      'three',
      'thought.created',
      `${day}T11:00:00`,
      day,
      'thought',
      'thought',
      'Pensamento registrado',
      '',
      `${day}T11:00:00`,
    );
    const timeline = new TimelineRepository(db.connection);
    const first = await timeline.page({ from: day, to: day, limit: 2 });
    expect(first.events.map((event) => event.id)).toEqual(['3', '2']);
    expect(first.next).toBeTruthy();
    expect(
      (await timeline.page({ from: day, to: day, before: first.next!, limit: 2 })).events.map(
        (event) => event.id,
      ),
    ).toEqual(['1']);
    expect((await timeline.page({ from: day, to: day, source: 'workout' })).events).toEqual([
      expect.objectContaining({ id: '2' }),
    ]);
  });

  it('records Thought creation without copying its title or content to Timeline', async () => {
    const thoughts = new ThoughtsRepository(db.connection);
    const thought = await thoughts.create();
    await thoughts.save(thought.id, {
      title: 'TESTE RUMAR - Thought',
      content: 'conteúdo pessoal que não deve aparecer',
    });
    const event = db.sqlite
      .prepare("SELECT title,summary FROM activity_events WHERE event_type='thought.created'")
      .get();
    expect(event).toEqual({ title: 'Pensamento registrado', summary: '' });
  });
});

describe('Phase 2 Home and Reviews', () => {
  let db: ReturnType<typeof database>;
  beforeEach(() => {
    db = database();
  });
  afterEach(() => db.sqlite.close());

  it('loads Now, Next, overdue, Habit summaries and hidden Finance through focused Home queries', async () => {
    const day = localDate();
    const planning = new PlanningRepository(db.connection);
    const now = await planning.save({
      ...planningDraft(day, 'TESTE RUMAR - Agora'),
      startTime: '09:00',
      endTime: '11:00',
    });
    const next = await planning.save({
      ...planningDraft(day, 'TESTE RUMAR - Próximo'),
      startTime: '12:00',
      endTime: '13:00',
    });
    await new Repository(db.connection).createTask({
      title: 'TESTE RUMAR - atrasada',
      description: '',
      priority: 'high',
      due_date: addDays(day, -1),
      due_time: null,
      recurrence: null,
    });
    const habits = new HabitsRepository(db.connection);
    const habit = await habits.save(habitDraft(day, 'TESTE RUMAR - Leitura', 20));
    await habits.record(habit, day, 12);
    db.sqlite.exec('UPDATE finance_preferences SET hide_values=1');
    const result = await new HomeRepository(db.connection).day(day, '10:00');
    expect(result.planning.now?.id).toBe(now);
    expect(result.planning.next.map((item) => item.id)).toContain(next);
    expect(result.planning.pending).toBe(2);
    expect(result.overdue).toMatchObject({ count: 1 });
    expect(result.habits[0]).toMatchObject({ value: 12, target: 20, reached: 0 });
    expect(result.finance.hidden).toBe(true);
  });

  it('builds weekly metrics, respects privacy and freezes a finalized snapshot', async () => {
    const day = localDate();
    const planning = new PlanningRepository(db.connection);
    const completed = await planning.save(planningDraft(day, 'Concluído'));
    const skipped = await planning.save({
      ...planningDraft(day, 'Pulado'),
      startTime: '11:00',
      endTime: '12:00',
    });
    const cancelled = await planning.save({
      ...planningDraft(day, 'Cancelado'),
      startTime: '13:00',
      endTime: '14:00',
    });
    await planning.setStatus(completed, 'completed');
    await planning.setStatus(skipped, 'skipped');
    await planning.setStatus(cancelled, 'cancelled');
    const habits = new HabitsRepository(db.connection);
    const habit = await habits.save(habitDraft(day, 'TESTE RUMAR - Academia'));
    await habits.record(habit, day, 1);
    db.sqlite.exec('UPDATE finance_preferences SET hide_values=1');
    const reviews = new WeeklyReviewRepository(db.connection);
    const live = await reviews.load(day, day);
    expect(live.planning).toMatchObject({ planned: 3, completed: 1, skipped: 1, cancelled: 1 });
    expect(live.habits.done).toBeGreaterThan(0);
    expect(live.finance).toMatchObject({ hidden: true, income: 0, expense: 0 });
    live.reflection = {
      workedWell: 'Planejar antes',
      didNotWork: 'Muitas interrupções',
      changeNext: 'Menos blocos',
      prioritiesNext: 'Projeto principal',
    };
    await reviews.finalize(day, live);
    await planning.save({
      ...planningDraft(day, 'Alteração posterior'),
      startTime: '15:00',
      endTime: '16:00',
    });
    const frozen = await reviews.load(day, day);
    expect(frozen.planning.planned).toBe(3);
    expect(frozen.reflection).toEqual(live.reflection);
    expect(frozen.finalizedAt).toBeTruthy();
  });
});

describe('Phase 2 migration path', () => {
  it('creates a fresh database at schema 30 with valid integrity and foreign keys', () => {
    const fresh = database(':memory:', 30);
    try {
      expect(
        fresh.sqlite.prepare('SELECT MAX(version) AS version FROM test_migrations').get(),
      ).toEqual({
        version: 30,
      });
      expect(fresh.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
        integrity_check: 'ok',
      });
      expect(fresh.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      fresh.sqlite.close();
    }
  });

  it('upgrades schema 29 to 30 without losing existing records', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'rumar-phase2-upgrade-'));
    const path = join(folder, 'schema-29.sqlite');
    let current: ReturnType<typeof database> | null = null;
    try {
      const legacy = database(path, 29);
      const taskId = await new Repository(legacy.connection).createTask({
        title: 'TESTE RUMAR - Task preservada',
        description: '',
        priority: 'normal',
        due_date: localDate(),
        due_time: null,
        recurrence: null,
      });
      legacy.sqlite.close();

      current = database(path, 30);
      expect(
        current.sqlite.prepare('SELECT MAX(version) AS version FROM test_migrations').get(),
      ).toEqual({
        version: 30,
      });
      expect(current.sqlite.prepare('SELECT title FROM tasks WHERE id=?').get(taskId)).toEqual({
        title: 'TESTE RUMAR - Task preservada',
      });
      expect(
        current.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_events'")
          .get(),
      ).toEqual({ name: 'activity_events' });
      expect(current.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
        integrity_check: 'ok',
      });
      expect(current.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      current?.sqlite.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
