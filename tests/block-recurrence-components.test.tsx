// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { database } from './database';
import { getDatabase } from '../src/lib/database/connection';
import { Repository } from '../src/services/repository';
import { BlockSeriesRepository } from '../src/features/calendar/block-series-repository';
import { defaultBlock } from '../src/features/calendar/planner-repository';
import { defaultBlockRecurrence } from '../src/features/calendar/block-recurrence';
import { PlannerCalendar } from '../src/features/calendar/PlannerCalendar';
import type { RumoStore } from '../src/hooks/useRumo';
vi.mock('../src/lib/database/connection', () => ({ getDatabase: vi.fn() }));
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
async function setup() {
  const id = await new BlockSeriesRepository(db.connection).save(
    { ...defaultBlock('2026-09-28', '19:00', 60), title: 'Estudar' },
    { ...defaultBlockRecurrence(), weekdays: [1, 3, 5] },
  );
  render(
    <PlannerCalendar
      day="2026-09-28"
      store={{ data: await new Repository(db.connection).snapshot(), busy: false } as RumoStore}
      onOpen={vi.fn()}
      onCreate={vi.fn()}
      onNavigate={vi.fn()}
      onScheduleConsumed={vi.fn()}
    />,
  );
  return id;
}
it('asks scope before changing a recurring occurrence and leaves the other dates untouched', async () => {
  const id = await setup(),
    user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Estudar, 19:00–20:00' }));
  await user.click(screen.getByRole('button', { name: 'Editar horário' }));
  expect(screen.getByRole('heading', { name: 'Editar bloco recorrente' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Somente este bloco' }));
  const start = screen.getByLabelText('Início');
  await user.clear(start);
  await user.type(start, '20:00');
  const end = screen.getByLabelText('Fim');
  await user.clear(end);
  await user.type(end, '21:00');
  await user.click(screen.getByRole('button', { name: 'Salvar bloco' }));
  await waitFor(() =>
    expect(
      db.sqlite.prepare('SELECT start_time FROM planner_time_block_exceptions').get(),
    ).toMatchObject({ start_time: '20:00' }),
  );
  expect((await new BlockSeriesRepository(db.connection).get(id))?.start_time).toBe('19:00');
});
it('asks scope before deletion and one occurrence cancellation does not delete the rule', async () => {
  const id = await setup(),
    user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Estudar, 19:00–20:00' }));
  await user.click(screen.getByRole('button', { name: 'Remover do calendário' }));
  await user.click(screen.getByRole('button', { name: 'Somente este bloco' }));
  await waitFor(() =>
    expect(
      db.sqlite.prepare('SELECT cancelled FROM planner_time_block_exceptions').get(),
    ).toMatchObject({ cancelled: 1 }),
  );
  expect(await new BlockSeriesRepository(db.connection).get(id)).toBeTruthy();
  expect(
    (await new BlockSeriesRepository(db.connection).range('2026-09-28', '2026-10-04')).map(
      (b) => b.block_date,
    ),
  ).toEqual(['2026-09-30', '2026-10-02']);
});
