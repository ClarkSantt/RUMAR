// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppSidebar } from '../src/components/AppSidebar';
import { Home } from '../src/features/home/Home';
import type { RumoStore } from '../src/hooks/useRumo';
import type { Snapshot, Task } from '../src/types/models';

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

it('mantém a navegação agrupada e o item ativo identificável', async () => {
  const onNavigate = vi.fn();
  render(
    <AppSidebar
      activePage="tasks"
      inboxCount={2}
      ready
      onNavigate={onNavigate}
      onAdd={vi.fn()}
      onSearch={vi.fn()}
    />,
  );
  const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
  expect(nav.textContent).toContain('Organização');
  expect(nav.textContent).toContain('Rotina');
  expect(nav.textContent).toContain('Registros');
  expect(screen.getByRole('button', { name: 'Tarefas' }).getAttribute('aria-current')).toBe('page');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Finanças' }));
  expect(onNavigate).toHaveBeenCalledWith('finance');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Revisões' }));
  expect(onNavigate).toHaveBeenCalledWith('review');
});

it('persiste recolhimento sem perder nomes, atalhos ou navegação por teclado', async () => {
  const user = userEvent.setup();
  const onAdd = vi.fn();
  const view = render(
    <AppSidebar
      activePage="home"
      inboxCount={0}
      ready
      onNavigate={vi.fn()}
      onAdd={onAdd}
      onSearch={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Recolher barra lateral' }));
  expect(window.localStorage.getItem('rumar.sidebar.collapsed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Início' }).getAttribute('title')).toBe('Início');
  const add = screen.getByRole('button', { name: 'Adicionar (Ctrl+Espaço)' });
  add.focus();
  await user.keyboard('{Enter}');
  expect(onAdd).toHaveBeenCalledOnce();
  view.unmount();
  render(
    <AppSidebar
      activePage="home"
      inboxCount={0}
      ready
      onNavigate={vi.fn()}
      onAdd={onAdd}
      onSearch={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Expandir barra lateral' })).toBeTruthy();
});

function task(id: string, date: string, status: Task['status']): Task {
  return {
    id,
    title: id,
    description: '',
    priority: 'normal',
    due_date: date,
    due_time: null,
    status,
    recurrence: null,
    created_at: date,
    updated_at: date,
    completed_at: status === 'completed' ? date : null,
    archived_at: null,
    sort_order: 0,
    source_inbox_id: null,
  };
}

it('prioriza tarefas do dia e preserva Inbox, pendências e revisão', async () => {
  const data: Snapshot = {
    tasks: [
      task('Hoje importante', '2026-10-04', 'pending'),
      task('Ontem', '2026-10-03', 'pending'),
    ],
    subtasks: [],
    completions: [],
    subtaskCompletions: [],
    inbox: [],
    settings: { name: 'Pessoa', theme: 'light' },
  };
  const onInbox = vi.fn();
  const onReview = vi.fn();
  render(
    <Home
      store={{ data, busy: false, run: vi.fn(async () => true) } as unknown as RumoStore}
      now={new Date(2026, 9, 4, 10)}
      onOpen={vi.fn()}
      onInbox={onInbox}
      onReview={onReview}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Hoje' })).toBeTruthy();
  expect(screen.getByText('Hoje importante')).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Para retomar/ }));
  expect(screen.getByText('Ontem')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /^Inbox 0/ }));
  expect(onInbox).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: /REVISÃO SEMANAL/ }));
  expect(onReview).toHaveBeenCalledOnce();
});

it('mostra um dia vazio sem barra de progresso fictícia', () => {
  const data: Snapshot = {
    tasks: [],
    subtasks: [],
    completions: [],
    subtaskCompletions: [],
    inbox: [],
    settings: { name: 'Pessoa', theme: 'light' },
  };
  render(
    <Home
      store={{ data, busy: false, run: vi.fn(async () => true) } as unknown as RumoStore}
      now={new Date(2026, 9, 4, 10)}
      onOpen={vi.fn()}
      onInbox={vi.fn()}
      onReview={vi.fn()}
    />,
  );
  expect(screen.getByText('Sem tarefas previstas')).toBeTruthy();
  expect(screen.getByText('Nada para hoje.')).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
});
