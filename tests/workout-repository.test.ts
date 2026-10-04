import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './database';
import { ExercisesRepository } from '../src/features/workouts/repositories/catalog';
import { PlansRepository } from '../src/features/workouts/repositories/plans';
import { SessionsRepository } from '../src/features/workouts/repositories/sessions';
import { HabitsRepository } from '../src/features/habits/repository';
import { Repository } from '../src/services/repository';
import { ProjectsRepository } from '../src/features/projects/repository';
import { RoutinesRepository } from '../src/features/routines/repository';
import { ThoughtsRepository } from '../src/features/thoughts/repository';
import { localDate } from '../src/lib/dates';
import type { SetInput, ExerciseInput } from '../src/features/workouts/types';

const custom: ExerciseInput = {
  name: 'Supino próprio',
  muscle_group: 'Peito',
  equipment: 'Barra',
  load_type: 'per_side',
  notes: 'Pegada habitual',
};
const prescription = {
  exercise_id: 'builtin-bench',
  target_sets: 3,
  min_reps: 6,
  max_reps: 10,
  rest_seconds: 120,
  notes: 'Controlar descida',
};
const entry: SetInput = {
  set_type: 'normal',
  load_value: 27.5,
  load_type: 'per_side',
  reps: 9,
  completed: 1,
  notes: '',
};
const habitInput = {
  name: 'Treinar',
  description: '',
  frequency: 'weekly_target' as const,
  weekdays: [],
  weekly_target: 4,
  kind: 'boolean' as const,
  target_value: 1,
  unit: '',
  start_date: localDate(),
  end_date: null,
  project_id: null,
  active: 1,
};
describe('Workout repositories', () => {
  let db: ReturnType<typeof database>,
    catalog: ExercisesRepository,
    plans: PlansRepository,
    sessions: SessionsRepository,
    habits: HabitsRepository;
  beforeEach(() => {
    db = database();
    catalog = new ExercisesRepository(db.connection);
    plans = new PlansRepository(db.connection);
    sessions = new SessionsRepository(db.connection);
    habits = new HabitsRepository(db.connection);
  });
  afterEach(() => db.sqlite.close());
  async function setup(habit_id: string | null = null) {
    const plan = await plans.save({
      name: 'PPL + Upper/Lower',
      description: 'Meu plano',
      habit_id,
    });
    const day = await plans.saveDay(plan, {
      name: 'Upper',
      weekday: new Date().getDay(),
      notes: '',
    });
    await plans.saveExercise(day, prescription);
    return { plan, day };
  }
  it('seeds the expanded library and supports custom editing, literal search, filters and archive', async () => {
    expect(await catalog.list()).toHaveLength(236);
    const id = await catalog.save(custom);
    expect((await catalog.list('próprio', 'Peito', 'Barra'))[0]).toMatchObject({
      id,
      is_custom: 1,
      load_type: 'per_side',
    });
    expect(await catalog.list('próprio', 'Costas', 'Barra')).toEqual([]);
    await catalog.save({ ...custom, name: 'Alterado', load_type: 'total' }, id);
    expect((await catalog.list('Alterado'))[0].load_type).toBe('total');
    await catalog.archive(id);
    expect(await catalog.list('Alterado')).toEqual([]);
    expect(await catalog.list('Alterado', '', '', true)).toHaveLength(1);
    await expect(catalog.save({ ...custom, name: '  ' })).rejects.toThrow();
    await expect(catalog.save({ ...custom, load_type: 'invalid' as never })).rejects.toThrow();
  });
  it('switches active plans atomically and preserves archived plans', async () => {
    const { plan } = await setup(),
      other = await plans.save({ name: 'Novo', description: '', habit_id: null });
    await plans.activate(plan);
    await plans.activate(other);
    expect((await plans.list()).filter((p) => p.active)).toEqual([
      expect.objectContaining({ id: other }),
    ]);
    await plans.save({ name: 'Novo editado', description: 'Descrição', habit_id: null }, other);
    await plans.archive(other);
    expect(await plans.list()).toHaveLength(1);
    expect(await plans.list(true)).toHaveLength(2);
    await expect(plans.activate(other)).rejects.toThrow();
  });
  it('edits and reorders days and duplicate exercises without conflating their slots', async () => {
    const { plan, day } = await setup(),
      second = await plans.saveDay(plan, { name: 'Lower', weekday: null, notes: 'Sem dia fixo' });
    await plans.moveDay(second, -1);
    expect((await plans.days(plan))[0].id).toBe(second);
    await plans.saveDay(plan, { name: 'Upper A', weekday: 1, notes: 'Observação' }, day);
    const first = (await plans.exercises(day))[0],
      duplicate = await plans.duplicateExercise(first.id);
    await plans.moveExercise(duplicate, -1);
    expect((await plans.exercises(day))[0].id).toBe(duplicate);
    await plans.saveExercise(
      day,
      { ...prescription, target_sets: 4, min_reps: 8, max_reps: 12 },
      first.id,
    );
    expect((await plans.exercises(day))[1].target_sets).toBe(4);
    await plans.removeExercise(duplicate);
    await plans.removeDay(second);
    expect(await plans.days(plan)).toHaveLength(1);
    await expect(
      plans.saveDay(plan, { name: 'Inválido', weekday: 8, notes: '' }),
    ).rejects.toThrow();
    await expect(
      plans.saveExercise(day, { ...prescription, min_reps: 20, max_reps: 10 }),
    ).rejects.toThrow();
  });
  it('creates session snapshots and planned sets atomically; only one session can run', async () => {
    const { day } = await setup();
    await plans.duplicateExercise((await plans.exercises(day))[0].id);
    const results = await Promise.allSettled([sessions.start(day), sessions.start(day)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = await sessions.current(),
      detail = await sessions.get(current!.id);
    expect(detail.exercises).toHaveLength(2);
    expect(detail.sets).toHaveLength(6);
    expect(new Set(detail.sets.map((s) => s.session_exercise_id)).size).toBe(2);
    expect(detail.sets.every((s) => !s.completed && s.load_value === null && s.reps === null)).toBe(
      true,
    );
    expect(detail.session).toMatchObject({
      day_name: 'Upper',
      plan_name: 'PPL + Upper/Lower',
      status: 'in_progress',
    });
  });
  it('rolls back session and snapshots if planned set creation fails', async () => {
    const { day } = await setup();
    db.sqlite.exec(
      "CREATE TRIGGER workout_fail BEFORE INSERT ON workout_sets BEGIN SELECT RAISE(ABORT,'failure'); END;",
    );
    await expect(sessions.start(day)).rejects.toThrow('failure');
    expect(await sessions.current()).toBeNull();
    expect(db.sqlite.prepare('SELECT count(*) n FROM workout_session_exercises').get()?.n).toBe(0);
  });
  it.each([30, 27.5, 2.5, 0])('persists decimal load %s as a numeric value', async (load) => {
    const { day } = await setup(),
      id = await sessions.start(day),
      set = (await sessions.get(id)).sets[0];
    await sessions.saveSet(set.id, { ...entry, load_value: load });
    expect((await sessions.get(id)).sets.find((s) => s.id === set.id)).toMatchObject({
      load_value: load,
      reps: 9,
      completed: 1,
    });
  });
  it('adds, edits, removes sets and validates completeness and load semantics', async () => {
    const { day } = await setup(),
      id = await sessions.start(day),
      detail = await sessions.get(id),
      added = await sessions.addSet(detail.exercises[0].id);
    await sessions.saveSet(added, { ...entry, set_type: 'drop', notes: 'Última' });
    expect((await sessions.get(id)).sets.find((s) => s.id === added)).toMatchObject({
      set_number: 4,
      set_type: 'drop',
      notes: 'Última',
    });
    await expect(sessions.saveSet(added, { ...entry, load_value: -1 })).rejects.toThrow();
    await expect(sessions.saveSet(added, { ...entry, reps: 2.5 })).rejects.toThrow();
    await expect(sessions.saveSet(added, { ...entry, reps: null })).rejects.toThrow();
    await expect(sessions.saveSet(added, { ...entry, load_value: null })).rejects.toThrow();
    await sessions.saveSet(added, { ...entry, load_type: 'bodyweight', load_value: null });
    await sessions.saveSet(added, { ...entry, load_type: 'bodyweight', load_value: 10 });
    await expect(
      sessions.saveSet(added, { ...entry, load_type: 'none', load_value: 10 }),
    ).rejects.toThrow();
    await sessions.saveSet(added, { ...entry, load_type: 'none', load_value: null });
    await sessions.removeSet(added);
    expect((await sessions.get(id)).sets).toHaveLength(3);
  });
  it('keeps session snapshots readable after names/load types change and plan/day/exercise archive or removal', async () => {
    const { plan, day } = await setup(),
      id = await sessions.start(day);
    const before = await sessions.get(id);
    await catalog.save({ ...custom, name: 'Nome alterado', load_type: 'total' }, 'builtin-bench');
    await plans.save({ name: 'Outro plano', description: '', habit_id: null }, plan);
    await plans.removeDay(day);
    await plans.archive(plan);
    await catalog.archive('builtin-bench');
    const after = await sessions.get(id);
    expect(after.exercises).toEqual(before.exercises);
    expect(after.sets).toEqual(before.sets);
    expect(after.session.day_name).toBe('Upper');
    expect(after.session.plan_name).toBe('PPL + Upper/Lower');
    expect(after.session.workout_day_id).toBeNull();
  });
  it('completes partially filled sessions, edits history, keeps finish idempotent and cascades deletion', async () => {
    const { day } = await setup(),
      id = await sessions.start(day),
      set = (await sessions.get(id)).sets[0];
    await sessions.saveSet(set.id, entry);
    await sessions.notes(id, 'Observação da sessão');
    await sessions.finish(id);
    const finished = (await sessions.get(id)).session;
    expect(finished.status).toBe('completed');
    expect(
      Date.parse(finished.finished_at!) - Date.parse(finished.started_at),
    ).toBeGreaterThanOrEqual(0);
    await sessions.finish(id);
    expect((await sessions.get(id)).session.finished_at).toBe(finished.finished_at);
    await sessions.saveSet(set.id, { ...entry, load_value: 30, reps: 10 });
    expect((await sessions.get(id)).sets.find((s) => s.id === set.id)?.reps).toBe(10);
    expect(await sessions.current()).toBeNull();
    expect(await sessions.list(1)).toHaveLength(1);
    expect(await sessions.list(1, 1)).toHaveLength(0);
    await sessions.remove(id);
    expect(db.sqlite.prepare('SELECT count(*) n FROM workout_sets').get()?.n).toBe(0);
    expect(db.sqlite.prepare('SELECT count(*) n FROM workout_session_exercises').get()?.n).toBe(0);
  });
  it('copies compatible previous loads only into uncompleted sets, keeping completion unchecked', async () => {
    const { day } = await setup(),
      first = await sessions.start(day),
      old = (await sessions.get(first)).sets;
    await sessions.saveSet(old[0].id, { ...entry, load_value: 25, reps: 10 });
    await sessions.saveSet(old[1].id, { ...entry, load_value: 27.5, reps: 9 });
    await sessions.finish(first);
    const second = await sessions.start(day),
      current = await sessions.get(second);
    await sessions.saveSet(current.sets[0].id, { ...entry, load_value: 30, reps: 11 });
    await sessions.copyPrevious(current.exercises[0].id);
    const result = await sessions.get(second);
    expect(result.sets.find((s) => s.set_number === 1)).toMatchObject({
      load_value: 30,
      reps: 11,
      completed: 1,
    });
    expect(result.sets.find((s) => s.set_number === 2)).toMatchObject({
      load_value: 27.5,
      reps: 9,
      completed: 0,
    });
    expect(result.sets.find((s) => s.set_number === 3)).toMatchObject({
      load_value: null,
      reps: null,
      completed: 0,
    });
  });
  it('marks a linked eligible boolean habit only on completion and retains a traceable entry after session deletion', async () => {
    const habit = await habits.save(habitInput),
      { day } = await setup(habit),
      id = await sessions.start(day);
    expect(await habits.entries(localDate(), localDate())).toEqual([]);
    await sessions.finish(id);
    await sessions.finish(id);
    expect(
      db.sqlite.prepare('SELECT value,source_workout_session_id FROM habit_entries').all(),
    ).toEqual([expect.objectContaining({ value: 1, source_workout_session_id: id })]);
    await sessions.remove(id);
    expect(
      db.sqlite.prepare('SELECT value,source_workout_session_id FROM habit_entries').all(),
    ).toEqual([expect.objectContaining({ value: 1, source_workout_session_id: null })]);
  });
  it('does not mark discarded sessions or ineligible habits and rejects quantitative linkage', async () => {
    const habit = await habits.save({
        ...habitInput,
        frequency: 'weekdays',
        weekdays: [(new Date().getDay() + 1) % 7],
      }),
      { day } = await setup(habit),
      id = await sessions.start(day);
    await sessions.discard(id);
    expect((await sessions.get(id)).session.status).toBe('discarded');
    expect(await habits.entries(localDate(), localDate())).toEqual([]);
    const second = await sessions.start(day);
    await sessions.finish(second);
    expect(await habits.entries(localDate(), localDate())).toEqual([]);
    const quantity = await habits.save({
      ...habitInput,
      kind: 'quantity',
      unit: 'min',
      target_value: 30,
    });
    await expect(
      plans.save({ name: 'Inválido', description: '', habit_id: quantity }),
    ).rejects.toThrow('marcação simples');
  });
  it('preserves a manual completion but turns a previously unchecked habit entry into a workout completion', async () => {
    const habit = await habits.save(habitInput),
      { day } = await setup(habit);
    await habits.record(habit, localDate(), 1);
    const first = await sessions.start(day);
    await sessions.finish(first);
    expect(
      db.sqlite.prepare('SELECT source_workout_session_id FROM habit_entries').get()
        ?.source_workout_session_id,
    ).toBeNull();
    await habits.record(habit, localDate(), 0);
    const second = await sessions.start(day);
    await sessions.finish(second);
    expect(
      db.sqlite.prepare('SELECT value,source_workout_session_id FROM habit_entries').get(),
    ).toMatchObject({ value: 1, source_workout_session_id: second });
  });
});

it('upgrades a populated Phase 2 file without changing existing data and resumes a persisted session after reopening', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'rumo-workouts-')),
    path = join(folder, 'rumo.db');
  let db = database(path, 2);
  try {
    const base = new Repository(db.connection),
      projects = new ProjectsRepository(db.connection),
      habits = new HabitsRepository(db.connection),
      routines = new RoutinesRepository(db.connection),
      thoughts = new ThoughtsRepository(db.connection);
    await base.createTask({
      title: 'Tarefa existente',
      description: 'Preservar',
      priority: 'normal',
      due_date: localDate(),
      due_time: null,
      recurrence: null,
    });
    await base.createInbox('Inbox existente');
    await base.saveSetting('name', 'Teste upgrade');
    await projects.create({
      name: 'Projeto existente',
      description: '',
      start_date: null,
      target_date: null,
    });
    await habits.save(habitInput);
    await routines.save({
      name: 'Rotina existente',
      description: '',
      frequency: 'daily',
      weekdays: [],
      time_of_day: null,
      active: 1,
    });
    const thought = await thoughts.create();
    await thoughts.save(thought.id, {
      title: 'Pensamento existente',
      content: 'Texto longo '.repeat(1000),
    });
    const tables = [
      'tasks',
      'projects',
      'habits',
      'routines',
      'thoughts',
      'inbox_items',
      'settings',
    ];
    const before = Object.fromEntries(
      tables.map((table) => [
        table,
        db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
    db.sqlite.close();
    db = database(path, 3);
    for (const table of tables)
      expect(db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(
        before[table],
      );
    expect(db.sqlite.prepare('SELECT count(*) n FROM test_migrations').get()?.n).toBe(3);
    db.sqlite.close();
    db = database(path, 10);
    const plans = new PlansRepository(db.connection),
      plan = await plans.save({ name: 'Retomável', description: '', habit_id: null }),
      day = await plans.saveDay(plan, { name: 'Upper', weekday: null, notes: '' });
    await plans.saveExercise(day, prescription);
    let sessions = new SessionsRepository(db.connection);
    const id = await sessions.start(day),
      set = (await sessions.get(id)).sets[0];
    await sessions.saveSet(set.id, entry);
    const saved = await sessions.get(id);
    db.sqlite.close();
    db = database(path, 3);
    sessions = new SessionsRepository(db.connection);
    expect(await sessions.get(id)).toEqual(saved);
    expect((await sessions.current())?.id).toBe(id);
    await sessions.finish(id);
    const finished = await sessions.get(id);
    db.sqlite.close();
    db = database(path, 3);
    sessions = new SessionsRepository(db.connection);
    expect(await sessions.get(id)).toEqual(finished);
    expect(await sessions.current()).toBeNull();
  } finally {
    db.sqlite.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
