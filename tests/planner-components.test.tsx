// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { database } from './database';
import { getDatabase } from '../src/lib/database/connection';
import { Repository } from '../src/services/repository';
import { FocusRepository } from '../src/features/calendar/planner-repository';
import { FocusHost } from '../src/features/calendar/focus';
import { PlannerCalendar } from '../src/features/calendar/PlannerCalendar';
import type { RumoStore } from '../src/hooks/useRumo';
import type { Snapshot } from '../src/types/models';
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
  db?.sqlite.close();
  vi.restoreAllMocks();
});
function StoreHost({ initial }: { initial: Snapshot }) {
  const [data, setData] = useState(initial);
  const store = {
    data,
    busy: false,
    setNotice: vi.fn(),
    run: async (action: (r: Repository) => Promise<unknown>) => {
      const repo = new Repository(db.connection);
      await action(repo);
      setData(await repo.snapshot());
      return true;
    },
  } as unknown as RumoStore;
  return <FocusHost store={store} />;
}
it('uses the persisted occurrence for both subtasks and task completion after recovery', async () => {
  const repo = new Repository(db.connection);
  const id = await repo.createTask({
    title: 'Diária',
    description: '',
    priority: 'normal',
    due_date: '2026-09-01',
    due_time: null,
    recurrence: { frequency: 'daily' },
  });
  await repo.addSubtask(id, 'Preparar');
  const session = await new FocusRepository(db.connection).start(
    'Diária',
    id,
    null,
    '2026-09-28T10:00:00Z',
    '2026-09-27',
  );
  render(<StoreHost initial={await repo.snapshot()} />);
  const user = userEvent.setup();
  const check = await screen.findByRole('checkbox', { name: 'Concluir subtarefa Preparar' });
  await waitFor(() => expect((check as HTMLInputElement).disabled).toBe(false));
  await user.click(check);
  await waitFor(() =>
    expect(
      db.sqlite.prepare('SELECT occurrence_date FROM subtask_completions').get(),
    ).toMatchObject({ occurrence_date: '2026-09-27' }),
  );
  await user.click(screen.getByRole('button', { name: 'Concluir tarefa' }));
  await waitFor(() =>
    expect(db.sqlite.prepare('SELECT occurrence_date FROM task_completions').get()).toMatchObject({
      occurrence_date: '2026-09-27',
    }),
  );
  expect(
    db.sqlite.prepare('SELECT status FROM focus_sessions WHERE id=?').get(session.id),
  ).toMatchObject({ status: 'completed' });
});
it('keeps Focus visible when saving a pause fails and permits a retry', async () => {
  await new FocusRepository(db.connection).start('Leitura');
  render(<StoreHost initial={await new Repository(db.connection).snapshot()} />);
  await screen.findByRole('heading', { name: 'Retomar sessão de foco' });
  vi.spyOn(FocusRepository.prototype, 'pause').mockRejectedValueOnce(Error('Falha simulada'));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Fechar' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Falha simulada');
  expect(screen.getByRole('dialog')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Fechar' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('consumes a task scheduling request once without reopening it on later navigation', async () => {
  const repo = new Repository(db.connection);
  const id = await repo.createTask({
    title: 'Planejar',
    description: '',
    priority: 'normal',
    due_date: null,
    due_time: null,
    recurrence: null,
  });
  const data = await repo.snapshot();
  function Host() {
    const [request, setRequest] = useState<{
      id: string;
      date: string | null;
      request: number;
    } | null>({ id, date: '2026-09-28', request: 1 });
    const [shown, setShown] = useState(true);
    return (
      <>
        <button onClick={() => setShown(!shown)}>Alternar página</button>
        {shown && (
          <PlannerCalendar
            key={1}
            day="2026-09-28"
            scheduleTask={request}
            onScheduleConsumed={() => setRequest(null)}
            store={{ data, busy: false } as RumoStore}
            onOpen={vi.fn()}
            onCreate={vi.fn()}
            onNavigate={vi.fn()}
          />
        )}
      </>
    );
  }
  render(<Host />);
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Novo bloco' });
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  await user.click(screen.getByRole('button', { name: 'Alternar página' }));
  await user.click(screen.getByRole('button', { name: 'Alternar página' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
