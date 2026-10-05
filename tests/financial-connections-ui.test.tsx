// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { database } from './database';
import { FinanceRepository } from '../src/features/finance/repository';
import { FakeFinancialConnectionProvider } from '../src/features/finance/connections/provider';

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock('../src/lib/database/connection', () => ({ getDatabase: mocks.getDatabase }));
import {
  FinancialConnections,
  FinancialPreviewRows,
} from '../src/features/finance/connections/FinancialConnections';
import type { FinancialPreviewRow } from '../src/features/finance/connections/repository';

HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

afterEach(() => {
  cleanup();
  mocks.getDatabase.mockReset();
});

it('exige vínculo explícito antes de importar no fluxo de simulação', async () => {
  const db = database();
  try {
    mocks.getDatabase.mockResolvedValue(db.connection);
    const provider = new FakeFinancialConnectionProvider();
    provider.accounts.push({
      id: 'checking',
      name: 'Conta Corrente',
      type: 'checking',
      currency: 'BRL',
      lastFour: '4821',
      balanceCents: 5000,
    });
    provider.transactions.push({
      id: 'one',
      accountId: 'checking',
      date: new Date().toISOString().slice(0, 10),
      postedAt: null,
      description: 'Compra de teste',
      amountCents: 1200,
      type: 'expense',
      status: 'posted',
    });
    const user = userEvent.setup();
    render(<FinancialConnections provider={provider} />);
    await user.click(await screen.findByRole('button', { name: 'Conectar instituição de teste' }));
    expect(await screen.findByText('Conta Corrente')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Prévia' }));
    expect(await screen.findByText(/1 registros · 0 novos/)).toBeTruthy();
    const localId = await new FinanceRepository(db.connection).saveAccount({
      name: 'Minha conta',
      type: 'checking',
      opening_balance_cents: 0,
    });
    // Newly created local accounts are offered after the panel is reopened.
    cleanup();
    render(<FinancialConnections provider={provider} />);
    const institution = await screen.findByLabelText('Instituição');
    await user.selectOptions(
      institution,
      (await db.connection.select<{ id: string }[]>('SELECT id FROM financial_connections'))[0].id,
    );
    await waitFor(() => expect(screen.getByLabelText('Conta RUMAR')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Conta RUMAR'), localId);
    await waitFor(() =>
      expect(screen.getByLabelText('Conta RUMAR')).toHaveProperty('value', localId),
    );
    await user.click(screen.getByRole('button', { name: 'Prévia' }));
    expect(await screen.findByText(/1 registros · 1 novos/)).toBeTruthy();
    expect(screen.getByText('Compra de teste')).toBeTruthy();
    const reviewButton = screen.getByRole('button', { name: 'Revisar importação' });
    await user.click(reviewButton);
    const dialog = screen.getByRole('dialog', { name: 'Confirmar importação' });
    expect(dialog).toBeTruthy();
    expect(
      (
        await db.connection.select<{ total: number }[]>(
          'SELECT count(*) AS total FROM finance_transactions',
        )
      )[0].total,
    ).toBe(0);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Confirmar importação' })).toBeNull(),
    );
    expect(document.activeElement).toBe(reviewButton);
    await user.click(reviewButton);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Confirmar importação' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Revisar importação' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar e importar' }));
    expect(await screen.findByText(/1 importadas/)).toBeTruthy();
  } finally {
    db.sqlite.close();
  }
});

it('mascara o valor das linhas individuais da prévia sem ocultar data e estado', () => {
  const account = {
    id: 'demo',
    localId: 'local-demo',
    linkedFinanceAccountId: 'local-finance',
    name: 'Conta fictícia',
    type: 'checking' as const,
    currency: 'BRL',
    lastFour: '0000',
    balanceCents: null,
  };
  const rows: FinancialPreviewRow[] = [
    {
      account,
      transaction: {
        id: 'demo-transaction',
        accountId: account.id,
        date: '2026-10-04',
        postedAt: null,
        description: 'Compra fictícia',
        amountCents: 12345,
        type: 'expense',
        status: 'posted',
      },
      status: 'new',
      localTransactionId: null,
    },
  ];
  const view = render(
    <FinancialPreviewRows
      rows={rows}
      localAccounts={[{ id: 'local-finance', name: 'Conta local' }]}
      hidden
    />,
  );
  expect(screen.getByText('Compra fictícia')).toBeTruthy();
  expect(screen.getByText(/2026-10-04.*Nova/)).toBeTruthy();
  expect(screen.getByText('R$ •••••')).toBeTruthy();
  expect(view.container.textContent).not.toContain('123,45');
});
