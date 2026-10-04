import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './database';
import { RoutinesRepository } from '../src/features/routines/repository';
import {
  routineEligible,
  validateRoutine,
  type RoutineInput,
} from '../src/features/routines/domain';
const input: RoutineInput = {
  name: 'Rotina da noite',
  description: '',
  frequency: 'daily',
  weekdays: [],
  time_of_day: '21:00',
  active: 1,
};
describe('rotinas', () => {
  it('consulta ocorrências apenas da rotina e intervalo solicitados', async () => {
    const d = database(),
      r = new RoutinesRepository(d.connection);
    try {
      const first = await r.save(input),
        second = await r.save({ ...input, name: 'Outra' });
      await r.start(first, '2026-09-21');
      await r.start(first, '2026-09-22');
      await r.start(second, '2026-09-21');
      const rows = await r.occurrences('2026-09-21', '2026-09-21', first);
      expect(rows).toHaveLength(1);
      expect(rows[0].routine_id).toBe(first);
      expect(await r.occurrences('2026-09-21', '2026-09-21')).toHaveLength(2);
    } finally {
      d.sqlite.close();
    }
  });
  it('progresso parcial e sequência sobrevivem fechamento e reabertura', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rumo-routines-')),
      path = join(directory, 'test.db');
    let d = database(path);
    try {
      const r = new RoutinesRepository(d.connection),
        id = await r.save(input),
        a = await r.addItem(id, 'Banho'),
        b = await r.addItem(id, 'Ler'),
        o = await r.start(id, '2026-09-21');
      await r.moveItem(b, -1);
      await r.toggle(o.id, a, true);
      d.sqlite.close();
      d = database(path);
      const reopened = new RoutinesRepository(d.connection);
      expect((await reopened.items(id)).map((i) => i.id)).toEqual([b, a]);
      expect((await reopened.completions(o.id))[0].item_id).toBe(a);
      expect((await reopened.occurrences('2026-09-21', '2026-09-21'))[0].completed_at).toBeNull();
    } finally {
      d.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('valida frequência, horário e elegibilidade', () => {
    expect(routineEligible(input, '2026-09-21')).toBe(true);
    expect(routineEligible({ ...input, frequency: 'weekdays', weekdays: [1] }, '2026-09-22')).toBe(
      false,
    );
    expect(routineEligible({ ...input, active: 0 }, '2026-09-21')).toBe(false);
    expect(() => validateRoutine({ ...input, time_of_day: '25:00' })).toThrow();
    expect(() => validateRoutine({ ...input, frequency: 'weekdays' })).toThrow();
  });
  it('edita e ordena itens em uma única atualização', async () => {
    const d = database(),
      r = new RoutinesRepository(d.connection);
    try {
      const id = await r.save(input),
        a = await r.addItem(id, 'Banho'),
        b = await r.addItem(id, 'Ler');
      await r.moveItem(b, -1);
      expect((await r.items(id)).map((i) => i.id)).toEqual([b, a]);
      await r.updateItem(a, 'Escovar dentes');
      expect((await r.items(id))[1].title).toBe('Escovar dentes');
      await r.removeItem(b);
      expect(await r.items(id)).toHaveLength(1);
      await r.save({ ...input, active: 0 }, id);
      expect((await r.list())[0].active).toBe(0);
      await r.archive(id);
      expect(await r.list()).toEqual([]);
    } finally {
      d.sqlite.close();
    }
  });
  it('preserva progresso parcial e exige todos os itens para concluir', async () => {
    const d = database(),
      r = new RoutinesRepository(d.connection);
    try {
      const id = await r.save(input),
        a = await r.addItem(id, 'Banho'),
        b = await r.addItem(id, 'Ler'),
        o = await r.start(id, '2026-09-21');
      expect((await r.start(id, '2026-09-21')).id).toBe(o.id);
      await r.toggle(o.id, a, true);
      await expect(r.complete(o.id)).rejects.toThrow();
      expect(await new RoutinesRepository(d.connection).completions(o.id)).toHaveLength(1);
      await r.toggle(o.id, b, true);
      await r.complete(o.id);
      expect((await r.occurrences('2026-09-21', '2026-09-21'))[0].completed_at).toBeTruthy();
      await expect(r.toggle(o.id, a, false)).rejects.toThrow();
      await r.reopen(o.id);
      await r.toggle(o.id, a, false);
      expect(await r.completions(o.id)).toHaveLength(1);
      expect((await r.list())[0].active).toBe(1);
    } finally {
      d.sqlite.close();
    }
  });
  it('novo dia inicia vazio sem modificar dia anterior', async () => {
    const d = database(),
      r = new RoutinesRepository(d.connection);
    try {
      const id = await r.save(input),
        a = await r.addItem(id, 'Ler'),
        old = await r.start(id, '2026-09-21');
      await r.toggle(old.id, a, true);
      await r.complete(old.id);
      const next = await r.start(id, '2026-09-22');
      expect(next.id).not.toBe(old.id);
      expect(next.completed_at).toBeNull();
      expect(await r.completions(next.id)).toEqual([]);
      expect(await r.completions(old.id)).toHaveLength(1);
    } finally {
      d.sqlite.close();
    }
  });
  it('proíbe cruzar itens entre rotinas, rotina vazia e futuro', async () => {
    const d = database(),
      r = new RoutinesRepository(d.connection);
    try {
      const a = await r.save(input),
        b = await r.save({ ...input, name: 'Outra' }),
        item = await r.addItem(b, 'Item'),
        o = await r.start(a, '2026-09-21');
      await expect(r.toggle(o.id, item, true)).rejects.toThrow();
      await expect(r.complete(o.id)).rejects.toThrow();
      await expect(r.start(a, '2099-01-01')).rejects.toThrow();
    } finally {
      d.sqlite.close();
    }
  });
});
