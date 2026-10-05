import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { database } from './database';
import { ObjectivesRepository, emptyObjectiveDraft } from '../src/features/objectives/repository';
import {
  MilestonesRepository,
  emptyMilestone,
  parseMilestoneValue,
} from '../src/features/objectives/milestones-repository';
import { MonthlyReviewRepository } from '../src/features/monthly-review/repository';
import { TimelineRepository } from '../src/features/timeline/repository';
import { WeeklyReviewRepository } from '../src/features/weekly-review/repository';
import { calendarRange } from '../src/features/calendar/repository';
import { CalendarPreferences } from '../src/features/calendar/preferences';
import { globalSearch } from '../src/features/search/repository';
import { parseQuickAdd } from '../src/features/quick-add/parser';
const stamp = '2026-09-15T12:00:00Z';
async function objective(db: ReturnType<typeof database>['connection']) {
  return new ObjectivesRepository(db).create({
    ...emptyObjectiveDraft(),
    name: 'Aprender guitarra',
    start_date: '2026-09-01',
  });
}

describe('Marcos de objetivos', () => {
  it('resume marcos reais para a lista de objetivos sem alterar a conclusão', async () => {
    const { sqlite, connection } = database();
    const id = await objective(connection);
    const milestones = new MilestonesRepository(connection);
    const first = await milestones.save(id, { ...emptyMilestone(), title: 'Começar' });
    await milestones.save(id, { ...emptyMilestone(), title: 'Continuar' });
    await milestones.complete(first, true);
    expect(await new ObjectivesRepository(connection).milestoneCounts()).toEqual(
      expect.arrayContaining([{ objective_id: id, total: 2, completed: 1 }]),
    );
    sqlite.close();
  });
  it('trocar origem da conclusão não revive status manual antigo e confirmação repetida preserva data', async () => {
    const { sqlite, connection } = database(),
      repo = new MilestonesRepository(connection),
      id = await objective(connection),
      draft = { ...emptyMilestone(), title: 'Marco' };
    const m = await repo.save(id, draft);
    await repo.complete(m, true);
    sqlite.prepare('UPDATE objective_milestones SET completed_at=? WHERE id=?').run(stamp, m);
    await repo.complete(m, true);
    expect((await repo.list(id))[0].achieved_date).toBe('2026-09-15');
    sqlite
      .prepare(
        'INSERT INTO finance_goals(id,name,target_amount_cents,created_at,updated_at) VALUES(?,?,?,?,?)',
      )
      .run('car', 'Carro', 4000000, stamp, stamp);
    await repo.save(
      id,
      {
        ...draft,
        mode: 'financial_goal',
        financial_goal_id: 'car',
        target_value: 10000,
        unit: 'BRL',
      },
      m,
    );
    await repo.save(id, draft, m);
    expect((await repo.list(id))[0]).toMatchObject({
      effective_status: 'pending',
      completed_at: null,
    });
    sqlite.close();
  });
  it('reordena por arraste e teclado mesmo após exclusões deixarem lacunas', async () => {
    const { sqlite, connection } = database(),
      repo = new MilestonesRepository(connection),
      id = await objective(connection);
    const ids = [];
    for (const title of ['A', 'B', 'C', 'D', 'E'])
      ids.push(await repo.save(id, { ...emptyMilestone(), title }));
    await repo.remove(ids[1]);
    await repo.move(ids[4], -1);
    expect((await repo.list(id)).map((m) => m.title)).toEqual(['A', 'C', 'E', 'D']);
    await repo.place(ids[0], ids[3]);
    expect((await repo.list(id)).map((m) => m.title)).toEqual(['C', 'E', 'D', 'A']);
    const other = await objective(connection),
      foreign = await repo.save(other, { ...emptyMilestone(), title: 'Outro' });
    await repo.place(ids[0], foreign);
    expect((await repo.list(id)).map((m) => m.title)).toEqual(['C', 'E', 'D', 'A']);
    sqlite.close();
  });
  it('interpreta valores financeiros com separadores pt-BR sem truncar milhares', () => {
    expect(parseMilestoneValue('10.000', 'financial_goal')).toBe(10000);
    expect(parseMilestoneValue('10.000,50', 'financial_goal')).toBe(10000.5);
    expect(parseMilestoneValue('5,5', 'manual')).toBe(5.5);
  });
  it('cria, edita, reordena, conclui e reabre sem concluir ou excluir o objetivo', async () => {
    const { sqlite, connection } = database(),
      repo = new MilestonesRepository(connection),
      id = await objective(connection);
    const a = await repo.save(id, { ...emptyMilestone(), title: 'Acordes' }),
      b = await repo.save(id, { ...emptyMilestone(), title: 'Primeira música' }),
      c = await repo.save(id, { ...emptyMilestone(), title: 'Pestana' });
    await repo.move(c, -1);
    expect((await repo.list(id)).map((m) => m.id)).toEqual([a, c, b]);
    await repo.save(
      id,
      { ...emptyMilestone(), title: 'Acordes básicos', target_value: 5, unit: 'acordes' },
      a,
    );
    for (const key of [a, b, c]) await repo.complete(key, true);
    expect((await repo.list(id)).every((m) => m.effective_status === 'completed')).toBe(true);
    expect((await new ObjectivesRepository(connection).get(id))?.status).toBe('active');
    await repo.complete(a, true);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) count FROM automation_events WHERE trigger_type='milestone_completed'",
        )
        .get(),
    ).toMatchObject({ count: 3 });
    await repo.complete(a, false);
    expect((await repo.list(id)).find((m) => m.id === a)?.effective_status).toBe('pending');
    await new ObjectivesRepository(connection).status(id, 'archived');
    expect(await repo.list(id)).toHaveLength(3);
    await repo.remove(a);
    expect((await new ObjectivesRepository(connection).get(id))?.id).toBe(id);
    expect(await repo.list(id)).toHaveLength(2);
    await expect(
      repo.save(id, { ...emptyMilestone(), title: 'Inválido', target_value: NaN }),
    ).rejects.toThrow();
    sqlite.close();
  });
  it('deriva meta financeira e data de cruzamento, recalculando após correções e exclusão da fonte', async () => {
    const { sqlite, connection } = database(),
      repo = new MilestonesRepository(connection),
      id = await objective(connection);
    sqlite
      .prepare(
        'INSERT INTO finance_goals(id,name,target_amount_cents,initial_amount_cents,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run('car', 'Carro', 4000000, 500000, stamp, stamp);
    const milestone = await repo.save(id, {
      ...emptyMilestone(),
      title: 'R$ 10.000',
      mode: 'financial_goal',
      target_value: 10000,
      unit: 'BRL',
      financial_goal_id: 'car',
    });
    expect((await repo.list(id))[0].effective_status).toBe('pending');
    sqlite
      .prepare(
        'INSERT INTO finance_goal_contributions(id,goal_id,date,amount_cents,created_at) VALUES(?,?,?,?,?)',
      )
      .run('c1', 'car', '2026-09-17', 500000, stamp);
    expect((await repo.list(id))[0]).toMatchObject({
      effective_status: 'completed',
      achieved_date: '2026-09-17',
    });
    expect(await repo.completedRange('2026-09-01', '2026-09-30')).toHaveLength(1);
    sqlite
      .prepare('UPDATE finance_goal_contributions SET amount_cents=400000 WHERE id=?')
      .run('c1');
    expect((await repo.list(id))[0]).toMatchObject({
      effective_status: 'pending',
      achieved_date: null,
    });
    await repo.complete(milestone, true);
    expect((await repo.list(id))[0].effective_status).toBe('pending');
    sqlite.prepare('DELETE FROM finance_goals WHERE id=?').run('car');
    expect((await repo.list(id))[0]).toMatchObject({
      financial_goal_id: null,
      effective_status: 'pending',
    });
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    sqlite.close();
  });
  it('integra calendário, filtros, Timeline, revisão semanal, busca e /marco', async () => {
    const { sqlite, connection } = database(),
      repo = new MilestonesRepository(connection),
      id = await objective(connection);
    const m = await repo.save(id, {
      ...emptyMilestone(),
      title: 'Aprender pestana',
      target_date: '2026-09-18',
    });
    await repo.complete(m, true);
    sqlite.prepare('UPDATE objective_milestones SET completed_at=? WHERE id=?').run(stamp, m);
    expect(
      (await calendarRange(connection, '2026-09-01', '2026-09-30')).find(
        (i) => i.kind === 'milestone',
      ),
    ).toMatchObject({ id: m, objectiveId: id, completed: true });
    await new CalendarPreferences(connection).source('milestone', false);
    expect(
      (await calendarRange(connection, '2026-09-01', '2026-09-30')).some(
        (i) => i.kind === 'milestone',
      ),
    ).toBe(false);
    expect(await repo.list(id)).toHaveLength(1);
    expect(
      (
        await new TimelineRepository(connection).page({
          from: '2026-09-01',
          to: '2026-09-30',
          source: 'milestone',
        })
      ).events[0],
    ).toMatchObject({
      objective_id: id,
      summary: 'Aprender pestana · Objetivo: Aprender guitarra',
    });
    expect((await new WeeklyReviewRepository(connection).load('2026-09-15')).milestones[0].id).toBe(
      m,
    );
    expect(
      (await globalSearch(connection, 'pestana')).find((r) => r.group === 'Marcos'),
    ).toMatchObject({ id: m, contextId: id, page: 'objectives' });
    expect(parseQuickAdd('/marco Aprender pestana')).toEqual({
      kind: 'milestone',
      title: 'Aprender pestana',
    });
    sqlite.close();
  });
});

function fixture(sqlite: ReturnType<typeof database>['sqlite']) {
  sqlite.exec(`INSERT INTO tasks(id,title,due_date,status,completed_at,created_at,updated_at) VALUES('done','Tarefa','2026-09-15','completed','${stamp}','${stamp}','${stamp}');
 INSERT INTO tasks(id,title,due_date,created_at,updated_at) VALUES('pending','Pendente','2026-09-29','${stamp}','${stamp}');
 INSERT INTO projects(id,name,status,completed_at,created_at,updated_at) VALUES('project','Projeto','completed','${stamp}','${stamp}','${stamp}');
 INSERT INTO habits(id,name,frequency,kind,start_date,weekdays,created_at,updated_at) VALUES('habit','Guitarra','weekdays','boolean','2026-09-01','[2]','${stamp}','${stamp}');
 INSERT INTO habit_entries(habit_id,entry_date,value,updated_at) VALUES('habit','2026-09-15',1,'${stamp}');
 INSERT INTO routines(id,name,frequency,created_at,updated_at) VALUES('routine','Noite','daily','${stamp}','${stamp}');
 INSERT INTO routine_occurrences(id,routine_id,occurrence_date,started_at,completed_at) VALUES('ro','routine','2026-09-15','${stamp}','${stamp}');
 INSERT INTO workout_sessions(id,plan_name,day_name,session_date,started_at,finished_at,status,created_at,updated_at) VALUES('session','Plano','Upper','2026-09-15','2026-09-15T11:00:00Z','${stamp}','completed','${stamp}','${stamp}'),('previous','Plano','Upper','2026-08-15','2026-08-15T11:00:00Z','2026-08-15T12:00:00Z','completed','${stamp}','${stamp}');
 INSERT INTO daily_activity_entries(entry_date,steps,created_at,updated_at) VALUES('2026-09-15',8000,'${stamp}','${stamp}'),('2026-09-16',10000,'${stamp}','${stamp}'),('2026-08-15',6000,'${stamp}','${stamp}');
 INSERT INTO body_measurement_records(record_id,measurement_date,pending_values,created_at,updated_at) VALUES('body1','2026-09-01','{"weight":91.8,"waist":93}','${stamp}','${stamp}'),('body2','2026-09-15','{"weight":90.6,"waist":91}','${stamp}','${stamp}');
 INSERT INTO foods(id,source_id,name,base_amount,base_unit,is_custom,created_at,updated_at) VALUES('food','custom','Aveia',100,'g',1,'${stamp}','${stamp}');
 INSERT INTO food_diary_entries(id,entry_date,food_id,food_name,quantity,unit,grams_equivalent,nutrients_json,created_at,updated_at) VALUES('diary1','2026-09-15','food','Aveia',100,'g',100,'{"energy_kcal":2200,"protein_g":160}','${stamp}','${stamp}'),('diary2','2026-09-16','food','Aveia',100,'g',100,'{"energy_kcal":2000,"protein_g":140}','${stamp}','${stamp}');
 INSERT INTO finance_accounts(id,name,type,opening_balance_cents,created_at,updated_at) VALUES('account','Conta','checking',0,'${stamp}','${stamp}');
 INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at) VALUES('income','account','2026-09-15',280000,'income','Receita','receita','${stamp}','${stamp}'),('expense','account','2026-09-15',174000,'expense','Mercado','mercado','${stamp}','${stamp}');
 INSERT INTO focus_sessions(id,title,started_at,ended_at,focused_seconds,status,last_checkpoint,created_at) VALUES('focus','Estudar','2026-09-15T11:00:00Z','${stamp}',1800,'completed','${stamp}','${stamp}');
 INSERT INTO planner_time_blocks(id,block_date,start_time,end_time,title,created_at,updated_at) VALUES('block','2026-09-15','19:00','20:30','Estudar','${stamp}','${stamp}');
 INSERT INTO timeline_notes(id,event_date,title,content,created_at,updated_at) VALUES('moment','2026-09-15','Primeira música','Nota pessoal','${stamp}','${stamp}');`);
}
describe('Revisão mensal', () => {
  it('agrega fontes reais, compara mês anterior e mantém nota separada das métricas', async () => {
    const { sqlite, connection } = database();
    fixture(sqlite);
    const id = await objective(connection),
      milestones = new MilestonesRepository(connection),
      m = await milestones.save(id, { ...emptyMilestone(), title: 'Pestana' });
    await milestones.complete(m, true);
    sqlite.prepare('UPDATE objective_milestones SET completed_at=? WHERE id=?').run(stamp, m);
    const repo = new MonthlyReviewRepository(connection);
    await repo.saveNote('2026-09-15', 'Organizei meus horários.');
    const result = await repo.load('2026-09-15', '2026-09-30');
    expect(result.tasks).toEqual({ completed: 1, pending: 1 });
    expect(result.projects).toEqual({ completed: 1, withActivity: 1 });
    expect(result.milestones).toHaveLength(1);
    expect(result.habits).toEqual({ done: 1, target: 5 });
    expect(result.routines).toBe(1);
    expect(result.workouts).toMatchObject({ sessions: 1, minutes: 60 });
    expect(result.workouts.estimatedCalories).toBeCloseTo((((3.5 - 1) * 3.5 * 90.6) / 200) * 60);
    expect(result.objectives.withActivity).toBe(1);
    expect(result.focus).toEqual({ sessions: 1, seconds: 1800 });
    expect(result.planningSeconds).toBe(5400);
    expect(result.activity).toEqual({ days: 2, steps: 18000, average: 9000 });
    expect(result.body.find((b) => b.metric_key === 'weight')).toMatchObject({
      first: 91.8,
      last: 90.6,
      records: 2,
    });
    expect(result.nutrition).toMatchObject({ days: 2, caloriesAverage: 2100, proteinAverage: 150 });
    expect(result.finance).toMatchObject({ income: 280000, expense: 174000, hidden: false });
    expect(result.previous).toEqual({
      month: '2026-08-01',
      workouts: 1,
      averageSteps: 6000,
      registeredDays: 1,
    });
    expect(result.note).toBe('Organizei meus horários.');
    expect(result.moments.some((m) => m.title === 'Primeira música')).toBe(true);
    sqlite.close();
  });
  it('ignora registros realizados em dias futuros e não considera futuro falha no mês parcial', async () => {
    const { sqlite, connection } = database();
    fixture(sqlite);
    const result = await new MonthlyReviewRepository(connection).load('2026-09-01', '2026-09-10');
    expect(result.elapsedDays).toBe(10);
    expect(result.monthDays).toBe(30);
    expect(result.workouts.sessions).toBe(0);
    expect(result.activity.days).toBe(0);
    expect(result.nutrition.days).toBe(0);
    expect(result.habits.target).toBe(2);
    await expect(
      new MonthlyReviewRepository(connection).load('2026-10-01', '2026-09-10'),
    ).rejects.toThrow();
    sqlite.close();
  });
  it('revisão vazia funciona e nota pode ser removida sem snapshot de agregações', async () => {
    const { sqlite, connection } = database(),
      repo = new MonthlyReviewRepository(connection);
    const result = await repo.load('2026-09-01', '2026-09-15');
    expect(result.tasks).toEqual({ completed: 0, pending: 0 });
    expect(result.focus.seconds).toBe(0);
    expect(result.nutrition.balance).toBeNull();
    await repo.saveNote('2026-09-15', 'Nota');
    expect((await repo.load('2026-09-01', '2026-09-15')).note).toBe('Nota');
    await repo.saveNote('2026-09-01', '');
    expect(sqlite.prepare('SELECT COUNT(*) count FROM monthly_review_notes').get()).toMatchObject({
      count: 0,
    });
    sqlite.close();
  });
  it('redige valores financeiros e dados pessoais no modo privado em revisão, busca e Timeline', async () => {
    const { sqlite, connection } = database();
    fixture(sqlite);
    const id = await objective(connection),
      milestones = new MilestonesRepository(connection),
      m = await milestones.save(id, {
        ...emptyMilestone(),
        title: 'R$ 10.000',
        target_value: 10000,
        unit: 'BRL',
      });
    await milestones.complete(m, true);
    sqlite.prepare('UPDATE objective_milestones SET completed_at=? WHERE id=?').run(stamp, m);
    sqlite.exec('UPDATE finance_preferences SET hide_values=1');
    const repo = new MonthlyReviewRepository(connection);
    let result = await repo.load('2026-09-01', '2026-09-30');
    expect(result.finance).toEqual({ hidden: true, income: 0, expense: 0, categories: [] });
    expect(result.milestones[0]).toMatchObject({
      title: 'Marco financeiro',
      target_value: null,
      hidden: true,
    });
    expect((await globalSearch(connection, '10.000')).some((r) => r.group === 'Marcos')).toBe(
      false,
    );
    expect(
      (
        await new TimelineRepository(connection).page({
          from: '2026-09-01',
          to: '2026-09-30',
          source: 'milestone',
        })
      ).events[0].summary,
    ).toBe('');
    await repo.saveNote('2026-09-01', 'Texto pessoal');
    await new TimelineRepository(connection).setPrivateMode(true);
    result = await repo.load('2026-09-01', '2026-09-30');
    expect(result.privateMode).toBe(true);
    expect(result.body).toEqual([]);
    expect(result.moments).toEqual([]);
    expect(result.note).toBe('');
    sqlite.close();
  });
  it('preserva marcos e nota mensal ao fechar e reabrir SQLite isolado', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'rumo-v150-monthly-')),
      file = join(folder, 'test.db');
    try {
      let db = database(file);
      const id = await objective(db.connection),
        repo = new MilestonesRepository(db.connection);
      await repo.save(id, { ...emptyMilestone(), title: 'Primeira música' });
      await new MonthlyReviewRepository(db.connection).saveNote('2026-09-01', 'Nota persistente');
      db.sqlite.close();
      db = database(file);
      expect((await new MilestonesRepository(db.connection).list(id))[0].title).toBe(
        'Primeira música',
      );
      expect(
        (await new MonthlyReviewRepository(db.connection).load('2026-09-01', '2026-09-30')).note,
      ).toBe('Nota persistente');
      db.sqlite.close();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it('upgrade 16→19 mantém linhas e preferências antigas, com integridade referencial', () => {
    const { sqlite } = database(':memory:', 16);
    fixture(sqlite);
    sqlite
      .prepare('INSERT INTO tasks(id,title,created_at,updated_at) VALUES(?,?,?,?)')
      .run('old', 'Anterior', stamp, stamp);
    sqlite.exec("INSERT INTO calendar_source_preferences VALUES('habit',0)");
    const old = sqlite.prepare('SELECT * FROM tasks').all();
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const preserved = tables
      .filter(({ name }) => name !== 'calendar_source_preferences')
      .map(({ name }) => {
        const columns = (sqlite.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[])
          .map(({ name }) => `"${name}"`)
          .join(',');
        const query = `SELECT ${columns} FROM "${name}"`;
        return { query, rows: sqlite.prepare(query).all() };
      });
    sqlite.exec(
      readFileSync(resolve('src-tauri/migrations/0017_automations_recurrence.sql'), 'utf8'),
    );
    sqlite.exec(
      readFileSync(resolve('src-tauri/migrations/0018_objective_milestones_reviews.sql'), 'utf8'),
    );
    sqlite.exec(
      readFileSync(resolve('src-tauri/migrations/0019_automation_milestone_events.sql'), 'utf8'),
    );
    for (const { query, rows } of preserved) expect(sqlite.prepare(query).all()).toEqual(rows);
    expect(sqlite.prepare('SELECT * FROM tasks').all()).toEqual(old);
    expect(
      sqlite
        .prepare("SELECT visible FROM calendar_source_preferences WHERE source_type='habit'")
        .get(),
    ).toMatchObject({ visible: 0 });
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    sqlite.close();
  });
});
