import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { database } from './database';
import { Repository } from '../src/services/repository';
import { convertInboxTo } from '../src/features/inbox/conversions';
import { parseNaturalSchedule } from '../src/features/quick-add/parser';
import { FocusRepository } from '../src/features/calendar/planner-repository';
import { PlanningRepository } from '../src/features/planning/repository';
import { globalSearch } from '../src/features/search/repository';
import { commandSuggestions, hasDestructiveCommand } from '../src/features/search/commands';
import {
  estimatedOneRepMax,
  exerciseMetrics,
  progressionSuggestion,
  recordedVolume,
  weeklyMuscleFrequency,
  type MetricSet,
} from '../src/features/workouts/domain';
import { WorkoutHistoryRepository } from '../src/features/workouts/repositories/history';
import { BodyProgressRepository } from '../src/features/body-progress/repository';
import { comparison } from '../src/features/body-progress/domain';
import { NutritionRepository } from '../src/features/nutrition/repository';
import { nutrientsPerServing } from '../src/features/nutrition/domain';
import {
  detectCategoryOutliers,
  monthChangePercent,
  projectedMonthExpense,
} from '../src/features/finance/domain';
import { FinanceRepository } from '../src/features/finance/repository';

const day = '2026-10-09';
const databases: ReturnType<typeof database>[] = [];
const open = (version = 31) => {
  const value = database(':memory:', version);
  databases.push(value);
  return value;
};
afterEach(() => {
  while (databases.length) databases.pop()!.sqlite.close();
});

async function capture(db: ReturnType<typeof database>, content: string, notes = '') {
  await new Repository(db.connection).createInbox(content, notes);
  return (
    db.sqlite
      .prepare('SELECT id FROM inbox_items WHERE content=? ORDER BY created_at DESC')
      .get(content) as { id: string }
  ).id;
}

describe('Phase 3 Inbox universal and local parsing', () => {
  it('captures unclassified content with optional notes', async () => {
    const db = open();
    const id = await capture(db, 'TESTE RUMAR - captura', 'nota opcional');
    expect(
      db.sqlite
        .prepare('SELECT content,notes,capture_type,status FROM inbox_items WHERE id=?')
        .get(id),
    ).toEqual({
      content: 'TESTE RUMAR - captura',
      notes: 'nota opcional',
      capture_type: 'unclassified',
      status: 'pending',
    });
  });

  it('converts once to Task, Thought and Planning without duplicating content', async () => {
    const db = open();
    const taskInbox = await capture(db, 'TESTE RUMAR - Task');
    const task = await new Repository(db.connection).convertInbox(taskInbox);
    expect(await new Repository(db.connection).convertInbox(taskInbox)).toBe(task);
    expect(
      db.sqlite.prepare('SELECT count(*) n FROM tasks WHERE source_inbox_id=?').get(taskInbox),
    ).toEqual({ n: 1 });

    const thoughtInbox = await capture(db, 'TESTE RUMAR - Thought', 'conteúdo privado');
    const thought = await convertInboxTo(db.connection, thoughtInbox, 'thought');
    await expect(convertInboxTo(db.connection, thoughtInbox, 'project')).rejects.toThrow();
    expect(db.sqlite.prepare('SELECT content FROM thoughts WHERE id=?').get(thought)).toEqual({
      content: 'conteúdo privado',
    });

    const planningInbox = await capture(db, 'estudar Python amanhã 14h');
    const planning = await convertInboxTo(db.connection, planningInbox, 'planning');
    expect(
      db.sqlite
        .prepare(
          'SELECT block_date,start_time,title,source_inbox_id FROM planner_time_blocks WHERE id=?',
        )
        .get(planning),
    ).toEqual({
      block_date: '2026-10-10',
      start_time: '14:00',
      title: 'estudar Python',
      source_inbox_id: planningInbox,
    });
  });

  it('suggests pt-BR weekdays, periods and clock forms without auto-converting', () => {
    expect(parseNaturalSchedule('Entrevista quinta 14:30', day)).toMatchObject({
      title: 'Entrevista',
      date: '2026-10-15',
      time: '14:30',
    });
    expect(parseNaturalSchedule('Leitura sábado à noite', day)).toMatchObject({
      title: 'Leitura',
      date: '2026-10-10',
      time: '19:00',
      dayPeriod: 'evening',
    });
  });
});

describe('Phase 3 Focus and command registry', () => {
  it('links Focus to Task, Project and Planning while finish does not complete the Task', async () => {
    const db = open();
    const tasks = new Repository(db.connection);
    const task = await tasks.createTask({
      title: 'TESTE RUMAR - Task',
      description: '',
      priority: 'normal',
      due_date: day,
      due_time: null,
      recurrence: null,
    });
    db.sqlite
      .prepare(
        "INSERT INTO projects(id,name,created_at,updated_at) VALUES('project-focus','TESTE RUMAR - Project',?1,?1)",
      )
      .run(new Date().toISOString());
    const planning = await new PlanningRepository(db.connection).save({
      date: day,
      title: 'TESTE RUMAR - Planning',
      notes: '',
      schedule: 'fixed',
      startTime: '14:00',
      endTime: '15:00',
      dayPeriod: null,
      sourceType: 'standalone',
      sourceId: null,
    });
    const focus = new FocusRepository(db.connection);
    const taskSession = await focus.start('Task', task, null, '2026-10-09T14:00:00.000Z', day);
    await focus.pause(taskSession.id, '2026-10-09T14:10:00.000Z');
    await focus.resume(taskSession.id, '2026-10-09T14:11:00.000Z');
    await focus.finish(taskSession.id, '2026-10-09T14:21:00.000Z');
    expect(db.sqlite.prepare('SELECT status FROM tasks WHERE id=?').get(task)).toEqual({
      status: 'pending',
    });
    expect(
      db.sqlite
        .prepare("SELECT count(*) n FROM activity_events WHERE event_type='focus.completed'")
        .get(),
    ).toEqual({ n: 1 });
    await focus.finish(taskSession.id, '2026-10-09T14:22:00.000Z');
    expect(
      db.sqlite
        .prepare("SELECT count(*) n FROM activity_events WHERE event_type='focus.completed'")
        .get(),
    ).toEqual({ n: 1 });

    const projectSession = await focus.start(
      'Project',
      null,
      null,
      '2026-10-09T15:00:00.000Z',
      day,
      'project-focus',
    );
    await focus.finish(projectSession.id, '2026-10-09T15:30:00.000Z');
    const planningSession = await focus.start(
      'Planning',
      null,
      planning,
      '2026-10-09T16:00:00.000Z',
      day,
    );
    expect(planningSession.time_block_id).toBe(planning);
    await focus.finish(planningSession.id, '2026-10-09T16:20:00.000Z');
    expect((await focus.stats(day, day)).sources.map((row) => row.source_type)).toEqual(
      expect.arrayContaining(['task', 'project', 'unlinked']),
    );
  });

  it('shares predictable navigation and creation commands and exposes no destructive command', () => {
    expect(commandSuggestions('abrir finanças')[0]).toMatchObject({
      kind: 'navigate',
      page: 'finance',
    });
    expect(commandSuggestions('nova tarefa estudar SQL amanhã 14h', day)[0]).toMatchObject({
      kind: 'create-task',
      payload: 'estudar SQL amanhã 14h',
    });
    expect(commandSuggestions('capturar inbox ideia de backup')[0]).toMatchObject({
      kind: 'capture-inbox',
    });
    expect(hasDestructiveCommand('apagar todas as tarefas')).toBe(true);
    expect(commandSuggestions('apagar todas as tarefas')).toEqual([]);
  });

  it('continues searching records while private body photos never appear', async () => {
    const db = open();
    await new Repository(db.connection).createTask({
      title: 'TESTE RUMAR - encontrar',
      description: '',
      priority: 'normal',
      due_date: null,
      due_time: null,
      recurrence: null,
    });
    const photo = await new BodyProgressRepository(db.connection).savePhoto(day, 'privada');
    db.sqlite
      .prepare(
        `INSERT INTO attachments VALUES(?1,'body_progress_photo',?2,'TESTE RUMAR privada.jpg','file.jpg',
         'attachments/'||?1||'/file.jpg','image/jpeg',10,?3,?4,?4)`,
      )
      .run('11111111-1111-4111-8111-111111111111', photo, 'A'.repeat(64), new Date().toISOString());
    const results = await globalSearch(db.connection, 'TESTE RUMAR');
    expect(results.some((row) => row.page === 'tasks')).toBe(true);
    expect(results.some((row) => row.title.includes('privada'))).toBe(false);
  });
});

describe('Phase 3 deterministic intelligence', () => {
  const set = (
    session: string,
    date: string,
    load: number,
    reps: number,
    muscle_group = 'Peito',
  ): MetricSet => ({
    exercise_id: 'bench',
    workout_session_id: session,
    load_type: 'total',
    load_value: load,
    reps,
    completed: 1,
    set_type: 'normal',
    session_status: 'completed',
    session_date: date,
    muscle_group,
  });

  it('calculates workout volume, e1RM, PR metrics, frequency and explainable progression', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => set('one', '2026-10-01', 80, 10)),
      ...Array.from({ length: 3 }, () => set('two', '2026-10-08', 80, 10)),
    ];
    expect(recordedVolume(rows[0])).toBe(800);
    expect(estimatedOneRepMax(80, 10)).toBeCloseTo(106.67);
    expect(exerciseMetrics(rows, 'bench', 'total')).toMatchObject({
      maxLoad: 80,
      maxSessionVolume: 2400,
      bestEstimatedOneRepMax: 106.67,
    });
    expect(progressionSuggestion(rows, 'bench', 'total', 3, 10)).toBe('increase_load');
    expect(weeklyMuscleFrequency(rows)).toEqual([{ muscleGroup: 'Peito', sessions: 2 }]);
  });

  it('summarizes weekly muscle frequency from completed workout sessions', async () => {
    const db = open();
    for (const [id, date] of [
      ['frequency-one', '2026-10-06'],
      ['frequency-two', '2026-10-09'],
    ]) {
      db.sqlite
        .prepare(
          `INSERT INTO workout_sessions(id,plan_name,day_name,session_date,started_at,finished_at,status,created_at,updated_at)
           VALUES(?1,'TESTE RUMAR','Push',?2,?2||'T14:00:00.000Z',?2||'T15:00:00.000Z','completed',?2||'T14:00:00.000Z',?2||'T15:00:00.000Z')`,
        )
        .run(id, date);
      db.sqlite
        .prepare(
          `INSERT INTO workout_session_exercises(id,workout_session_id,exercise_id,exercise_name,load_type,target_sets,min_reps,max_reps,sort_order)
           VALUES(?1||':exercise',?1,'builtin-bench','Supino reto','total',1,8,12,0)`,
        )
        .run(id);
      db.sqlite
        .prepare(
          `INSERT INTO workout_sets(id,workout_session_id,session_exercise_id,exercise_id,set_number,load_value,load_type,reps,completed,created_at,updated_at)
           VALUES(?1||':set',?1,?1||':exercise','builtin-bench',1,80,'total',10,1,?2||'T14:00:00.000Z',?2||'T15:00:00.000Z')`,
        )
        .run(id, date);
    }
    await expect(
      new WorkoutHistoryRepository(db.connection).muscleFrequency('2026-10-03', day),
    ).resolves.toEqual([{ muscleGroup: 'Peito', sessions: 2 }]);
  });

  it('compares body periods and persists private photo metadata separately from the file', async () => {
    const db = open();
    const body = new BodyProgressRepository(db.connection);
    await body.save('2026-10-01', { weight: 80, waist: 90 });
    await body.save(day, { weight: 79, waist: 88 });
    const records = await body.records();
    expect(comparison(records[1], records[0])).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'weight', change: -1 })]),
    );
    const photo = await body.savePhoto(day, 'frente');
    expect(await body.photos()).toEqual([
      expect.objectContaining({ id: photo, photo_date: day, attachment_count: 0 }),
    ]);
  });

  it('computes recipe macros per portion, saves favorites and logs one click', async () => {
    const db = open();
    const nutrition = new NutritionRepository(db.connection);
    const food = await nutrition.saveCustomFood({
      name: 'TESTE RUMAR - banana',
      base_amount: 100,
      base_unit: 'g',
      nutrients: { energy_kcal: 100, protein_g: 10 },
    });
    const recipe = await nutrition.saveMeal('TESTE RUMAR - Vitamina', '', undefined, 'recipe', 2);
    await nutrition.saveMealItem(recipe, {
      food_id: food,
      quantity: 200,
      unit: 'g',
      grams_equivalent: 200,
    });
    const totals = await nutrition.mealTotals(recipe);
    expect(totals).toMatchObject({ energy_kcal: 200, protein_g: 20 });
    expect(nutrientsPerServing(totals, 2)).toMatchObject({ energy_kcal: 100, protein_g: 10 });
    await nutrition.saveMeal('TESTE RUMAR - Vitamina', '', recipe, 'favorite', 2);
    await nutrition.copyMealToDiary(recipe, day, undefined, 1);
    expect(await nutrition.diaryTotals(day)).toMatchObject({ energy_kcal: 100, protein_g: 10 });
    expect((await nutrition.meals('favorite'))[0].id).toBe(recipe);
  });

  it('projects month, compares M-1, detects robust outliers and honors hidden values', async () => {
    expect(projectedMonthExpense(10000, 10, 30, 5000)).toBe(30000);
    expect(monthChangePercent(15000, 10000)).toBe(50);
    expect(
      detectCategoryOutliers(
        [
          { category: 'Alimentação', month: '2026-07', cents: 10000 },
          { category: 'Alimentação', month: '2026-08', cents: 11000 },
          { category: 'Alimentação', month: '2026-09', cents: 9000 },
          { category: 'Alimentação', month: '2026-10', cents: 20000 },
        ],
        '2026-10',
      ),
    ).toEqual([expect.objectContaining({ category: 'Alimentação', baseline_cents: 10000 })]);
    const db = open();
    db.sqlite.prepare('UPDATE finance_preferences SET hide_values=1 WHERE id=1').run();
    await expect(
      new FinanceRepository(db.connection).intelligence('2026-10', day),
    ).resolves.toMatchObject({
      hidden: true,
      projected_expense_cents: null,
      projected_balance_cents: null,
      outliers: [],
    });
  });
});

describe('Phase 3 migration path', () => {
  it('creates fresh schema 31 and upgrades schema 30 with integrity and foreign keys', () => {
    const current = open();
    expect(
      current.sqlite.prepare('SELECT max(version) version FROM test_migrations').get(),
    ).toEqual({
      version: 31,
    });
    expect(current.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
    expect(current.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const legacy = open(30);
    legacy.sqlite.exec(
      readFileSync('src-tauri/migrations/0031_productivity_intelligence.sql', 'utf8'),
    );
    expect(
      legacy.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inbox_conversions'")
        .get(),
    ).toEqual({ name: 'inbox_conversions' });
    expect(legacy.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
    expect(legacy.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps the immutable migration 1-30 byte set unchanged and registers 31 separately', () => {
    const published = readFileSync('tests/migration-checksums.test.ts', 'utf8');
    for (let version = 1; version <= 30; version++)
      expect(published).toContain(`'${String(version).padStart(4, '0')}_`);
    const bytes = readFileSync('src-tauri/migrations/0031_productivity_intelligence.sql');
    expect(createHash('sha384').update(bytes).digest('hex')).toHaveLength(96);
  });
});
