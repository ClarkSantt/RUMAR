// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { database } from './database';
import { FinanceRepository } from '../src/features/finance/repository';
import { FakeFinancialConnectionProvider } from '../src/features/finance/connections/provider';

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock('../src/lib/database/connection', () => ({ getDatabase: mocks.getDatabase }));
import { FinancialConnections } from '../src/features/finance/connections/FinancialConnections';

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
    expect(await screen.findByText(/Conta Corrente · BRL/)).toBeTruthy();
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
    await user.click(screen.getByRole('button', { name: 'Importar' }));
    expect(await screen.findByText(/1 importadas/)).toBeTruthy();
  } finally {
    db.sqlite.close();
  }
});
