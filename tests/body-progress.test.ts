import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { database } from './database';
import { BodyProgressRepository } from '../src/features/body-progress/repository';
import { comparison, parseMeasurement } from '../src/features/body-progress/domain';
import { NutritionRepository } from '../src/features/nutrition/repository';

describe('progresso corporal compartilhado', () => {
  it('migra pesos da fase anterior e preserva outros módulos e o legado', async () => {
    const area = mkdtempSync(join(tmpdir(), 'rumo-body-'));
    const path = join(area, 'test.db');
    try {
      const old = database(path, 8);
      const now = '2026-09-27T12:00:00Z';
      old.sqlite
        .prepare('INSERT INTO body_weight_entries VALUES(?,?,?,?,?,?)')
        .run('old-weight', '2026-09-27', 91.4, 'Após caminhada', now, now);
      old.sqlite
        .prepare('INSERT INTO tasks(id,title,created_at,updated_at) VALUES(?,?,?,?)')
        .run('old-task', 'Preservada', now, now);
      old.sqlite.close();
      const upgraded = database(path, 9);
      const repo = new BodyProgressRepository(upgraded.connection);
      expect(await repo.weights()).toMatchObject([
        { id: 'old-weight', entry_date: '2026-09-27', weight_kg: 91.4, notes: 'Após caminhada' },
      ]);
      expect(
        upgraded.sqlite.prepare('SELECT COUNT(*) AS count FROM body_weight_entries').get(),
      ).toEqual({ count: 1 });
      expect(
        upgraded.sqlite.prepare('SELECT COUNT(*) AS count FROM body_measurement_records').get(),
      ).toEqual({ count: 1 });
      expect(upgraded.sqlite.prepare("SELECT title FROM tasks WHERE id='old-task'").get()).toEqual({
        title: 'Preservada',
      });
      expect(upgraded.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
        integrity_check: 'ok',
      });
      upgraded.sqlite.close();
      const reopened = new DatabaseSync(path);
      expect(
        reopened.prepare('SELECT COUNT(*) AS count FROM body_measurement_values').get(),
      ).toEqual({ count: 1 });
      reopened.close();
    } finally {
      rmSync(area, { recursive: true, force: true });
    }
  });

  it('mescla medidas na mesma data, preserva lados e sincroniza peso entre módulos', async () => {
    const { sqlite, connection } = database();
    const body = new BodyProgressRepository(connection);
    const nutrition = new NutritionRepository(connection);
    await nutrition.saveWeight('2026-09-27', '91,4', 'Inicial');
    await body.save('2026-09-27', {
      left_arm: '35,6',
      right_arm: '35.6',
      waist: '91',
      body_fat: '14,8',
    });
    expect((await body.records())[0].values).toMatchObject({
      weight: 91.4,
      left_arm: 35.6,
      right_arm: 35.6,
      waist: 91,
      body_fat: 14.8,
    });
    await body.save('2026-09-01', {
      weight: '93',
      left_arm: '35,2',
      right_arm: '35,5',
      waist: '94',
    });
    await body.save('2026-09-27', { right_arm: '35,9' });
    const records = await body.records();
    expect(records).toHaveLength(2);
    expect(comparison(records[1], records[0]).map((row) => [row.key, row.change])).toEqual([
      ['weight', -1.6],
      ['body_fat', null],
      ['waist', -3],
      ['left_arm', 0.4],
      ['right_arm', 0.4],
    ]);
    expect((await body.history('right_arm'))[0].value).toBe(35.9);
    expect((await nutrition.weights())[0].weight_kg).toBe(91.4);
    await body.save('2026-09-27', { weight: '90,8' });
    expect((await nutrition.weights())[0].weight_kg).toBe(90.8);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM body_weight_entries').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    sqlite.close();
  });

  it('rejeita valores inválidos antes de gravar', async () => {
    const { sqlite, connection } = database();
    const repo = new BodyProgressRepository(connection);
    expect(parseMeasurement('35,5', 'left_arm')).toBe(35.5);
    expect(parseMeasurement('35.6', 'right_arm')).toBe(35.6);
    await expect(repo.save('2026-09-27', { weight: 'NaN' })).rejects.toThrow();
    await expect(repo.save('2026-09-27', { body_fat: '101' })).rejects.toThrow();
    await expect(repo.save('2026-09-27', { left_arm: '355x' })).rejects.toThrow();
    await expect(repo.save('2026-02-30', { weight: '91,4' })).rejects.toThrow();
    expect(await repo.records()).toHaveLength(0);
    sqlite.close();
  });

  it('consolida pesos legados da mesma data sem apagar originais e preserva medidas ao remover peso', async () => {
    const area = mkdtempSync(join(tmpdir(), 'rumo-body-duplicate-'));
    const path = join(area, 'test.db');
    try {
      const old = database(path, 8);
      const insert = old.sqlite.prepare('INSERT INTO body_weight_entries VALUES(?,?,?,?,?,?)');
      insert.run(
        'first',
        '2026-09-27',
        91.4,
        'primeira',
        '2026-09-27T08:00:00Z',
        '2026-09-27T08:00:00Z',
      );
      insert.run(
        'second',
        '2026-09-27',
        91.1,
        'corrigida',
        '2026-09-27T09:00:00Z',
        '2026-09-27T09:00:00Z',
      );
      old.sqlite.close();
      const upgraded = database(path, 9);
      const repo = new BodyProgressRepository(upgraded.connection);
      expect(await repo.weights()).toMatchObject([
        { id: 'second', weight_kg: 91.1, notes: 'corrigida' },
      ]);
      expect(
        upgraded.sqlite.prepare('SELECT COUNT(*) AS count FROM body_weight_entries').get(),
      ).toEqual({ count: 2 });
      await repo.save('2026-09-27', { waist: '91,0' });
      await repo.removeWeight('second');
      expect(await repo.weights()).toHaveLength(0);
      expect((await repo.records())[0].values).toEqual({ waist: 91 });
      upgraded.sqlite.close();
      const reopened = database(path, 9);
      expect((await new BodyProgressRepository(reopened.connection).records())[0].values).toEqual({
        waist: 91,
      });
      reopened.sqlite.close();
    } finally {
      rmSync(area, { recursive: true, force: true });
    }
  });
});
