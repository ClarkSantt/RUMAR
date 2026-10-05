// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { database } from './database';
import { getDatabase } from '../src/lib/database/connection';
import { Calendar } from '../src/features/calendar/Calendar';
import { PlannerCalendar } from '../src/features/calendar/PlannerCalendar';
import { BodyProgress } from '../src/features/body-progress/BodyProgress';
import { BodyProgressRepository } from '../src/features/body-progress/repository';
import { Workouts } from '../src/features/workouts/Workouts';
import { Repository } from '../src/services/repository';
import type { RumoStore } from '../src/hooks/useRumo';

vi.mock('../src/lib/database/connection', () => ({ getDatabase: vi.fn() }));
vi.mock('../src/features/energy/EnergyPanel', () => ({ EnergyPanel: () => null }));

let db: ReturnType<typeof database>;
beforeEach(() => {
  db = database();
  vi.mocked(getDatabase).mockResolvedValue(db.connection);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  db.sqlite.close();
  vi.restoreAllMocks();
});

it('keeps the month date keyboard-selectable and opens its real item drawer', async () => {
  render(<Calendar day="2026-10-04" onOpen={vi.fn()} onNavigate={vi.fn()} />);
  const user = userEvent.setup();
  const today = await screen.findByRole('button', {
    name: /domingo, 4 de outubro: 0 itens/i,
  });
  expect(today.getAttribute('aria-current')).toBe('date');
  today.focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(today.getAttribute('aria-pressed')).toBe('true');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('preserves day/month navigation, the unscheduled panel, and block creation', async () => {
  const data = await new Repository(db.connection).snapshot();
  render(
    <PlannerCalendar
      day="2026-10-04"
      store={{ data, busy: false } as RumoStore}
      onOpen={vi.fn()}
      onCreate={vi.fn()}
      onNavigate={vi.fn()}
      onScheduleConsumed={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Mês' }));
  expect(await screen.findByLabelText('Calendário mensal')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Dia' }));
  const toggle = screen.getByRole('button', { name: 'Não agendado' });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await user.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await user.click(screen.getByRole('button', { name: 'Novo bloco' }));
  expect(await screen.findByRole('dialog', { name: 'Novo bloco' })).toBeTruthy();
});

it('keeps measurement deletion inside an accessible confirmation dialog', async () => {
  const repo = new BodyProgressRepository(db.connection);
  await repo.save('2026-10-04', { weight: '76,4', left_arm: '34', right_arm: '34,5' });
  render(<BodyProgress />);
  const user = userEvent.setup();
  expect((await screen.findAllByText('76,4 kg')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Braço esquerdo').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Braço direito').length).toBeGreaterThan(0);
  await user.click(screen.getByRole('button', { name: /Excluir medição de/i }));
  expect(screen.getByRole('dialog', { name: 'Excluir medição' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect((await repo.records()).length).toBe(1);
  await user.click(screen.getByRole('button', { name: /Excluir medição de/i }));
  await user.click(screen.getByRole('button', { name: 'Excluir medição' }));
  await waitFor(async () => expect((await repo.records()).length).toBe(0));
});

it('keeps workout navigation to body progress within the existing module', async () => {
  render(<Workouts day="2026-10-04" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Progresso corporal' }));
  expect(await screen.findByRole('region', { name: 'Progresso corporal' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Nova medição' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Hoje' }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Progresso corporal' })).toBeNull(),
  );
});
