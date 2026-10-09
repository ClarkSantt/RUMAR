// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tasks } from '../src/features/tasks/Tasks';
import { InboxPage } from '../src/features/inbox/Inbox';
import type { RumoStore } from '../src/hooks/useRumo';
import type { Snapshot, Task } from '../src/types/models';

const day = '2026-10-04';
function task(id: string, dueDate: string): Task {
  return {
    id,
    title: id,
    description: '',
    priority: 'normal',
    due_date: dueDate,
    due_time: null,
    status: 'pending',
    recurrence: null,
    created_at: day,
    updated_at: day,
    completed_at: null,
    archived_at: null,
    sort_order: 0,
    source_inbox_id: null,
  };
}
function snapshot(): Snapshot {
  return {
    tasks: [task('Hoje importante', day), task('Semana que vem', '2026-10-08')],
    subtasks: [],
    completions: [],
    subtaskCompletions: [],
    inbox: [
      {
        id: 'capture-1',
        content: 'Revisar o plano',
        notes: '',
        capture_type: 'unclassified',
        status: 'pending',
        created_at: day,
        updated_at: day,
        processed_at: null,
      },
    ],
    settings: { name: 'Pessoa', theme: 'light' },
  };
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);

it('preserva abas, abertura e criação rápida de tarefas na nova apresentação', async () => {
  const user = userEvent.setup();
  const createTask = vi.fn();
  const run = vi.fn(async (operation: (repo: { createTask: typeof createTask }) => unknown) => {
    await operation({ createTask });
    return true;
  });
  const onOpen = vi.fn();
  const onCreate = vi.fn();
  render(
    <Tasks
      store={{ data: snapshot(), busy: false, run } as unknown as RumoStore}
      day={day}
      onOpen={onOpen}
      onCreate={onCreate}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Tarefas' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Hoje importante' }));
  expect(onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ task: expect.objectContaining({ id: 'Hoje importante' }) }),
  );
  await user.click(screen.getByRole('button', { name: 'Nova tarefa' }));
  expect(onCreate).toHaveBeenCalledOnce();
  await user.type(screen.getByPlaceholderText('Adicionar tarefa para hoje…'), 'Nova tarefa{Enter}');
  expect(createTask).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Nova tarefa', due_date: day }),
  );
  await user.click(screen.getByRole('button', { name: 'Próximas' }));
  expect(screen.getByText('Semana que vem')).toBeTruthy();
});

it('preserva captura e todas as conversões no menu acessível da Inbox', async () => {
  const user = userEvent.setup();
  const createInbox = vi.fn();
  const run = vi.fn(async (operation: (repo: { createInbox: typeof createInbox }) => unknown) => {
    await operation({ createInbox });
    return true;
  });
  render(<InboxPage store={{ data: snapshot(), busy: false, run } as unknown as RumoStore} />);
  await user.type(
    screen.getByPlaceholderText('Capture uma ideia, tarefa ou lembrete…'),
    'Anotar uma ideia{Enter}',
  );
  expect(createInbox).toHaveBeenCalledWith('Anotar uma ideia');
  expect(screen.getByRole('button', { name: 'Transformar em tarefa' })).toBeTruthy();
  const more = screen.getByLabelText('Mais ações para Revisar o plano');
  await user.click(more);
  expect(screen.getByRole('button', { name: 'Transformar em projeto' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Transformar em pensamento' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Excluir' })).toBeTruthy();
  await user.keyboard('{Escape}');
  expect((more.parentElement as HTMLDetailsElement).open).toBe(false);
});
