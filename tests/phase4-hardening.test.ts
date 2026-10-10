import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { database } from './database';

describe('Phase 4 migration and hardening contracts', () => {
  it('creates schema 32 with healthy foreign keys and the 7/4/6 retention defaults', () => {
    const current = database(':memory:', 32);
    expect(
      current.sqlite.prepare('SELECT max(version) version FROM test_migrations').get(),
    ).toEqual({
      version: 32,
    });
    expect(
      current.sqlite
        .prepare(
          `SELECT daily_keep,weekly_keep,monthly_keep,automatic_directory,last_error
           FROM backup_preferences WHERE id=1`,
        )
        .get(),
    ).toEqual({
      daily_keep: 7,
      weekly_keep: 4,
      monthly_keep: 6,
      automatic_directory: '',
      last_error: '',
    });
    expect(current.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
    expect(current.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    current.sqlite.close();
  });

  it('upgrades schema 31, preserves attachment metadata and enables Task attachments', () => {
    const legacy = database(':memory:', 31);
    legacy.sqlite
      .prepare(
        "INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Projeto','2026','2026')",
      )
      .run();
    legacy.sqlite
      .prepare(
        `INSERT INTO attachments(id,entity_type,entity_id,original_name,stored_name,relative_path,mime_type,file_size,sha256,created_at,updated_at)
         VALUES('11111111-1111-4111-8111-111111111111','project','p','a.pdf','file.pdf','attachments/11111111-1111-4111-8111-111111111111/file.pdf','application/pdf',1,?,'2026','2026')`,
      )
      .run('a'.repeat(64));
    legacy.sqlite
      .prepare(
        "INSERT INTO tasks(id,title,created_at,updated_at) VALUES('t','Tarefa','2026','2026')",
      )
      .run();
    legacy.sqlite.exec(readFileSync('src-tauri/migrations/0032_advanced_hardening.sql', 'utf8'));
    expect(legacy.sqlite.prepare('SELECT count(*) n FROM attachments').get()).toEqual({ n: 1 });
    legacy.sqlite
      .prepare(
        `INSERT INTO attachments(id,entity_type,entity_id,original_name,stored_name,relative_path,mime_type,file_size,sha256,created_at,updated_at)
         VALUES('22222222-2222-4222-8222-222222222222','task','t','b.pdf','file.pdf','attachments/22222222-2222-4222-8222-222222222222/file.pdf','application/pdf',1,?,'2026','2026')`,
      )
      .run('b'.repeat(64));
    expect(legacy.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    legacy.sqlite.close();
  });

  it('pins migrations 1-31 byte-for-byte and registers 32 separately', () => {
    const published = readFileSync('tests/migration-checksums.test.ts', 'utf8');
    for (let version = 1; version <= 31; version++)
      expect(published).toContain(`'${String(version).padStart(4, '0')}_`);
    const bytes = readFileSync('src-tauri/migrations/0032_advanced_hardening.sql');
    expect(createHash('sha384').update(bytes).digest('hex')).toHaveLength(96);
  });

  it('keeps backup retention manifest-based and restore fail-closed', () => {
    const source = readFileSync('src-tauri/src/backup.rs', 'utf8');
    expect(source).toContain('manifest.created_at.parse::<i64>()');
    expect(source).toContain('daily_keep');
    expect(source).toContain('weekly_keep');
    expect(source).toContain('monthly_keep');
    expect(source).toContain('create_archive(current, &preventive');
    expect(source).toContain('check_attachment_list(&manifest.attachments');
    expect(source).not.toContain('auto_backup_timestamp');
  });
});
