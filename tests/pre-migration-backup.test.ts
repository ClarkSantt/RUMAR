import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('pre-migration backup ordering', () => {
  it('invokes the validated native backup before SQLx opens and migrates the database', () => {
    const connection = readFileSync('src/lib/database/connection.ts', 'utf8');
    const invoke = connection.indexOf("await invoke('pre_migration_backup')");
    const load = connection.indexOf("Database.load('sqlite:rumo.db')");
    expect(invoke).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(invoke);
  });

  it('registers migration 29 and the native command', () => {
    const rust = readFileSync('src-tauri/src/lib.rs', 'utf8');
    expect(rust).toContain('backup::pre_migration_backup');
    expect(rust).toContain('version: 29');
    expect(rust).toContain('0029_planning_foundation.sql');
  });
});
