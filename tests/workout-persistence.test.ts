import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkoutWriter, flushWorkouts } from '../src/features/workouts/persistence';
afterEach(() => vi.useRealTimers());
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe('fila de persistência do treino', () => {
  it('agrupa digitação e flush persiste imediatamente a versão final', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined),
      state = vi.fn(),
      writer = new WorkoutWriter<string>(save, state);
    try {
      writer.edit('2');
      writer.edit('27,5');
      expect(save).not.toHaveBeenCalled();
      await writer.flush();
      expect(save).toHaveBeenCalledExactlyOnceWith('27,5');
      expect(state).toHaveBeenLastCalledWith('saved');
      await vi.advanceTimersByTimeAsync(500);
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      await writer.dispose();
    }
  });
  it('erro não afirma salvo e retry mantém o rascunho', async () => {
    const save = vi.fn().mockRejectedValueOnce(Error('disco')).mockResolvedValue(undefined),
      state = vi.fn(),
      writer = new WorkoutWriter<string>(save, state);
    try {
      writer.edit('30');
      await expect(writer.flush()).rejects.toThrow('disco');
      expect(state).toHaveBeenLastCalledWith('error');
      await writer.flush();
      expect(save).toHaveBeenNthCalledWith(2, '30');
      expect(state).toHaveBeenLastCalledWith('saved');
    } finally {
      await writer.dispose();
    }
  });
  it('serializa nova edição durante gravação e flush concorrente aguarda ambas', async () => {
    const gate = deferred(),
      persisted: string[] = [];
    const save = vi.fn(async (value: string) => {
      if (value === 'primeira') await gate.promise;
      persisted.push(value);
    });
    const writer = new WorkoutWriter(save);
    try {
      writer.edit('primeira');
      const first = writer.flush();
      await Promise.resolve();
      writer.edit('final');
      const second = writer.flush();
      expect(save).toHaveBeenCalledTimes(1);
      gate.resolve();
      await Promise.all([first, second]);
      expect(persisted).toEqual(['primeira', 'final']);
      expect(save).toHaveBeenCalledTimes(2);
    } finally {
      await writer.dispose();
    }
  });
  it('erro da versão anterior preserva edição mais nova para retry', async () => {
    const gate = deferred(),
      save = vi.fn(async (value: string) => {
        if (value === 'antiga') {
          await gate.promise;
          throw Error('offline');
        }
      }),
      writer = new WorkoutWriter(save);
    try {
      writer.edit('antiga');
      const first = writer.flush();
      writer.edit('nova');
      gate.resolve();
      await expect(first).rejects.toThrow('offline');
      await writer.flush();
      expect(save).toHaveBeenLastCalledWith('nova');
      expect(save).toHaveBeenCalledTimes(2);
    } finally {
      await writer.dispose();
    }
  });
  it('flush global aguarda séries e notas antes da navegação', async () => {
    const saved: string[] = [],
      a = new WorkoutWriter<string>(async (v) => {
        saved.push(v);
      }),
      b = new WorkoutWriter<string>(async (v) => {
        saved.push(v);
      });
    try {
      a.edit('série');
      b.edit('nota');
      await flushWorkouts();
      expect(saved).toEqual(['série', 'nota']);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
  it('dispose salva pendência e remove escritor da fila global', async () => {
    const save = vi.fn().mockResolvedValue(undefined),
      writer = new WorkoutWriter<string>(save);
    writer.edit('última alteração');
    await writer.dispose();
    await flushWorkouts();
    expect(save).toHaveBeenCalledExactlyOnceWith('última alteração');
  });
});
