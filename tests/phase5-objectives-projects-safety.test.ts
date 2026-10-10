import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { database } from './database';
import {
  ObjectivesRepository,
  emptyObjectiveDraft,
  emptyWishDraft,
} from '../src/features/objectives/repository';
import { DependenciesRepository } from '../src/features/dependencies/repository';
import { TrashRepository } from '../src/features/trash/repository';
import { VersionsRepository } from '../src/features/versions/repository';
import { Repository } from '../src/services/repository';
import { ProjectsRepository } from '../src/features/projects/repository';
import { PlanningRepository } from '../src/features/planning/repository';
import { commandSuggestions, hasDestructiveCommand } from '../src/features/search/commands';
import { globalSearch } from '../src/features/search/repository';
import { TimelineRepository } from '../src/features/timeline/repository';
import type { Task } from '../src/types/models';

const insertTask = (sqlite: ReturnType<typeof database>['sqlite'], id: string, title: string) =>
  sqlite
    .prepare('INSERT INTO tasks(id,title,created_at,updated_at) VALUES(?,?,?,?)')
    .run(id, title, '2026-10-09T10:00:00Z', '2026-10-09T10:00:00Z');
const insertProject = (sqlite: ReturnType<typeof database>['sqlite'], id: string, name: string) =>
  sqlite
    .prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)')
    .run(id, name, '2026-10-09T10:00:00Z', '2026-10-09T10:00:00Z');

describe('Phase 5 migration', () => {
  it('creates a fresh schema 33 with healthy integrity and foreign keys', () => {
    const db = database();
    expect(db.sqlite.prepare('SELECT max(version) version FROM test_migrations').get()).toEqual({
      version: 33,
    });
    expect(db.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_versions'")
        .get(),
    ).toEqual({ name: 'entity_versions' });
    db.sqlite.close();
  });

  it('upgrades schema 32, preserves rows and keeps migrations 1-32 pinned', () => {
    const db = database(':memory:', 32);
    insertTask(db.sqlite, 'legacy-task', 'Task legado');
    insertProject(db.sqlite, 'legacy-project', 'Project legado');
    db.sqlite.exec(
      readFileSync('src-tauri/migrations/0033_objectives_projects_safety.sql', 'utf8'),
    );
    expect(db.sqlite.prepare('SELECT title FROM tasks WHERE id=?').get('legacy-task')).toEqual({
      title: 'Task legado',
    });
    expect(db.sqlite.prepare('SELECT name FROM projects WHERE id=?').get('legacy-project')).toEqual(
      { name: 'Project legado' },
    );
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const checksums = readFileSync('tests/migration-checksums.test.ts', 'utf8');
    for (let version = 1; version <= 32; version++)
      expect(checksums).toContain(`'${String(version).padStart(4, '0')}_`);
    const rust = readFileSync('src-tauri/src/lib.rs', 'utf8');
    expect(rust).toContain('version: 33');
    db.sqlite.close();
  });
});

describe('Objectives 2.0 and wishes', () => {
  it('supports horizon, relationships and derived task progress without completing linked entities', async () => {
    const db = database();
    const repo = new ObjectivesRepository(db.connection);
    insertTask(db.sqlite, 't1', 'Primeira entrega');
    insertTask(db.sqlite, 't2', 'Segunda entrega');
    insertProject(db.sqlite, 'p1', 'Project vinculado');
    const id = await repo.create({
      ...emptyObjectiveDraft(),
      name: 'Lançar produto',
      horizon: 'quarter',
      horizon_label: 'Q1 2027',
      progress_strategy: 'tasks',
    });
    await repo.link(id, 'task', 't1');
    await repo.link(id, 'task', 't2');
    await repo.link(id, 'project', 'p1');
    db.sqlite
      .prepare("UPDATE tasks SET status='completed',completed_at=updated_at WHERE id='t1'")
      .run();
    const objective = await repo.get(id);
    expect(objective?.horizon_label).toBe('Q1 2027');
    expect((await repo.progress(objective!))?.percent).toBe(50);
    await repo.status(id, 'completed');
    expect(db.sqlite.prepare("SELECT status FROM projects WHERE id='p1'").get()).toEqual({
      status: 'active',
    });
    const timeline = await new TimelineRepository(db.connection).page({
      from: '2026-01-01',
      to: '2027-12-31',
      limit: 20,
    });
    expect(
      timeline.events.filter((event) => event.event_type === 'objective.completed'),
    ).toHaveLength(1);
    db.sqlite.close();
  });

  it('keeps objectives without deadlines accessible and unlinks without changing source records', async () => {
    const db = database();
    const repo = new ObjectivesRepository(db.connection);
    insertTask(db.sqlite, 'source-task', 'Task independente');
    const id = await repo.create({
      ...emptyObjectiveDraft(),
      name: 'Objetivo sem prazo',
      horizon: 'long_term',
      target_date: null,
    });
    await repo.link(id, 'task', 'source-task');
    const [link] = await repo.links(id);
    await repo.unlink(link.id, id);
    expect((await repo.get(id))?.target_date).toBeNull();
    expect(await repo.links(id)).toEqual([]);
    expect(db.sqlite.prepare("SELECT title FROM tasks WHERE id='source-task'").get()).toEqual({
      title: 'Task independente',
    });
    db.sqlite.close();
  });

  it('derives ready from the linked Finance Goal and never creates a transaction automatically', async () => {
    const db = database();
    const repo = new ObjectivesRepository(db.connection);
    db.sqlite
      .prepare(
        `INSERT INTO finance_goals(id,name,target_amount_cents,initial_amount_cents,created_at,updated_at) VALUES('g1','Reserva',100000,10000,'2026','2026')`,
      )
      .run();
    const id = await repo.create({
      ...emptyObjectiveDraft(),
      name: 'Notebook',
      objective_kind: 'wish',
    });
    await repo.saveWish(id, {
      ...emptyWishDraft(),
      target_price_cents: 50000,
      current_price_cents: 55000,
      finance_goal_id: 'g1',
    });
    db.sqlite
      .prepare(
        `INSERT INTO finance_goal_contributions(id,goal_id,date,amount_cents,created_at) VALUES('c1','g1','2026-10-09',40000,'2026-10-09T10:00:00Z')`,
      )
      .run();
    expect((await repo.wish(id))?.effective_status).toBe('ready');
    expect(
      db.sqlite
        .prepare("SELECT count(*) count FROM activity_events WHERE event_type='wish.ready'")
        .get(),
    ).toEqual({ count: 1 });
    db.sqlite
      .prepare(
        `INSERT INTO finance_goal_contributions(id,goal_id,date,amount_cents,created_at) VALUES('c2','g1','2026-10-10',1000,'2026-10-10T10:00:00Z')`,
      )
      .run();
    expect(
      db.sqlite
        .prepare("SELECT count(*) count FROM activity_events WHERE event_type='wish.ready'")
        .get(),
    ).toEqual({ count: 1 });
    await repo.saveWish(id, {
      ...emptyWishDraft(),
      target_price_cents: 60000,
      finance_goal_id: 'g1',
      status: 'purchased',
    });
    expect(
      db.sqlite.prepare("SELECT target_amount_cents FROM finance_goals WHERE id='g1'").get(),
    ).toEqual({ target_amount_cents: 100000 });
    expect(db.sqlite.prepare('SELECT count(*) count FROM finance_transactions').get()).toEqual({
      count: 0,
    });
    expect(
      db.sqlite
        .prepare("SELECT count(*) count FROM activity_events WHERE event_type='wish.purchased'")
        .get(),
    ).toEqual({ count: 1 });
    const timeline = await new TimelineRepository(db.connection).page({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(timeline.events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(['wish.ready', 'wish.purchased']),
    );
    db.sqlite.close();
  });

  it('stores Wish metadata, uses managed objective attachments and changes Finance target only explicitly', async () => {
    const db = database();
    const repo = new ObjectivesRepository(db.connection);
    db.sqlite
      .prepare(
        `INSERT INTO finance_goals(id,name,target_amount_cents,initial_amount_cents,created_at,updated_at) VALUES('g1','Reserva',100000,10000,'2026','2026')`,
      )
      .run();
    const id = await repo.create({
      ...emptyObjectiveDraft(),
      name: 'Câmera',
      objective_kind: 'wish',
    });
    await repo.saveWish(id, {
      ...emptyWishDraft(),
      product_url: 'https://example.com/camera',
      current_price_cents: 650000,
      target_price_cents: 550000,
      original_price_cents: 700000,
      currency: 'BRL',
      priority: 'high',
      finance_goal_id: 'g1',
    });
    await repo.setFinancialGoalLink(id, 'g1');
    const attachmentId = '00000000-0000-4000-8000-000000000001';
    db.sqlite
      .prepare(
        `INSERT INTO attachments(id,entity_type,entity_id,original_name,stored_name,relative_path,mime_type,file_size,sha256,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        attachmentId,
        'objective',
        id,
        'camera.webp',
        'file.webp',
        `attachments/${attachmentId}/file.webp`,
        'image/webp',
        10,
        '0'.repeat(64),
        '2026-10-09T10:00:00Z',
        '2026-10-09T10:00:00Z',
      );
    expect(await repo.wish(id)).toMatchObject({
      original_price_cents: 700000,
      currency: 'BRL',
      priority: 'high',
    });
    expect(
      db.sqlite.prepare("SELECT target_amount_cents FROM finance_goals WHERE id='g1'").get(),
    ).toEqual({
      target_amount_cents: 100000,
    });
    await repo.updateFinanceGoalTarget('g1', 550000);
    expect(
      db.sqlite.prepare("SELECT target_amount_cents FROM finance_goals WHERE id='g1'").get(),
    ).toEqual({
      target_amount_cents: 550000,
    });
    expect(
      db.sqlite.prepare('SELECT entity_id FROM attachments WHERE id=?').get(attachmentId),
    ).toEqual({
      entity_id: id,
    });
    db.sqlite.close();
  });

  it('respects hidden Finance values for Wish progress', async () => {
    const db = database();
    const repo = new ObjectivesRepository(db.connection);
    db.sqlite
      .prepare(
        `INSERT INTO finance_goals(id,name,target_amount_cents,initial_amount_cents,created_at,updated_at) VALUES('g1','Reserva',100000,25000,'2026','2026')`,
      )
      .run();
    const id = await repo.create({
      ...emptyObjectiveDraft(),
      name: 'Notebook privado',
      objective_kind: 'wish',
    });
    await repo.saveWish(id, {
      ...emptyWishDraft(),
      target_price_cents: 100000,
      finance_goal_id: 'g1',
    });
    db.sqlite.prepare('UPDATE finance_preferences SET hide_values=1 WHERE id=1').run();
    expect(await repo.progress((await repo.get(id))!)).toMatchObject({
      hidden: true,
      percent: null,
    });
    db.sqlite.close();
  });

  it('calculates increasing and decreasing numeric progress deterministically', async () => {
    const db = database();
    const repo = new ObjectivesRepository(db.connection);
    const draft = {
      ...emptyObjectiveDraft(),
      name: 'Chegar a 85 kg',
      progress_strategy: 'numeric' as const,
      progress_direction: 'decrease' as const,
      numeric_start: 93,
      numeric_current: 89,
      numeric_target: 85,
      numeric_unit: 'kg',
    };
    const id = await repo.create(draft);
    expect((await repo.progress((await repo.get(id))!))?.percent).toBe(50);
    db.sqlite.close();
  });

  it('supports manual, Project, Habit and Finance Goal progress without duplicated data', async () => {
    const db = database();
    const repo = new ObjectivesRepository(db.connection);
    insertProject(db.sqlite, 'p1', 'Project concluído');
    db.sqlite.prepare("UPDATE projects SET status='completed' WHERE id='p1'").run();
    db.sqlite
      .prepare(
        `INSERT INTO habits(id,name,frequency,kind,target_value,start_date,created_at,updated_at) VALUES('h1','Leitura','daily','quantity',20,'2026-01-01','2026','2026')`,
      )
      .run();
    db.sqlite
      .prepare(
        "INSERT INTO habit_entries(habit_id,entry_date,value,updated_at) VALUES('h1',date('now','localtime'),20,'2026')",
      )
      .run();
    db.sqlite
      .prepare(
        `INSERT INTO finance_goals(id,name,target_amount_cents,initial_amount_cents,created_at,updated_at) VALUES('g1','Reserva',100000,25000,'2026','2026')`,
      )
      .run();
    const manual = await repo.create({
      ...emptyObjectiveDraft(),
      name: 'Manual',
      progress_strategy: 'manual',
      numeric_current: 42,
    });
    const projects = await repo.create({
      ...emptyObjectiveDraft(),
      name: 'Projects',
      progress_strategy: 'projects',
    });
    const habits = await repo.create({
      ...emptyObjectiveDraft(),
      name: 'Hábitos',
      progress_strategy: 'habits',
    });
    const finance = await repo.create({
      ...emptyObjectiveDraft(),
      name: 'Financeiro',
      progress_strategy: 'financial_goal',
      progress_ref: 'g1',
    });
    await repo.link(projects, 'project', 'p1');
    await repo.link(habits, 'habit', 'h1');
    await repo.link(finance, 'financial_goal', 'g1');
    expect((await repo.progress((await repo.get(manual))!))?.percent).toBe(42);
    expect((await repo.progress((await repo.get(projects))!))?.percent).toBe(100);
    expect((await repo.progress((await repo.get(habits))!))?.percent).toBe(100);
    expect((await repo.progress((await repo.get(finance))!))?.percent).toBe(25);
    db.sqlite.close();
  });
});

describe('dependencies and blockers', () => {
  it('derives Task blocking, rejects cycles and unlocks after predecessor completion', async () => {
    const db = database();
    insertTask(db.sqlite, 'a', 'Executar');
    insertTask(db.sqlite, 'b', 'Preparar');
    const deps = new DependenciesRepository(db.connection);
    await expect(deps.addTaskDependency('a', 'a')).rejects.toThrow(/mesma/);
    await deps.addTaskDependency('a', 'b');
    await expect(deps.addTaskDependency('b', 'a')).rejects.toThrow(/ciclo/);
    const tasks = new Repository(db.connection);
    const row = db.sqlite.prepare("SELECT * FROM tasks WHERE id='a'").get() as unknown as Task;
    row.recurrence = null;
    await expect(tasks.setComplete(row, null, true)).rejects.toThrow(/dependências/);
    db.sqlite.prepare("UPDATE tasks SET status='completed' WHERE id='b'").run();
    await tasks.setComplete(row, null, true);
    expect(db.sqlite.prepare("SELECT status FROM tasks WHERE id='a'").get()).toEqual({
      status: 'completed',
    });
    db.sqlite.close();
  });

  it('rejects Project cycles and requires dependencies and manual blockers to be resolved', async () => {
    const db = database();
    insertProject(db.sqlite, 'a', 'Entrega');
    insertProject(db.sqlite, 'b', 'Fundação');
    const deps = new DependenciesRepository(db.connection);
    await expect(deps.addProjectDependency('a', 'a')).rejects.toThrow(/mesmo/);
    await deps.addProjectDependency('a', 'b');
    await expect(deps.addProjectDependency('b', 'a')).rejects.toThrow(/ciclo/);
    await deps.addBlocker('a', 'Aguardar aprovação');
    const projects = new ProjectsRepository(db.connection);
    await expect(projects.setStatus('a', 'completed', true)).rejects.toThrow(/bloqueios/);
    const blockers = await deps.blockers('a');
    expect(blockers).toHaveLength(1);
    await deps.resolveBlocker(blockers[0].id);
    expect((await deps.blockers('a'))[0].resolved_at).not.toBeNull();
    db.sqlite.prepare("UPDATE projects SET status='completed' WHERE id='b'").run();
    await projects.setStatus('a', 'completed', true);
    expect(db.sqlite.prepare("SELECT status FROM projects WHERE id='a'").get()).toEqual({
      status: 'completed',
    });
    db.sqlite.close();
  });

  it('keeps future Planning rows and exposes their derived blocked state', async () => {
    const db = database();
    insertTask(db.sqlite, 'a', 'Executar publicação');
    insertTask(db.sqlite, 'b', 'Obter aprovação');
    await new DependenciesRepository(db.connection).addTaskDependency('a', 'b');
    const planning = new PlanningRepository(db.connection);
    const id = await planning.save({
      date: '2026-12-01',
      title: 'Executar publicação',
      notes: '',
      schedule: 'fixed',
      startTime: '14:00',
      endTime: '15:00',
      dayPeriod: null,
      sourceType: 'task',
      sourceId: 'a',
    });
    const row = await planning.get(id);
    expect(row?.source_blocked).toBe(1);
    expect(
      db.sqlite.prepare('SELECT count(*) count FROM planner_time_blocks WHERE id=?').get(id),
    ).toEqual({ count: 1 });
    db.sqlite.prepare("UPDATE tasks SET status='completed' WHERE id='b'").run();
    expect((await planning.get(id))?.source_blocked).toBe(0);
    db.sqlite.close();
  });
});

describe('universal Trash, Undo and versions', () => {
  it('restores the same IDs and relationships and only permanently deletes confirmed Trash rows', async () => {
    const db = database();
    insertTask(db.sqlite, 'a', 'Dependente');
    insertTask(db.sqlite, 'b', 'Anterior');
    db.sqlite
      .prepare(
        "INSERT INTO task_dependencies(task_id,predecessor_id,created_at) VALUES('a','b','2026')",
      )
      .run();
    const trash = new TrashRepository(db.connection);
    await trash.trash('task', 'a');
    expect((await trash.list()).map((row) => row.id)).toContain('a');
    await trash.trash('task', 'a', false);
    expect(
      db.sqlite.prepare("SELECT count(*) count FROM task_dependencies WHERE task_id='a'").get(),
    ).toEqual({ count: 1 });
    await trash.trash('task', 'a');
    await expect(trash.permanentlyDelete('task', 'a', false)).rejects.toThrow(/Confirme/);
    await trash.permanentlyDelete('task', 'a', true);
    expect(db.sqlite.prepare("SELECT count(*) count FROM tasks WHERE id='a'").get()).toEqual({
      count: 0,
    });
    db.sqlite.close();
  });

  it('captures meaningful previous states and restores Thoughts safely', async () => {
    const db = database();
    db.sqlite
      .prepare(
        "INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES('th','Antes','Texto anterior','2026-10-09T10:00:00Z','2026-10-09T10:00:00Z')",
      )
      .run();
    db.sqlite
      .prepare(
        "UPDATE thoughts SET title='Depois',content='Texto novo',updated_at='2026-10-09T10:10:00Z' WHERE id='th'",
      )
      .run();
    const versions = new VersionsRepository(db.connection);
    const [version] = await versions.list('thought', 'th');
    expect(JSON.parse(version.snapshot_json)).toEqual({
      title: 'Antes',
      content: 'Texto anterior',
    });
    await versions.restore(version, true);
    expect(db.sqlite.prepare("SELECT title,content FROM thoughts WHERE id='th'").get()).toEqual({
      title: 'Antes',
      content: 'Texto anterior',
    });
    const restoredVersions = await versions.list('thought', 'th');
    expect(restoredVersions.some((row) => row.changed_fields === 'restore point')).toBe(true);
    expect(
      db.sqlite
        .prepare("SELECT count(*) count FROM activity_events WHERE summary LIKE '%Texto novo%'")
        .get(),
    ).toEqual({ count: 0 });
    db.sqlite.close();
  });

  it('keeps archived Objectives distinct from Trash', async () => {
    const db = database();
    const objectives = new ObjectivesRepository(db.connection);
    const id = await objectives.create({ ...emptyObjectiveDraft(), name: 'Objetivo arquivado' });
    await objectives.status(id, 'archived');
    expect((await objectives.get(id))?.lifecycle_status).toBe('archived');
    expect((await new TrashRepository(db.connection).list()).map((row) => row.id)).not.toContain(
      id,
    );
    db.sqlite.close();
  });

  it('moves Tasks, Projects, Objectives and Thoughts to the same Trash and restores them', async () => {
    const db = database();
    const trash = new TrashRepository(db.connection);
    insertTask(db.sqlite, 't', 'Task');
    insertProject(db.sqlite, 'p', 'Project');
    db.sqlite
      .prepare(
        "INSERT INTO objectives(id,name,start_date,created_at,updated_at) VALUES('o','Objective','2026-01-01','2026','2026')",
      )
      .run();
    db.sqlite
      .prepare(
        "INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES('th','Thought','','2026','2026')",
      )
      .run();
    for (const [type, id] of [
      ['task', 't'],
      ['project', 'p'],
      ['objective', 'o'],
      ['thought', 'th'],
    ] as const)
      await trash.trash(type, id);
    expect((await trash.list()).map((row) => row.entity_type).sort()).toEqual([
      'objective',
      'project',
      'task',
      'thought',
    ]);
    for (const [type, id] of [
      ['task', 't'],
      ['project', 'p'],
      ['objective', 'o'],
      ['thought', 'th'],
    ] as const)
      await trash.trash(type, id, false);
    expect(await trash.list()).toEqual([]);
    db.sqlite.close();
  });

  it('versions and restores Project and Objective metadata but ignores derived progress changes', async () => {
    const db = database();
    const projects = new ProjectsRepository(db.connection);
    const projectId = await projects.create({
      name: 'Antes',
      description: 'Descrição',
      start_date: null,
      target_date: null,
    });
    await projects.update(projectId, {
      name: 'Depois',
      description: 'Descrição',
      start_date: null,
      target_date: null,
    });
    const objectives = new ObjectivesRepository(db.connection);
    const objectiveId = await objectives.create({ ...emptyObjectiveDraft(), name: 'Antes' });
    await objectives.update(objectiveId, {
      ...emptyObjectiveDraft(),
      name: 'Depois',
      horizon: 'year',
      horizon_label: '2027',
    });
    const versions = new VersionsRepository(db.connection);
    const [projectVersion] = await versions.list('project', projectId);
    const [objectiveVersion] = await versions.list('objective', objectiveId);
    expect(projectVersion).toBeTruthy();
    expect(objectiveVersion).toBeTruthy();
    const before = db.sqlite
      .prepare("SELECT count(*) count FROM entity_versions WHERE entity_type='objective'")
      .get();
    insertTask(db.sqlite, 'progress-task', 'Progresso derivado');
    await objectives.link(objectiveId, 'task', 'progress-task');
    db.sqlite.prepare("UPDATE tasks SET status='completed' WHERE id='progress-task'").run();
    expect(
      db.sqlite
        .prepare("SELECT count(*) count FROM entity_versions WHERE entity_type='objective'")
        .get(),
    ).toEqual(before);
    await versions.restore(projectVersion, true);
    await versions.restore(objectiveVersion, true);
    expect(db.sqlite.prepare('SELECT name FROM projects WHERE id=?').get(projectId)).toEqual({
      name: 'Antes',
    });
    expect(db.sqlite.prepare('SELECT name FROM objectives WHERE id=?').get(objectiveId)).toEqual({
      name: 'Antes',
    });
    db.sqlite.close();
  });
});

describe('Search and Command Palette', () => {
  it('finds wishes and exposes blocked Tasks without offering destructive commands', async () => {
    const db = database();
    insertTask(db.sqlite, 'a', 'Publicar proposta');
    insertTask(db.sqlite, 'b', 'Revisar proposta');
    db.sqlite
      .prepare(
        "INSERT INTO task_dependencies(task_id,predecessor_id,created_at) VALUES('a','b','2026')",
      )
      .run();
    const objectives = new ObjectivesRepository(db.connection);
    await objectives.create({
      ...emptyObjectiveDraft(),
      name: 'Comprar câmera',
      description: 'Desejo fotografia',
      objective_kind: 'wish',
    });
    const blocked = await globalSearch(db.connection, 'Publicar');
    expect(blocked[0].detail).toContain('Bloqueada');
    expect(
      (await globalSearch(db.connection, 'câmera')).some((row) => row.detail.includes('Desejo')),
    ).toBe(true);
    const commands = commandSuggestions('');
    expect(commands.map((row) => row.kind)).toEqual(
      expect.arrayContaining(['create-objective', 'create-wish', 'open-trash']),
    );
    expect(hasDestructiveCommand('excluir objetivo')).toBe(true);
    expect(commandSuggestions('excluir objetivo')).toEqual([]);
    db.sqlite.close();
  });
});
