import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { database } from './database';
import { TemplatesRepository } from '../src/features/templates/repository';
import { parseQuickAdd } from '../src/features/quick-add/parser';
import { WeeklyReviewRepository } from '../src/features/weekly-review/repository';
import { NotificationsRepository } from '../src/features/notifications/repository';
import {
  defaultNotifications,
  displayReminder,
  dueNow,
} from '../src/features/notifications/domain';

describe('Quick Add local', () => {
  const day = '2026-09-28';
  it('interpreta datas, horários e prefixos sem perder texto ambíguo', () => {
    expect(parseQuickAdd('Comprar ração amanhã', 'auto', day)).toEqual({
      kind: 'task',
      title: 'Comprar ração',
      date: '2026-09-29',
      time: null,
    });
    expect(parseQuickAdd('Dentista amanhã 14:30', 'auto', day)).toEqual({
      kind: 'task',
      title: 'Dentista',
      date: '2026-09-29',
      time: '14:30',
    });
    expect(parseQuickAdd('/task Exame 15/10/2026 14:30', 'auto', day)).toEqual({
      kind: 'task',
      title: 'Exame',
      date: '2026-10-15',
      time: '14:30',
    });
    expect(parseQuickAdd('/t Revisar segunda', 'auto', day)).toEqual({
      kind: 'task',
      title: 'Revisar',
      date: '2026-10-05',
      time: null,
    });
    expect(parseQuickAdd('ideia: melhorar site', 'auto', day).kind).toBe('thought');
    expect(parseQuickAdd('texto completamente ambíguo', 'auto', day)).toEqual({
      kind: 'inbox',
      content: 'texto completamente ambíguo',
    });
  });
  it('preserva decimais pt-BR e exige confirmação financeira', () => {
    expect(parseQuickAdd('9230 passos', 'auto', day)).toMatchObject({ kind: 'steps', value: 9230 });
    expect(parseQuickAdd('peso 90,8', 'auto', day)).toMatchObject({ kind: 'weight', value: 90.8 });
    expect(parseQuickAdd('mercado 83,40', 'auto', day)).toMatchObject({
      kind: 'finance',
      cents: 8340,
      confirmed: false,
    });
    expect(parseQuickAdd('/gasto mercado 1.234,56', 'auto', day)).toMatchObject({
      kind: 'finance',
      cents: 123456,
      transactionType: 'expense',
    });
    expect(parseQuickAdd('/receita salário 1.234,56', 'auto', day)).toMatchObject({
      kind: 'finance',
      cents: 123456,
      transactionType: 'income',
    });
  });
});

describe('upgrade 1.1 → 1.2', () => {
  it('aplica somente a migration 0013 e preserva dados existentes', () => {
    const { sqlite } = database(':memory:', 12);
    const stamp = '2026-09-28T10:00:00Z';
    sqlite
      .prepare(
        "INSERT INTO tasks(id,title,created_at,updated_at) VALUES('old-task','Anterior',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO projects(id,name,created_at,updated_at) VALUES('old-project','Anterior',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare("INSERT INTO settings(key,value,updated_at) VALUES('upgrade-marker','ok',?)")
      .run(stamp);
    sqlite.exec('BEGIN');
    sqlite.exec(
      readFileSync(new URL('../src-tauri/migrations/0013_continuity.sql', import.meta.url), 'utf8'),
    );
    sqlite.exec('INSERT INTO test_migrations VALUES(13); COMMIT');
    expect(
      sqlite.prepare('SELECT title,remind_minutes_before FROM tasks WHERE id=?').get('old-task'),
    ).toMatchObject({ title: 'Anterior', remind_minutes_before: null });
    expect(sqlite.prepare('SELECT name FROM projects WHERE id=?').get('old-project')).toMatchObject(
      { name: 'Anterior' },
    );
    expect(
      sqlite.prepare('SELECT value FROM settings WHERE key=?').get('upgrade-marker'),
    ).toMatchObject({ value: 'ok' });
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
    sqlite.close();
  });
});

describe('templates independentes', () => {
  it('cria rotina nova; editar e excluir template não altera a rotina criada', async () => {
    const { sqlite, connection } = database();
    const time = '2026-09-28T10:00:00Z';
    sqlite
      .prepare(
        "INSERT INTO routines(id,name,description,frequency,created_at,updated_at) VALUES('r1','Noite','','daily',?,?)",
      )
      .run(time, time);
    sqlite
      .prepare(
        "INSERT INTO routine_items(id,routine_id,title,created_at,updated_at) VALUES('i1','r1','Escovar dentes',?,?)",
      )
      .run(time, time);
    const repo = new TemplatesRepository(connection);
    const template = await repo.saveFrom('routine', 'r1', 'Minha noite');
    const created = await repo.apply(template);
    expect(sqlite.prepare('SELECT name FROM routines WHERE id=?').get(created)).toMatchObject({
      name: 'Noite',
    });
    expect(
      sqlite.prepare('SELECT title FROM routine_items WHERE routine_id=?').get(created),
    ).toMatchObject({ title: 'Escovar dentes' });
    await repo.rename(template, 'Noite editada', 'futuro');
    await repo.remove(template);
    expect(
      sqlite.prepare('SELECT count(*) n FROM routine_items WHERE routine_id=?').get(created),
    ).toMatchObject({ n: 1 });
    sqlite.close();
  });
  it('instancia plano duas vezes com dias e exercícios separados', async () => {
    const { sqlite, connection } = database();
    const now = '2026-09-28T10:00:00Z';
    sqlite
      .prepare("INSERT INTO workout_plans(id,name,created_at,updated_at) VALUES('p1','Upper',?,?)")
      .run(now, now);
    sqlite
      .prepare(
        "INSERT INTO workout_days(id,workout_plan_id,name,created_at,updated_at,pending_weekdays) VALUES('d1','p1','A',?,?,'[1,4]')",
      )
      .run(now, now);
    sqlite
      .prepare(
        "INSERT INTO workout_day_exercises(id,workout_day_id,exercise_id,target_sets,min_reps,max_reps,created_at,updated_at) VALUES('x1','d1','builtin-bench',3,6,10,?,?)",
      )
      .run(now, now);
    const repo = new TemplatesRepository(connection);
    const template = await repo.saveFrom('workout', 'p1', 'Upper reutilizável');
    const first = await repo.apply(template),
      second = await repo.apply(template);
    expect(first).not.toBe(second);
    expect(
      sqlite
        .prepare('SELECT count(*) n FROM workout_days WHERE workout_plan_id IN (?,?)')
        .get(first, second),
    ).toMatchObject({ n: 2 });
    expect(
      sqlite
        .prepare(
          'SELECT count(*) n FROM workout_day_exercises WHERE workout_day_id IN (SELECT id FROM workout_days WHERE workout_plan_id IN (?,?))',
        )
        .get(first, second),
    ).toMatchObject({ n: 2 });
    expect(
      sqlite
        .prepare(
          'SELECT count(*) n FROM workout_day_weekdays WHERE workout_day_id IN (SELECT id FROM workout_days WHERE workout_plan_id IN (?,?))',
        )
        .get(first, second),
    ).toMatchObject({ n: 4 });
    sqlite.prepare('UPDATE workout_days SET name=? WHERE workout_plan_id=?').run('Editado', first);
    expect(
      sqlite.prepare('SELECT name FROM workout_days WHERE workout_plan_id=?').get(second),
    ).toMatchObject({ name: 'A' });
    sqlite.close();
  });
  it('rejeita aplicação incompleta sem deixar entidades parciais', async () => {
    const { sqlite, connection } = database();
    const repo = new TemplatesRepository(connection);
    sqlite
      .prepare(
        "INSERT INTO templates(id,kind,name,payload_json,created_at,updated_at) VALUES('bad','workout','Inválido',?,datetime('now'),datetime('now'))",
      )
      .run(
        JSON.stringify({
          name: 'Plano',
          days: [
            {
              name: 'A',
              weekdays: [1],
              exercises: [{ exercise_id: 'missing', target_sets: 3, min_reps: 8, max_reps: 12 }],
            },
          ],
        }),
      );
    await expect(repo.apply('bad')).rejects.toThrow();
    expect(
      sqlite.prepare("SELECT count(*) n FROM workout_plans WHERE name='Plano'").get(),
    ).toMatchObject({ n: 0 });
    sqlite.close();
  });
  it('aplica refeição ao diário com proporção nutricional correta', async () => {
    const { sqlite, connection } = database();
    const stamp = '2026-09-28T10:00:00Z';
    sqlite
      .prepare(
        "INSERT INTO food_sources(id,name,edition,imported_at) VALUES('source','Teste','1',?)",
      )
      .run(stamp);
    sqlite
      .prepare(
        "INSERT INTO foods(id,source_id,name,is_custom,custom_nutrients_json,created_at,updated_at) VALUES('banana','source','Banana',1,?, ?,?)",
      )
      .run('{"energy_kcal":100,"protein_g":2}', stamp, stamp);
    sqlite
      .prepare("INSERT INTO meals(id,name,created_at,updated_at) VALUES('meal','Café',?,?)")
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO meal_items(id,meal_id,food_id,quantity,unit,grams_equivalent,created_at,updated_at) VALUES('item','meal','banana',150,'g',150,?,?)",
      )
      .run(stamp, stamp);
    const repo = new TemplatesRepository(connection);
    const template = await repo.saveFrom('meal', 'meal', 'Meu café');
    await repo.applyMealToDiary(template, '2026-09-28');
    expect(
      sqlite
        .prepare(
          "SELECT json_extract(nutrients_json,'$.energy_kcal') kcal,json_extract(nutrients_json,'$.protein_g') protein FROM food_diary_entries WHERE entry_date='2026-09-28'",
        )
        .get(),
    ).toMatchObject({ kcal: 150, protein: 3 });
    await repo.remove(template);
    expect(sqlite.prepare('SELECT count(*) n FROM food_diary_entries').get()).toMatchObject({
      n: 1,
    });
    sqlite.close();
  });
  it('copia projeto e tarefa sem referências mutáveis ao template', async () => {
    const { sqlite, connection } = database();
    const stamp = '2026-09-28T10:00:00Z';
    sqlite
      .prepare(
        "INSERT INTO projects(id,name,created_at,updated_at) VALUES('base-project','Original',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO project_sections(id,project_id,name,created_at,updated_at) VALUES('base-section','base-project','Planejar',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO tasks(id,title,description,project_id,project_section_id,created_at,updated_at) VALUES('base-task','Pesquisar','','base-project','base-section',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO subtasks(id,task_id,title,created_at,updated_at) VALUES('base-subtask','base-task','Comparar',?,?)",
      )
      .run(stamp, stamp);
    const repo = new TemplatesRepository(connection);
    const projectTemplate = await repo.saveFrom('project', 'base-project', 'Modelo de projeto');
    const taskTemplate = await repo.saveFrom('task', 'base-task', 'Modelo de tarefa');
    const project = await repo.apply(projectTemplate);
    const task = await repo.apply(taskTemplate);
    expect(
      sqlite
        .prepare(
          'SELECT count(*) n FROM tasks WHERE project_id=? AND project_section_id IS NOT NULL',
        )
        .get(project),
    ).toMatchObject({ n: 1 });
    expect(
      sqlite.prepare('SELECT count(*) n FROM subtasks WHERE task_id=?').get(task),
    ).toMatchObject({ n: 1 });
    await repo.remove(projectTemplate);
    await repo.remove(taskTemplate);
    expect(
      sqlite.prepare('SELECT count(*) n FROM tasks WHERE project_id=?').get(project),
    ).toMatchObject({ n: 1 });
    sqlite.close();
  });
});

describe('revisão semanal', () => {
  it('funciona sem dados e oculta valores financeiros', async () => {
    const { sqlite, connection } = database();
    const repo = new WeeklyReviewRepository(connection);
    const empty = await repo.load('2026-09-28', '2026-09-28');
    expect(empty.tasks.completed).toBe(0);
    expect(empty.nutrition.days).toBe(0);
    expect(empty.activity.days).toBe(0);
    sqlite.prepare('UPDATE finance_preferences SET hide_values=1 WHERE id=1').run();
    expect((await repo.load('2026-09-28', '2026-09-28')).finance.hidden).toBe(true);
    sqlite.close();
  });
  it('agrega dados existentes sem pontuar a semana e considera apenas dias decorridos', async () => {
    const { sqlite, connection } = database();
    const stamp = '2026-09-29T12:00:00Z';
    sqlite
      .prepare(
        "INSERT INTO projects(id,name,created_at,updated_at) VALUES('review-project','Projeto',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO tasks(id,title,project_id,created_at,updated_at,status,completed_at) VALUES('review-task','Tarefa','review-project',?,?,'completed',?)",
      )
      .run(stamp, stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO tasks(id,title,due_date,recurrence,created_at,updated_at) VALUES('review-recurring','Revisar','2026-09-28',?, ?,?)",
      )
      .run('{"frequency":"daily"}', stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO habits(id,name,frequency,kind,start_date,created_at,updated_at) VALUES('review-habit','Água','daily','boolean','2026-09-01',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO habit_entries(habit_id,entry_date,value,updated_at) VALUES('review-habit','2026-09-28',1,?)",
      )
      .run(stamp);
    sqlite
      .prepare(
        "INSERT INTO routines(id,name,frequency,created_at,updated_at) VALUES('review-routine','Noite','daily',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO routine_occurrences(id,routine_id,occurrence_date,started_at,completed_at) VALUES('review-occ','review-routine','2026-09-28',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO workout_plans(id,name,active,created_at,updated_at) VALUES('review-plan','Plano',1,?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO workout_days(id,workout_plan_id,name,created_at,updated_at,pending_weekdays) VALUES('review-day','review-plan','Upper',?,?,'[1]')",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO workout_sessions(id,workout_plan_id,workout_day_id,plan_name,day_name,session_date,started_at,finished_at,status,created_at,updated_at) VALUES('review-session','review-plan','review-day','Plano','Upper','2026-09-28','2026-09-28T10:00:00Z','2026-09-28T11:00:00Z','completed',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO daily_activity_entries(entry_date,steps,created_at,updated_at) VALUES('2026-09-28',8000,?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO body_measurement_records(record_id,measurement_date,pending_values,created_at,updated_at) VALUES('2026-09-28','2026-09-28',?, ?,?)",
      )
      .run('{"weight":91.6}', stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO body_measurement_records(record_id,measurement_date,pending_values,created_at,updated_at) VALUES('2026-09-29','2026-09-29',?, ?,?)",
      )
      .run('{"weight":91.1}', stamp, stamp);
    const repo = new WeeklyReviewRepository(connection);
    const review = await repo.load('2026-09-28', '2026-09-29');
    expect(review.tasks.completed).toBe(1);
    expect(review.next.tasks).toBe(7);
    expect(review.projects.rows[0]).toMatchObject({
      name: 'Projeto',
      total: 1,
      completed: 1,
      completedWeek: 1,
    });
    expect(review.habits).toMatchObject({ done: 1, target: 2 });
    expect(review.routines[0]).toMatchObject({ done: 1, target: 2 });
    expect(review.workouts).toMatchObject({ completed: 1, minutes: 60 });
    expect(review.activity).toMatchObject({ days: 1, steps: 8000, average: 8000 });
    expect(review.body).toEqual({ firstWeight: 91.6, lastWeight: 91.1 });
    await repo.saveNote('2026-09-28', 'Dormir mais cedo.');
    expect((await repo.load('2026-09-28', '2026-09-29')).note).toBe('Dormir mais cedo.');
    sqlite.close();
  });
});

describe('notificações locais', () => {
  it('respeita opt-in, horário, antecedência, privacidade e entrega única', async () => {
    const { sqlite, connection } = database();
    const repo = new NotificationsRepository(connection);
    const now = new Date('2026-09-28T14:25:30');
    const stamp = now.toISOString();
    sqlite
      .prepare(
        "INSERT INTO tasks(id,title,description,priority,due_date,due_time,status,created_at,updated_at,remind_minutes_before) VALUES('notify-task','Dentista','','normal','2026-09-28','14:30','pending',?,?,5)",
      )
      .run(stamp, stamp);
    expect(await repo.due(now, await repo.preferences())).toEqual([]);
    await repo.save('enabled', true);
    await repo.save('tasks', true);
    const prefs = await repo.preferences();
    const reminders = await repo.due(now, prefs);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].body).toBe('Dentista');
    expect(displayReminder(reminders[0], prefs)).toEqual({
      title: 'RUMAR',
      body: 'Você tem um lembrete.',
    });
    expect(await repo.claim(reminders[0])).toBe(true);
    expect(await repo.claim(reminders[0])).toBe(false);
    expect(dueNow('2026-09-28', '14:30', new Date('2026-09-28T14:20:00'), 5)).toBe(false);
    expect(defaultNotifications.enabled).toBe(false);
    sqlite.close();
  });
});
