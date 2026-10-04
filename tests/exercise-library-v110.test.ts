import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './database';
import { ExercisesRepository } from '../src/features/workouts/repositories/catalog';

describe('expanded local exercise library', () => {
  it('contains useful groups without duplicate built-in names and searches aliases with filters', async () => {
    const db = database();
    try {
      const repo = new ExercisesRepository(db.connection);
      const builtins = (await repo.list()).filter((item) => !item.is_custom);
      expect(builtins).toHaveLength(236);
      expect(new Set(builtins.map((item) => item.name.toLocaleLowerCase('pt-BR'))).size).toBe(236);
      expect([...new Set(builtins.map((item) => item.muscle_group))]).toEqual(
        expect.arrayContaining([
          'Peito',
          'Costas',
          'Antebraços',
          'Abdômen/Core',
          'Corpo inteiro',
          'Cardio',
        ]),
      );
      expect(
        (await repo.list('chest press', 'Peito', 'Máquina')).map((item) => item.name),
      ).toContain('Supino horizontal na máquina');
      expect(
        (await repo.list('pulley corda', 'Tríceps', 'Cabo')).map((item) => item.name),
      ).toContain('Tríceps corda na polia');
      expect(await repo.list('pulley corda', 'Peito', 'Cabo')).toEqual([]);
      const custom = await repo.save({
        name: 'Exercício próprio',
        muscle_group: 'Peito',
        equipment: 'Elástico',
        load_type: 'total',
        notes: '',
        aliases: 'nome alternativo, apelido',
        secondary_muscles: 'Tríceps, Ombros',
        movement_pattern: 'Empurrar',
      });
      expect((await repo.list('apelido'))[0]).toMatchObject({
        id: custom,
        is_custom: 1,
        movement_pattern: 'Empurrar',
      });
      expect(JSON.parse((await repo.list('apelido'))[0].secondary_muscles_json)).toEqual([
        'Tríceps',
        'Ombros',
      ]);
    } finally {
      db.sqlite.close();
    }
  });

  it('upgrades schema 11 to 12 once, preserving custom exercises', async () => {
    const area = mkdtempSync(join(tmpdir(), 'rumo-exercises-'));
    const path = join(area, 'upgrade.db');
    try {
      let db = database(path, 11);
      db.sqlite.exec(
        "INSERT INTO exercises(id,name,muscle_group,equipment,load_type,is_custom,created_at,updated_at) VALUES('custom-before','Meu exercício','Costas','Elástico','total',1,'now','now')",
      );
      db.sqlite.close();
      db = database(path, 12);
      expect(
        db.sqlite
          .prepare("SELECT name,is_custom,aliases_json FROM exercises WHERE id='custom-before'")
          .get(),
      ).toMatchObject({ name: 'Meu exercício', is_custom: 1, aliases_json: '[]' });
      expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM exercises').get()?.n).toBe(237);
      expect(db.sqlite.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      db.sqlite.close();
      db = database(path, 12);
      expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM exercises').get()?.n).toBe(237);
      db.sqlite.close();
    } finally {
      rmSync(area, { recursive: true, force: true });
    }
  });
});
