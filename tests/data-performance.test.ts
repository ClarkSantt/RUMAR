import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { database } from './database';
import { exportCsv } from '../src/features/data/export';
import { portableJson } from '../src/features/data/json-export';

describe('portabilidade em perfil sintético isolado', () => {
  it('exporta 5 mil transações em CSV e JSON', async () => {
    const { sqlite, connection } = database();
    const stamp = '2026-10-01T12:00:00Z';
    sqlite.exec('CREATE TABLE _sqlx_migrations(version INTEGER, success INTEGER)');
    sqlite.exec('INSERT INTO _sqlx_migrations VALUES(24,1)');
    sqlite
      .prepare('INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('perf-account', 'Conta de teste', 'checking', stamp, stamp);
    const insert = sqlite.prepare(`INSERT INTO finance_transactions
      (id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    sqlite.exec('BEGIN');
    for (let index = 0; index < 5000; index++)
      insert.run(
        `perf-${index}`,
        'perf-account',
        '2026-10-01',
        100 + index,
        'expense',
        `Compra ${index}`,
        `COMPRA ${index}`,
        stamp,
        stamp,
      );
    sqlite.exec('COMMIT');
    const start = performance.now();
    const csv = await exportCsv(connection, 'finance', '2026-10-01', '2026-10-01');
    const csvMs = performance.now() - start;
    const jsonStart = performance.now();
    const data = await portableJson(connection);
    const jsonMs = performance.now() - jsonStart;
    expect(csv.split('\r\n')).toHaveLength(5002);
    expect(data.data.finance.finance_transactions).toHaveLength(5000);
    expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    console.info(
      `v160 synthetic: 5,000 transactions; Finance CSV ${csvMs.toFixed(1)} ms; portable JSON ${jsonMs.toFixed(1)} ms`,
    );
    sqlite.close();
  });
});
