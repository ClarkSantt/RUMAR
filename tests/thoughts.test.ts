import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './database';
import { ThoughtsRepository } from '../src/features/thoughts/repository';
import { ThoughtAutosave, flushThoughts, type SaveStatus } from '../src/features/thoughts/autosave';

describe('Thoughts on migrated SQLite', () => {
  let db: ReturnType<typeof database>, repo: ThoughtsRepository;
  beforeEach(() => {
    db = database();
    repo = new ThoughtsRepository(db.connection);
  });
  afterEach(() => db.sqlite.close());
  it('creates optional titles, saves long text, searches literal content and archives', async () => {
    const thought = await repo.create(),
      content = '# Texto\n' + 'memória _% '.repeat(2000);
    await repo.save(thought.id, { title: '', content });
    expect((await repo.get(thought.id)).content).toBe(content);
    expect(await repo.list('_%')).toHaveLength(1);
    expect(await repo.list('ausente')).toHaveLength(0);
    expect((await repo.list())[0].content.length).toBe(180);
    await repo.save(thought.id, { title: 'Anotação especial', content });
    expect(await repo.list('especial')).toHaveLength(1);
    await repo.archive(thought.id);
    expect(await repo.list()).toHaveLength(0);
    await expect(repo.save(thought.id, { title: '', content: 'lost' })).rejects.toThrow();
  });
  it.each(['task', 'project', 'inbox'] as const)(
    'converts a full thought into %s idempotently without truncating content',
    async (target) => {
      const thought = await repo.create(),
        content = 'Texto completo\n'.repeat(2000);
      await repo.save(thought.id, { title: 'Planejamento', content });
      const [first, second] = await Promise.all([
        repo.convert(thought.id, target),
        repo.convert(thought.id, target),
      ]);
      expect(second).toBe(first);
      const table = { task: 'tasks', project: 'projects', inbox: 'inbox_items' }[target];
      const rows = db.sqlite.prepare(`SELECT * FROM ${table}`).all();
      expect(rows).toHaveLength(1);
      expect(target === 'inbox' ? rows[0].content : rows[0].description).toBe(
        target === 'inbox' ? `Planejamento\n\n${content}` : content,
      );
      expect((await repo.get(thought.id)).content).toBe(content);
    },
  );
  it('keeps an oversized title in the converted description and rejects blank conversion', async () => {
    const thought = await repo.create();
    await expect(repo.convert(thought.id, 'task')).rejects.toThrow();
    const title = 'Ideia'.repeat(150);
    await repo.save(thought.id, { title, content: 'Inteiro' });
    await repo.convert(thought.id, 'task');
    expect(db.sqlite.prepare('SELECT description FROM tasks').get()?.description).toBe(
      `${title}\n\nInteiro`,
    );
  });
  it('rolls back a failed conversion without claiming success or leaving duplicate records', async () => {
    const thought = await repo.create();
    await repo.save(thought.id, { title: 'Planejar', content: 'Original' });
    db.sqlite.exec(
      "CREATE TRIGGER fail_thought_conversion AFTER INSERT ON projects BEGIN SELECT RAISE(ABORT,'disk failure'); END;",
    );
    await expect(repo.convert(thought.id, 'project')).rejects.toThrow('disk failure');
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get()?.n).toBe(0);
    expect((await repo.get(thought.id)).content).toBe('Original');
  });
});

describe('Thought autosave barrier', () => {
  afterEach(() => vi.useRealTimers());
  it('debounces edits and reports saved only after persistence resolves', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const statuses: SaveStatus[] = [],
      persist = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
    const writer = new ThoughtAutosave(persist, (status) => statuses.push(status));
    writer.edit({ title: 'a', content: 'first' });
    writer.edit({ title: 'b', content: 'last' });
    await vi.advanceTimersByTimeAsync(699);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledExactlyOnceWith({ title: 'b', content: 'last' });
    expect(statuses.at(-1)).toBe('saving');
    finish();
    await writer.flush();
    expect(statuses.at(-1)).toBe('saved');
    await writer.dispose();
  });
  it('serializes edits made during an in-flight save and flushes the newest version before navigation', async () => {
    let finish!: () => void;
    const values: string[] = [],
      persist = vi.fn(async (draft: { content: string }) => {
        values.push(draft.content);
        if (values.length === 1)
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
      });
    const writer = new ThoughtAutosave(persist);
    writer.edit({ title: '', content: 'first' });
    const navigation = flushThoughts();
    writer.edit({ title: '', content: 'second' });
    writer.edit({ title: '', content: 'latest' });
    finish();
    await navigation;
    expect(values).toEqual(['first', 'latest']);
    await writer.dispose();
  });
  it('rejects navigation on save failure, retains the draft and supports retry', async () => {
    const statuses: SaveStatus[] = [],
      persist = vi.fn().mockRejectedValueOnce(new Error('full disk')).mockResolvedValue(undefined);
    const writer = new ThoughtAutosave(persist, (status) => statuses.push(status));
    writer.edit({ title: 'not lost', content: 'draft' });
    await expect(flushThoughts()).rejects.toThrow('full disk');
    expect(statuses.at(-1)).toBe('error');
    await flushThoughts();
    expect(persist.mock.calls[1][0]).toEqual({ title: 'not lost', content: 'draft' });
    expect(statuses.at(-1)).toBe('saved');
    await writer.dispose();
  });
  it('flushes rapid navigation and persists unchanged after database close and reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rumo-thought-')),
      path = join(directory, 'rumo.db');
    let db = database(path);
    try {
      const repo = new ThoughtsRepository(db.connection),
        thought = await repo.create();
      const writer = new ThoughtAutosave((draft) => repo.save(thought.id, draft));
      const content = 'Escrita antes de sair\n'.repeat(3000);
      writer.edit({ title: 'Reabrir', content });
      await flushThoughts();
      await writer.dispose();
      db.sqlite.close();
      db = database(path);
      expect(await new ThoughtsRepository(db.connection).get(thought.id)).toMatchObject({
        title: 'Reabrir',
        content,
      });
    } finally {
      db.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
