import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './database';

const temp = mkdtempSync(join(tmpdir(), 'rumo-release-migration-'));
afterAll(() => {
  if (existsSync(temp)) rmSync(temp, { recursive: true, force: true });
});

describe('upgrade da Fase 5 para a Fase 6', () => {
  it('preserva dados existentes e adiciona preferências de backup sem migração destrutiva', () => {
    const path = join(temp, 'old.db');
    const old = database(path, 7);
    old.sqlite.prepare("UPDATE settings SET value='Ana' WHERE key='name'").run();
    old.sqlite
      .prepare(
        "INSERT INTO tasks(id,title,created_at,updated_at) VALUES('task','Persistir','2026','2026')",
      )
      .run();
    old.sqlite
      .prepare(
        "INSERT INTO projects(id,name,created_at,updated_at) VALUES('project','Projeto','2026','2026')",
      )
      .run();
    old.sqlite
      .prepare(
        "INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES('thought','Nota','Conteúdo','2026','2026')",
      )
      .run();
    old.sqlite.close();

    const upgraded = database(path, 8);
    expect(upgraded.sqlite.prepare("SELECT value FROM settings WHERE key='name'").get()).toEqual({
      value: 'Ana',
    });
    expect(upgraded.sqlite.prepare('SELECT title FROM tasks WHERE id=?').get('task')).toEqual({
      title: 'Persistir',
    });
    expect(upgraded.sqlite.prepare('SELECT name FROM projects WHERE id=?').get('project')).toEqual({
      name: 'Projeto',
    });
    expect(
      upgraded.sqlite.prepare('SELECT content FROM thoughts WHERE id=?').get('thought'),
    ).toEqual({ content: 'Conteúdo' });
    expect(
      upgraded.sqlite
        .prepare('SELECT frequency,keep_count FROM backup_preferences WHERE id=1')
        .get(),
    ).toEqual({ frequency: 'off', keep_count: 10 });
    expect(upgraded.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
    upgraded.sqlite.close();
  });
  it('atualiza um banco da Fase 4 até o schema atual preservando registros', () => {
    const path = join(temp, 'phase4.db');
    const phase4 = database(path, 5);
    phase4.sqlite
      .prepare(
        "INSERT INTO tasks(id,title,created_at,updated_at) VALUES('old-task','Tarefa antiga','2026','2026')",
      )
      .run();
    phase4.sqlite
      .prepare(
        "INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES('old-thought','Pensamento','Texto antigo','2026','2026')",
      )
      .run();
    phase4.sqlite.close();
    const current = database(path, 8);
    expect(current.sqlite.prepare("SELECT title FROM tasks WHERE id='old-task'").get()).toEqual({
      title: 'Tarefa antiga',
    });
    expect(
      current.sqlite.prepare("SELECT content FROM thoughts WHERE id='old-thought'").get(),
    ).toEqual({ content: 'Texto antigo' });
    expect(current.sqlite.prepare('SELECT count(*) n FROM backup_preferences').get()).toEqual({
      n: 1,
    });
    expect(current.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
    current.sqlite.close();
  });
});
