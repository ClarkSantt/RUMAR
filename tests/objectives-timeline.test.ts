import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { database } from './database';
import { ObjectivesRepository, emptyObjectiveDraft } from '../src/features/objectives/repository';
import { TimelineRepository } from '../src/features/timeline/repository';
import { CalendarPreferences } from '../src/features/calendar/preferences';
import { calendarRange } from '../src/features/calendar/repository';
import { globalSearch } from '../src/features/search/repository';
import { parseQuickAdd } from '../src/features/quick-add/parser';
import { WeeklyReviewRepository } from '../src/features/weekly-review/repository';

const stamp = '2026-09-28T14:00:00Z';
const draft = (name: string) => ({ ...emptyObjectiveDraft(), name, start_date: '2026-09-28' });

describe('upgrade 1.2 → 1.3', () => {
  it('preserva dados e filtros existentes na migration 0014', () => {
    const { sqlite } = database(':memory:', 13);
    sqlite
      .prepare("INSERT INTO tasks(id,title,created_at,updated_at) VALUES('old','Anterior',?,?)")
      .run(stamp, stamp);
    sqlite
      .prepare("INSERT INTO calendar_source_preferences(source_type,visible) VALUES('habit',0)")
      .run();
    sqlite.exec('BEGIN');
    sqlite.exec(
      readFileSync(
        new URL('../src-tauri/migrations/0014_objectives_timeline.sql', import.meta.url),
        'utf8',
      ),
    );
    sqlite.exec('COMMIT');
    expect(sqlite.prepare("SELECT title FROM tasks WHERE id='old'").get()).toMatchObject({
      title: 'Anterior',
    });
    expect(
      sqlite
        .prepare("SELECT visible FROM calendar_source_preferences WHERE source_type='habit'")
        .get(),
    ).toMatchObject({ visible: 0 });
    sqlite
      .prepare("INSERT INTO calendar_source_preferences(source_type,visible) VALUES('objective',1)")
      .run();
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
    sqlite.close();
  });
});

describe('Objetivos', () => {
  it('permite vínculos múltiplos, remove somente associação e deriva Project', async () => {
    const { sqlite, connection } = database();
    sqlite
      .prepare(
        "INSERT INTO habits(id,name,frequency,kind,start_date,created_at,updated_at) VALUES('h','Caminhar','daily','boolean','2026-09-01',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Guitarra',?,?)")
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO tasks(id,title,project_id,status,completed_at,created_at,updated_at) VALUES('t1','Acordes','p','completed',?,?,?)",
      )
      .run(stamp, stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO tasks(id,title,project_id,created_at,updated_at) VALUES('t2','Escalas','p',?,?)",
      )
      .run(stamp, stamp);
    const repo = new ObjectivesRepository(connection);
    const first = await repo.create({
      ...draft('Aprender guitarra'),
      progress_mode: 'project',
      progress_ref: 'p',
    });
    const second = await repo.create(draft('Condicionamento'));
    await repo.link(first, 'project', 'p');
    await repo.link(first, 'habit', 'h');
    await repo.link(second, 'habit', 'h');
    expect(await repo.progress((await repo.get(first))!)).toMatchObject({
      current: 1,
      target: 2,
      percent: 50,
    });
    sqlite.prepare("UPDATE tasks SET status='completed',completed_at=? WHERE id='t2'").run(stamp);
    expect(await repo.progress((await repo.get(first))!)).toMatchObject({
      current: 2,
      target: 2,
      percent: 100,
    });
    const habitLink = (await repo.links(first)).find((l) => l.entity_type === 'habit')!;
    await repo.unlink(habitLink.id, first);
    expect(sqlite.prepare("SELECT name FROM habits WHERE id='h'").get()).toMatchObject({
      name: 'Caminhar',
    });
    expect((await repo.links(second)).some((l) => l.entity_id === 'h')).toBe(true);
    await repo.status(first, 'completed');
    expect(sqlite.prepare("SELECT status FROM tasks WHERE id='t2'").get()).toMatchObject({
      status: 'completed',
    });
    await repo.status(first, 'archived');
    expect((await repo.get(first))?.archived_at).toBeTruthy();
    sqlite.close();
  });
  it('cria entidade e vínculo atomicamente e limpa vínculo se entidade for excluída', async () => {
    const { sqlite, connection } = database();
    const repo = new ObjectivesRepository(connection);
    const objective = await repo.create(draft('Organizar'));
    const task = await repo.createLinked(objective, 'task', 'Revisar');
    expect((await repo.links(objective)).map((l) => l.entity_id)).toContain(task);
    sqlite.prepare('DELETE FROM tasks WHERE id=?').run(task);
    expect(await repo.links(objective)).toEqual([]);
    await expect(repo.link(objective, 'task', 'missing')).rejects.toThrow();
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
    sqlite.close();
  });
  it('deriva meta financeira e medida corporal sem duplicar fontes', async () => {
    const { sqlite, connection } = database();
    const repo = new ObjectivesRepository(connection);
    sqlite
      .prepare(
        "INSERT INTO finance_goals(id,name,target_amount_cents,initial_amount_cents,created_at,updated_at) VALUES('g','Carro',4000000,500000,?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO finance_goal_contributions(id,goal_id,date,amount_cents,created_at) VALUES('c','g','2026-09-28',350000,?)",
      )
      .run(stamp);
    const finance = await repo.create({
      ...draft('Comprar carro'),
      progress_mode: 'financial_goal',
      progress_ref: 'g',
    });
    expect(await repo.progress((await repo.get(finance))!)).toMatchObject({
      current: 8500,
      target: 40000,
    });
    sqlite
      .prepare(
        "INSERT INTO body_measurement_records(record_id,measurement_date,pending_values,created_at,updated_at) VALUES('b','2026-09-28',?, ?,?)",
      )
      .run('{"weight":90.8}', stamp, stamp);
    const body = await repo.create({
      ...draft('Composição corporal'),
      progress_mode: 'body_metric',
      progress_ref: 'weight',
      body_baseline: 93,
      body_target: 85,
    });
    expect(await repo.progress((await repo.get(body))!)).toMatchObject({
      current: 90.8,
      target: 85,
    });
    sqlite.close();
  });
});

describe('Timeline derivada', () => {
  it('ordena, pagina, filtra Objective e não duplica passos editados', async () => {
    const { sqlite, connection } = database();
    const objectives = new ObjectivesRepository(connection),
      timeline = new TimelineRepository(connection);
    const objective = await objectives.create(draft('Saúde'));
    await objectives.link(objective, 'activity', 'steps');
    sqlite
      .prepare(
        "INSERT INTO daily_activity_entries(entry_date,steps,created_at,updated_at) VALUES('2026-09-28',8000,?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare("UPDATE daily_activity_entries SET steps=9000 WHERE entry_date='2026-09-28'")
      .run();
    sqlite
      .prepare(
        "INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES('thought','Ideia','Conteúdo privado longo',?,?)",
      )
      .run(stamp, stamp);
    await timeline.saveNote('2026-09-28', 'Primeira corrida', 'Observação', objective);
    const first = await timeline.page({ from: '2026-09-01', to: '2026-09-30', limit: 2 });
    expect(first.events).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = await timeline.page({
      from: '2026-09-01',
      to: '2026-09-30',
      limit: 2,
      before: first.next!,
    });
    expect(new Set([...first.events, ...second.events].map((e) => e.id)).size).toBe(
      first.events.length + second.events.length,
    );
    const related = await timeline.page({
      from: '2026-09-01',
      to: '2026-09-30',
      objectiveId: objective,
    });
    expect(related.events.some((e) => e.id === 'steps:2026-09-28')).toBe(true);
    expect(related.events.some((e) => e.id === 'thought:thought')).toBe(false);
    expect(
      (await timeline.page({ from: '2026-09-01', to: '2026-09-30', source: 'steps' })).events,
    ).toMatchObject([{ summary: '9000 passos' }]);
    expect(
      (await timeline.page({ from: '2026-09-01', to: '2026-09-30', query: 'corrida' })).events,
    ).toHaveLength(1);
    expect(
      (await timeline.page({ from: '2026-09-01', to: '2026-09-30', source: 'thought' })).events[0]
        .summary,
    ).not.toContain('Conteúdo privado');
    sqlite.close();
  });
  it('oculta detalhes financeiros e corporais no modo privado', async () => {
    const { sqlite, connection } = database();
    const timeline = new TimelineRepository(connection);
    sqlite
      .prepare(
        "INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES('a','Conta','checking',?,?)",
      )
      .run(stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at) VALUES('f','a','2026-09-28',8340,'expense','Mercado','mercado',?,?)",
      )
      .run(stamp, stamp);
    const normal = await timeline.page({ from: '2026-09-28', to: '2026-09-28', source: 'finance' });
    expect(normal.events[0].summary).toBe('Mercado');
    sqlite.prepare('UPDATE finance_preferences SET hide_values=1 WHERE id=1').run();
    expect(
      (await timeline.page({ from: '2026-09-28', to: '2026-09-28', source: 'finance' })).events[0]
        .summary,
    ).toBe('');
    expect(
      (await timeline.page({ from: '2026-09-28', to: '2026-09-28', query: 'Mercado' })).events,
    ).toHaveLength(0);
    await timeline.setPrivateMode(true);
    expect(await timeline.privateMode()).toBe(true);
    sqlite.close();
  });
});

describe('Integrações 1.3', () => {
  it('inclui atividade vinculada na Revisão Semanal sem alterar a fonte', async () => {
    const { sqlite, connection } = database();
    const objective = await new ObjectivesRepository(connection).create(draft('Aprender violão'));
    sqlite
      .prepare(
        'INSERT INTO objective_updates(id,objective_id,content,created_at,updated_at) VALUES(?,?,?,?,?)',
      )
      .run('weekly-update', objective, 'Pratiquei acordes', stamp, stamp);
    const review = await new WeeklyReviewRepository(connection).load('2026-09-28', '2026-09-28');
    expect(review.objectives).toEqual([{ id: objective, name: 'Aprender violão', activities: 1 }]);
    expect(
      sqlite.prepare("SELECT content FROM objective_updates WHERE id='weekly-update'").get(),
    ).toMatchObject({ content: 'Pratiquei acordes' });
    sqlite.close();
  });
  it('mostra prazo do objetivo no Calendar e respeita filtros sem alterar a entidade', async () => {
    const { sqlite, connection } = database();
    const objectives = new ObjectivesRepository(connection);
    const calendar = new CalendarPreferences(connection);
    const id = await objectives.create({ ...draft('Ler 12 livros'), target_date: '2026-10-10' });
    expect(
      (await calendarRange(connection, '2026-10-10', '2026-10-10')).some((i) => i.id === id),
    ).toBe(true);
    await calendar.item('objective', id, false);
    expect(
      (await calendarRange(connection, '2026-10-10', '2026-10-10')).some((i) => i.id === id),
    ).toBe(false);
    expect((await objectives.get(id))?.name).toBe('Ler 12 livros');
    await calendar.item('objective', id, true);
    await calendar.source('objective', false);
    expect(
      (await calendarRange(connection, '2026-10-10', '2026-10-10')).some((i) => i.id === id),
    ).toBe(false);
    await calendar.source('objective', true);
    expect(
      (await calendarRange(connection, '2026-10-10', '2026-10-10')).some((i) => i.id === id),
    ).toBe(true);
    sqlite.close();
  });
  it('inclui Objetivos e Momentos na busca e aceita prefixos explícitos no Quick Add', async () => {
    const { sqlite, connection } = database();
    const id = await new ObjectivesRepository(connection).create(draft('Aprender violão'));
    await new TimelineRepository(connection).saveNote('2026-09-28', 'Primeiro acorde', '', id);
    expect(
      (await globalSearch(connection, 'violão')).some(
        (r) => r.page === 'objectives' && r.id === id,
      ),
    ).toBe(true);
    expect((await globalSearch(connection, 'acorde')).some((r) => r.page === 'timeline')).toBe(
      true,
    );
    expect(parseQuickAdd('/objetivo Aprender violão')).toMatchObject({
      kind: 'objective',
      name: 'Aprender violão',
    });
    expect(parseQuickAdd('/momento Primeiro acorde', 'auto', '2026-09-28')).toMatchObject({
      kind: 'moment',
      date: '2026-09-28',
    });
    sqlite.close();
  });
});
