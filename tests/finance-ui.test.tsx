// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SqlConnection } from '../src/lib/database/connection';
import { getDatabase } from '../src/lib/database/connection';
import { Finance } from '../src/features/finance/Finance';
import { HomeFinance } from '../src/features/finance/HomeFinance';

vi.mock('../src/lib/database/connection', () => ({ getDatabase: vi.fn() }));
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of [
    '0001_foundation.sql',
    '0002_organization.sql',
    '0003_workouts.sql',
    '0004_nutrition.sql',
    '0005_nutrition_units.sql',
    '0006_finance.sql',
    '0007_finance_integrity.sql',
  ])
    sqlite.exec(readFileSync(resolve('src-tauri/migrations', name), 'utf8'));
  const bind = (values: unknown[]) =>
    Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v as string | number | null]));
  const connection: SqlConnection = {
    async select<T>(sql: string, values = []) {
      return sqlite.prepare(sql).all(bind(values)) as T;
    },
    async execute(sql, values = []) {
      return { rowsAffected: Number(sqlite.prepare(sql).run(bind(values)).changes) };
    },
  };
  return { sqlite, connection };
}
let db: ReturnType<typeof database>;
beforeEach(() => {
  db = database();
  vi.mocked(getDatabase).mockResolvedValue(db.connection);
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  db.sqlite.close();
});

it('cria conta e movimentação pela UI, atualiza resumo e oculta valores', async () => {
  const user = userEvent.setup();
  render(<Finance day="2026-09-27" />);
  expect(await screen.findByRole('heading', { name: 'Finanças' })).toBeTruthy();
  await user.type(screen.getByLabelText('Nome'), 'Conta principal');
  await user.click(screen.getByRole('button', { name: 'Salvar conta' }));
  expect(await screen.findByText('Conta principal')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Transações' }));
  await user.selectOptions(screen.getAllByLabelText('Tipo', { selector: 'select' })[1], 'income');
  await user.type(screen.getByLabelText('Descrição'), 'Salário');
  await user.type(screen.getByLabelText('Valor em R$'), '5.000,00');
  await user.click(screen.getByRole('button', { name: 'Salvar transação' }));
  expect(await screen.findByText('Salário')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Visão geral' }));
  expect((await screen.findAllByText(/R\$\s*5\.000,00/)).length).toBeGreaterThan(1);
  await user.click(screen.getByRole('button', { name: 'Ocultar valores' }));
  expect((await screen.findAllByText('R$ •••••')).length).toBeGreaterThan(1);
  await act(async () => {
    expect(db.sqlite.prepare('SELECT hide_values FROM finance_preferences').get()).toEqual({
      hide_values: 1,
    });
  });
});

it('Home consulta resumo compacto somente quando há dados', async () => {
  const { sqlite } = db;
  const view = render(<HomeFinance day="2026-09-27" onNavigate={() => {}} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByText('Disponível este mês')).toBeNull();
  sqlite.exec(
    "INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES('a','Conta','checking','2026-09-27','2026-09-27');",
  );
  sqlite.exec(
    "INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at) VALUES('t','a','2026-09-27',10000,'income','Salário','SALARIO','2026-09-27','2026-09-27');",
  );
  view.unmount();
  render(<HomeFinance day="2026-09-27" onNavigate={() => {}} />);
  expect(await screen.findByText('Disponível este mês')).toBeTruthy();
  expect(screen.getByText(/R\$\s*100,00/)).toBeTruthy();
});
