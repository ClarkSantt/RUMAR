// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppSidebar } from '../src/components/AppSidebar';
import { EmptyState } from '../src/components/EmptyState';
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

it('indica seções fora da área visível e permite avançar pela navegação', async () => {
  render(
    <AppSidebar
      activePage="home"
      inboxCount={0}
      ready
      onNavigate={vi.fn()}
      onAdd={vi.fn()}
      onSearch={vi.fn()}
    />,
  );
  const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
  Object.defineProperty(nav, 'clientHeight', { configurable: true, value: 240 });
  Object.defineProperty(nav, 'scrollHeight', { configurable: true, value: 780 });
  nav.scrollBy = vi.fn();
  act(() => window.dispatchEvent(new Event('resize')));
  const cue = screen.getByRole('button', { name: 'Ver mais seções abaixo na navegação' });
  await userEvent.setup().click(cue);
  expect(nav.scrollBy).toHaveBeenCalledWith(0, 180);
  Object.defineProperty(nav, 'scrollTop', { configurable: true, value: 540 });
  fireEvent.scroll(nav);
  expect(screen.queryByRole('button', { name: 'Ver mais seções da navegação' })).toBeNull();
});

it('oferece ação principal e secundária no estado vazio contextual', async () => {
  const primary = vi.fn();
  const secondary = vi.fn();
  render(
    <EmptyState
      title="Nenhuma tarefa para hoje"
      description="Você pode planejar a próxima tarefa."
      action={{ label: 'Adicionar tarefa', onClick: primary }}
      secondaryAction={{ label: 'Ver tarefas', onClick: secondary }}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Adicionar tarefa' }));
  await user.click(screen.getByRole('button', { name: 'Ver tarefas' }));
  expect(primary).toHaveBeenCalledOnce();
  expect(secondary).toHaveBeenCalledOnce();
});

it('mantém ilustração de estado vazio decorativa e conteúdo textual acessível', () => {
  const view = render(
    <EmptyState
      title="Nenhum projeto ainda"
      description="Crie seu primeiro projeto."
      illustration="/assets/rumar/empty-states/empty-projects.png"
    />,
  );
  const illustration = view.container.querySelector('img');
  expect(illustration?.getAttribute('alt')).toBe('');
  expect(illustration?.getAttribute('aria-hidden')).toBe('true');
  expect(screen.getByRole('heading', { name: 'Nenhum projeto ainda' })).toBeTruthy();
  expect(screen.getByText('Crie seu primeiro projeto.')).toBeTruthy();
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

it('resume o dia antes da lista e mantém a continuidade visível', () => {
  const data: Snapshot = {
    tasks: [task('Preparar apresentação', '2026-10-04', 'pending')],
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
      quickSummary={<section>Treino real de hoje</section>}
      continuation={<section>Próximo compromisso</section>}
    />,
  );
  expect(screen.getByRole('region', { name: 'Resumo do dia' })).toBeTruthy();
  expect(screen.getByText('0 de 1 concluídas')).toBeTruthy();
  expect(screen.getByText('Treino real de hoje')).toBeTruthy();
  expect(screen.getByText('Preparar apresentação')).toBeTruthy();
  expect(screen.getByText('Próximo compromisso')).toBeTruthy();
});
