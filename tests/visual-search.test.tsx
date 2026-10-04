// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDatabase } from '../src/lib/database/connection';
import { GlobalSearch } from '../src/features/search/GlobalSearch';
import { globalSearch } from '../src/features/search/repository';

vi.mock('../src/lib/database/connection', () => ({ getDatabase: vi.fn() }));
vi.mock('../src/features/search/repository', () => ({ globalSearch: vi.fn() }));

beforeEach(() => {
  vi.mocked(getDatabase).mockResolvedValue({} as Awaited<ReturnType<typeof getDatabase>>);
  vi.mocked(globalSearch).mockImplementation(async (_db, query) =>
    query.length >= 2
      ? [
          {
            id: 'project',
            title: 'Projeto pessoal',
            detail: '',
            group: 'Projetos',
            page: 'projects',
          },
          { id: 'task', title: 'Projeto: revisar', detail: '', group: 'Tarefas', page: 'tasks' },
        ]
      : [],
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('liga a opção ativa ao campo e preserva setas, Enter, cancelamento e foco', async () => {
  const user = userEvent.setup();
  const previous = document.createElement('button');
  previous.textContent = 'Anterior';
  document.body.append(previous);
  previous.focus();
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  const view = render(<GlobalSearch onClose={onClose} onNavigate={onNavigate} />);
  const input = screen.getByRole('combobox', { name: 'Buscar no RUMAR' });
  expect(document.activeElement).toBe(input);
  await user.type(input, 'pro');
  const options = await screen.findAllByRole('option');
  expect(input.getAttribute('aria-controls')).toBe('rumar-search-results');
  expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
  await user.keyboard('{ArrowDown}');
  expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);
  await user.keyboard('{Enter}');
  expect(onNavigate).toHaveBeenCalledWith('tasks', expect.objectContaining({ id: 'task' }));
  const close = screen.getByRole('button', { name: 'Fechar busca' });
  close.focus();
  await user.keyboard('{Enter}');
  expect(onClose).toHaveBeenCalledOnce();
  expect(onNavigate).toHaveBeenCalledOnce();
  onClose.mockClear();
  fireEvent(view.container.querySelector('dialog')!, new Event('cancel', { cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.activeElement).toBe(previous);
  previous.remove();
});
