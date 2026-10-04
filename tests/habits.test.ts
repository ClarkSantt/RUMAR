import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './database';
import { HabitsRepository } from '../src/features/habits/repository';
import {
  habitEligible,
  habitProgress,
  validateHabit,
  type HabitInput,
  type Habit,
} from '../src/features/habits/domain';
const input: HabitInput = {
  name: 'Praticar guitarra',
  description: '',
  frequency: 'weekdays',
  weekdays: [1, 3, 5],
  weekly_target: 3,
  kind: 'quantity',
  target_value: 30,
  unit: 'minutos',
  start_date: '2026-01-01',
  end_date: null,
  project_id: null,
  active: 1,
};
const habit: Habit = {
  ...input,
  id: 'h',
  archived_at: null,
  sort_order: 0,
  created_at: '',
  updated_at: '',
};
describe('hábitos: elegibilidade e métricas', () => {
  it('consistência considera somente dias elegíveis dentro dos últimos 30 dias', () => {
    const h = { ...habit, start_date: '2026-09-21', end_date: '2026-09-23' };
    const entries = ['2026-08-21', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-25'].map(
      (entry_date) => ({ habit_id: 'h', entry_date, value: 30, updated_at: '' }),
    );
    expect(habitProgress(h, entries, '2026-09-25')).toMatchObject({
      expected: 2,
      done: 2,
      consistency: 100,
      weekDone: 2,
      weekTarget: 2,
    });
    expect(habitProgress(h, entries, '2026-10-25')).toMatchObject({
      expected: 0,
      done: 0,
      consistency: 0,
    });
  });
  it('respeita dias, início, fim, pausa e arquivo', () => {
    expect(habitEligible(habit, '2026-09-21')).toBe(true);
    expect(habitEligible(habit, '2026-09-22')).toBe(false);
    expect(habitEligible({ ...habit, start_date: '2026-10-01' }, '2026-09-21')).toBe(false);
    expect(habitEligible({ ...habit, end_date: '2026-09-20' }, '2026-09-21')).toBe(false);
    expect(habitEligible({ ...habit, active: 0 }, '2026-09-21')).toBe(false);
    expect(habitEligible({ ...habit, archived_at: 'x' }, '2026-09-21')).toBe(false);
  });
  it('diário e meta semanal ficam disponíveis em todos os dias do período', () => {
    for (const frequency of ['daily', 'weekly_target'] as const)
      expect(habitEligible({ ...habit, frequency }, '2026-09-22')).toBe(true);
  });
  it('meta quantitativa exige quantidade e computa semana e consistência', () => {
    const entries = [
      { habit_id: 'h', entry_date: '2026-09-21', value: 30, updated_at: '' },
      { habit_id: 'h', entry_date: '2026-09-23', value: 10, updated_at: '' },
    ];
    const p = habitProgress(habit, entries, '2026-09-25');
    expect(p.weekDone).toBe(1);
    expect(p.weekTarget).toBe(3);
    expect(p.done).toBe(1);
    expect(p.consistency).toBe(Math.round(100 / p.expected));
  });
  it('meta semanal limita consistência por semana e não recompensa excesso', () => {
    const h = {
      ...habit,
      frequency: 'weekly_target' as const,
      kind: 'boolean' as const,
      start_date: '2026-09-21',
    };
    const entries = [21, 22, 23, 24, 25].map((d) => ({
      habit_id: 'h',
      entry_date: `2026-09-${d}`,
      value: 1,
      updated_at: '',
    }));
    expect(habitProgress(h, entries, '2026-09-25')).toMatchObject({
      weekDone: 5,
      weekTarget: 3,
      consistency: 100,
    });
  });
  it('valida dias, metas, datas, unidade e nome', () => {
    expect(() => validateHabit({ ...input, weekdays: [] })).toThrow();
    expect(() => validateHabit({ ...input, weekly_target: 8 })).toThrow();
    expect(() => validateHabit({ ...input, target_value: 0 })).toThrow();
    expect(() => validateHabit({ ...input, unit: '' })).toThrow();
    expect(() => validateHabit({ ...input, end_date: '2025-01-01' })).toThrow();
    expect(() => validateHabit({ ...input, name: ' ' })).toThrow();
  });
});
describe('hábitos: persistência', () => {
  it('consulta de histórico limita o intervalo e o hábito solicitado', async () => {
    const d = database(),
      r = new HabitsRepository(d.connection);
    try {
      const first = await r.save({ ...input, frequency: 'daily' }),
        second = await r.save({ ...input, frequency: 'daily', name: 'Outro' });
      for (const id of [first, second])
        for (const day of ['2026-08-01', '2026-09-01', '2026-09-02', '2026-09-03'])
          await r.record(id, day, 30);
      const bounded = await r.entries('2026-09-01', '2026-09-02', first);
      expect(bounded.map((e) => e.entry_date)).toEqual(['2026-09-01', '2026-09-02']);
      expect(bounded.every((e) => e.habit_id === first)).toBe(true);
      expect(await r.entries('2026-09-01', '2026-09-02')).toHaveLength(4);
    } finally {
      d.sqlite.close();
    }
  });
  it('vínculo e histórico sobrevivem reabertura do banco em disco', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rumo-habits-')),
      path = join(directory, 'test.db');
    let d = database(path);
    try {
      d.sqlite
        .prepare(
          "INSERT INTO projects(id,name,created_at,updated_at) VALUES('project','Guitarra','now','now')",
        )
        .run();
      const r = new HabitsRepository(d.connection),
        id = await r.save({ ...input, project_id: 'project' });
      await r.record(id, '2026-09-21', 30);
      d.sqlite.close();
      d = database(path);
      const reopened = new HabitsRepository(d.connection);
      expect((await reopened.list('project'))[0].id).toBe(id);
      expect((await reopened.entries('2026-09-21', '2026-09-21', id))[0].value).toBe(30);
      d.sqlite.prepare("DELETE FROM projects WHERE id='project'").run();
      expect((await reopened.list())[0].project_id).toBeNull();
    } finally {
      d.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('cria, edita, registra histórico sem duplicar e arquiva', async () => {
    const d = database(),
      r = new HabitsRepository(d.connection);
    try {
      const id = await r.save(input);
      await r.record(id, '2026-09-21', 10);
      await r.record(id, '2026-09-21', 30);
      expect(await r.entries('2026-09-01', '2026-09-30', id)).toHaveLength(1);
      expect((await r.entries('2026-09-21', '2026-09-21'))[0].value).toBe(30);
      await r.save({ ...input, name: 'Guitarra', active: 0 }, id);
      expect((await r.list())[0]).toMatchObject({ name: 'Guitarra', active: 0 });
      await r.record(id, '2026-09-23', 40);
      await r.archive(id);
      expect(await r.list()).toEqual([]);
      expect(await r.entries('2026-09-01', '2026-09-30')).toHaveLength(2);
    } finally {
      d.sqlite.close();
    }
  });
  it('rejeita histórico em dia não elegível, futuro e quantidade inválida', async () => {
    const d = database(),
      r = new HabitsRepository(d.connection);
    try {
      const id = await r.save(input);
      await expect(r.record(id, '2026-09-22', 30)).rejects.toThrow();
      await expect(r.record(id, '2099-01-01', 30)).rejects.toThrow();
      await expect(r.record(id, '2026-09-21', -1)).rejects.toThrow();
      await expect(r.save({ ...input, project_id: 'missing' })).rejects.toThrow();
    } finally {
      d.sqlite.close();
    }
  });
  it('registro booleano aceita desfazer sem criar tarefa', async () => {
    const d = database(),
      r = new HabitsRepository(d.connection);
    try {
      const id = await r.save({ ...input, kind: 'boolean', frequency: 'daily' });
      await r.record(id, '2026-09-21', 1);
      await r.record(id, '2026-09-21', 0);
      await expect(r.record(id, '2026-09-21', 2)).rejects.toThrow();
      expect((await r.entries('2026-09-21', '2026-09-21'))[0].value).toBe(0);
      expect(d.sqlite.prepare('SELECT count(*) AS n FROM tasks').get()?.n).toBe(0);
    } finally {
      d.sqlite.close();
    }
  });
});
