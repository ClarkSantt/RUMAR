import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './database';

describe('upgrade 1.5 → 1.6', () => {
  it('preserva todas as colunas e linhas do schema 19 e aplica 20–24 em sequência', () => {
    const area = mkdtempSync(join(tmpdir(), 'rumo-data-upgrade-'));
    let upgraded: ReturnType<typeof database> | undefined;
    try {
      const path = join(area, 'upgrade.db');
      const old = database(path, 19);
      const stamp = '2026-10-01T12:00:00Z';
      old.sqlite
        .prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)')
        .run('project-upgrade', 'Projeto', stamp, stamp);
      old.sqlite
        .prepare('INSERT INTO tasks(id,title,project_id,created_at,updated_at) VALUES(?,?,?,?,?)')
        .run('task-upgrade', 'Tarefa', 'project-upgrade', stamp, stamp);
      old.sqlite
        .prepare('INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES(?,?,?,?,?)')
        .run('thought-upgrade', 'Pensamento', 'Conteúdo preservado', stamp, stamp);
      old.sqlite
        .prepare('INSERT INTO workout_plans(id,name,created_at,updated_at) VALUES(?,?,?,?)')
        .run('plan-upgrade', 'Plano', stamp, stamp);
      old.sqlite
        .prepare(
          'INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)',
        )
        .run('account-upgrade', 'Conta', 'checking', stamp, stamp);
      old.sqlite
        .prepare(
          'INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          'tx-upgrade',
          'account-upgrade',
          '2026-10-01',
          8340,
          'expense',
          'Mercado',
          'mercado',
          stamp,
          stamp,
        );
      old.sqlite
        .prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)')
        .run('upgrade-marker', 'preserved', stamp);

      const tables = old.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'test_migrations'",
        )
        .all() as { name: string }[];
      const snapshot = new Map(
        tables.map(({ name }) => {
          const columns = (
            old.sqlite.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]
          ).map((column) => column.name);
          const selection = columns.map((column) => `"${column}"`).join(',');
          return [
            name,
            {
              columns,
              rows: old.sqlite.prepare(`SELECT ${selection} FROM "${name}" ORDER BY rowid`).all(),
            },
          ];
        }),
      );
      old.sqlite.close();

      upgraded = database(path, 24);
      for (const [name, previous] of snapshot) {
        const selection = previous.columns.map((column) => `"${column}"`).join(',');
        const after = upgraded.sqlite
          .prepare(`SELECT ${selection} FROM "${name}" ORDER BY rowid`)
          .all();
        const preserved = new Set(after.map((row) => JSON.stringify(row)));
        for (const row of previous.rows)
          expect(preserved.has(JSON.stringify(row)), name).toBe(true);
      }
      expect(upgraded.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
        integrity_check: 'ok',
      });
      expect(upgraded.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(
        upgraded.sqlite
          .prepare('SELECT version FROM test_migrations ORDER BY version DESC LIMIT 1')
          .get(),
      ).toEqual({ version: 24 });
    } finally {
      upgraded?.sqlite.close();
      rmSync(area, { recursive: true, force: true });
    }
  });
});
