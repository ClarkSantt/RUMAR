// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDatabase } from '../src/lib/database/connection';
import { RoutinesRepository } from '../src/features/routines/repository';
import { HomeRoutines } from '../src/features/routines/Routines';
import type { SqlConnection } from '../src/lib/database/connection';
import type { RoutineCompletion } from '../src/features/routines/domain';

vi.mock('../src/lib/database/connection', () => ({ getDatabase: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('preserva a intenção de marcar e desmarcar após obter o repositório de forma assíncrona', async () => {
  const user = userEvent.setup();
  let completions: RoutineCompletion[] = [];
  // O controle React restaura seu checked atual antes de esta conexão resolver.
  vi.mocked(getDatabase).mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve({} as SqlConnection), 10)),
  );
  vi.spyOn(RoutinesRepository.prototype, 'list').mockResolvedValue([
    {
      id: 'routine',
      name: 'Rotina da noite',
      description: '',
      frequency: 'daily',
      weekdays: [],
      time_of_day: null,
      active: 1,
      archived_at: null,
      sort_order: 0,
      created_at: '',
      updated_at: '',
    },
  ]);
  vi.spyOn(RoutinesRepository.prototype, 'items').mockResolvedValue([
    {
      id: 'item',
      routine_id: 'routine',
      title: 'Ler',
      sort_order: 0,
      created_at: '',
      updated_at: '',
    },
  ]);
  vi.spyOn(RoutinesRepository.prototype, 'occurrences').mockResolvedValue([
    {
      id: 'occurrence',
      routine_id: 'routine',
      occurrence_date: '2026-09-26',
      started_at: '',
      completed_at: null,
    },
  ]);
  vi.spyOn(RoutinesRepository.prototype, 'completions').mockImplementation(async () => completions);
  const toggle = vi
    .spyOn(RoutinesRepository.prototype, 'toggle')
    .mockImplementation(async (occurrenceId, itemId, checked) => {
      completions = checked
        ? [{ occurrence_id: occurrenceId, item_id: itemId, completed_at: 'now' }]
        : [];
    });
  render(<HomeRoutines day="2026-09-26" />);
  const checkbox = await screen.findByRole('checkbox', { name: 'Ler' });
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  await user.click(checkbox);
  await waitFor(() => expect(toggle).toHaveBeenNthCalledWith(1, 'occurrence', 'item', true));
  await waitFor(() => expect((checkbox as HTMLInputElement).checked).toBe(true));
  await user.click(checkbox);
  await waitFor(() => expect(toggle).toHaveBeenNthCalledWith(2, 'occurrence', 'item', false));
  await waitFor(() => expect((checkbox as HTMLInputElement).checked).toBe(false));
});
