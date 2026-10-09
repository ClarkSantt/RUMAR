// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppSidebar } from '../src/components/AppSidebar';
import { EmptyState } from '../src/components/EmptyState';
import { Home } from '../src/features/home/Home';
import { HomeRepository, type HomeDayData } from '../src/features/home/repository';
import { getDatabase } from '../src/lib/database/connection';
import type { RumoStore } from '../src/hooks/useRumo';
import type { Snapshot } from '../src/types/models';

vi.mock('../src/lib/database/connection', () => ({ getDatabase: vi.fn() }));

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getDatabase).mockResolvedValue({} as Awaited<ReturnType<typeof getDatabase>>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

function homeDay(overrides: Partial<HomeDayData> = {}): HomeDayData {
  return {
    planning: { now: null, next: [], total: 0, completed: 0, pending: 0, skipped: 0 },
    overdue: { count: 0, rows: [] },
    habits: [],
    workout: null,
    nutrition: { calories: 0, protein: 0, calorieGoal: 2200 },
    finance: { hidden: false, expense: 0 },
    projects: [],
    ...overrides,
  };
}

const homeStore = {
  tasks: [],
  subtasks: [],
  completions: [],
  subtaskCompletions: [],
  inbox: [],
  settings: { name: 'Pessoa', theme: 'light' },
} satisfies Snapshot;

it('prioriza Agora e preserva Inbox, pendências e revisão', async () => {
  vi.spyOn(HomeRepository.prototype, 'day').mockResolvedValue(
    homeDay({
      planning: {
        now: {
          id: 'now',
          block_date: '2026-10-04',
          start_time: '09:30',
          end_time: '10:30',
          schedule_kind: 'fixed',
          day_period: null,
          status: 'planned',
          source_type: 'project',
          source_id: 'project',
          title: 'TESTE RUMAR - Projeto',
        },
        next: [],
        total: 3,
        completed: 1,
        pending: 2,
        skipped: 0,
      },
      overdue: {
        count: 1,
        rows: [{ id: 'late', title: 'TESTE RUMAR - atrasada', due_date: '2026-10-03' }],
      },
    }),
  );
  const data: Snapshot = {
    ...homeStore,
  };
  const onInbox = vi.fn();
  const onReview = vi.fn();
  const onTasks = vi.fn();
  render(
    <Home
      store={{ data, busy: false, run: vi.fn(async () => true) } as unknown as RumoStore}
      now={new Date(2026, 9, 4, 10)}
      onOpen={vi.fn()}
      onInbox={onInbox}
      onReview={onReview}
      onTasks={onTasks}
    />,
  );
  expect(await screen.findByRole('heading', { name: 'TESTE RUMAR - Projeto' })).toBeTruthy();
  expect(screen.getByText(/planejados concluídos/).textContent).toContain('1 de 3');
  expect(screen.getByText('TESTE RUMAR - atrasada')).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /TESTE RUMAR - atrasada/ }));
  expect(onTasks).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: /Uma ideia para depois/ }));
  expect(onInbox).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: /Revisar a semana/ }));
  expect(onReview).toHaveBeenCalledOnce();
});

it('mostra um dia livre sem barra de progresso fictícia', async () => {
  vi.spyOn(HomeRepository.prototype, 'day').mockResolvedValue(homeDay());
  render(
    <Home
      store={{ data: homeStore, busy: false, run: vi.fn(async () => true) } as unknown as RumoStore}
      now={new Date(2026, 9, 4, 10)}
      onOpen={vi.fn()}
      onInbox={vi.fn()}
      onReview={vi.fn()}
    />,
  );
  expect(await screen.findByText('Seu tempo está livre agora.')).toBeTruthy();
  expect(screen.getByText('Nada mais planejado por enquanto.')).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
});

it('resume Agora, Depois e os indicadores compactos do dia', async () => {
  vi.spyOn(HomeRepository.prototype, 'day').mockResolvedValue(
    homeDay({
      planning: {
        now: {
          id: 'current',
          block_date: '2026-10-04',
          start_time: '10:00',
          end_time: '11:00',
          schedule_kind: 'fixed',
          day_period: null,
          status: 'planned',
          source_type: 'task',
          source_id: 'task',
          title: 'Preparar apresentação',
        },
        next: [
          {
            id: 'next',
            block_date: '2026-10-04',
            start_time: '13:00',
            end_time: '13:30',
            schedule_kind: 'fixed',
            day_period: null,
            status: 'planned',
            source_type: 'habit',
            source_id: 'habit',
            title: 'TESTE RUMAR - Leitura',
          },
        ],
        total: 2,
        completed: 0,
        pending: 2,
        skipped: 0,
      },
      habits: [
        {
          id: 'habit',
          name: 'Água',
          value: 3,
          target: 5,
          unit: 'L',
          tracking_type: 'quantity',
          reached: 0,
        },
      ],
      workout: { id: 'workout', name: 'Push', finished_at: '2026-10-04T09:00:00' },
    }),
  );
  render(
    <Home
      store={{ data: homeStore, busy: false, run: vi.fn(async () => true) } as unknown as RumoStore}
      now={new Date(2026, 9, 4, 10)}
      onOpen={vi.fn()}
      onInbox={vi.fn()}
      onReview={vi.fn()}
    />,
  );
  expect(await screen.findByText('Preparar apresentação')).toBeTruthy();
  expect(screen.getByText('TESTE RUMAR - Leitura')).toBeTruthy();
  expect(screen.getByText('3/5 L')).toBeTruthy();
  expect(screen.getByText('Push concluído')).toBeTruthy();
});
