// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlobalSearch } from '../src/features/search/GlobalSearch';
import { getDatabase } from '../src/lib/database/connection';
import { globalSearch } from '../src/features/search/repository';

vi.mock('../src/lib/database/connection', () => ({ getDatabase: vi.fn() }));
vi.mock('../src/features/search/repository', () => ({ globalSearch: vi.fn() }));

beforeEach(() => {
  vi.mocked(getDatabase).mockResolvedValue({} as Awaited<ReturnType<typeof getDatabase>>);
  vi.mocked(globalSearch).mockResolvedValue([]);
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

it('operates the Command Palette with Arrow keys, Enter, Escape, focus and aria-activedescendant', async () => {
  const user = userEvent.setup();
  const before = document.createElement('button');
  document.body.append(before);
  before.focus();
  const onCommand = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <GlobalSearch onClose={onClose} onNavigate={vi.fn()} onCommand={onCommand} />,
  );
  const input = screen.getByRole('combobox', { name: 'Buscar no RUMAR' });
  expect(document.activeElement).toBe(input);
  const initial = screen.getAllByRole('option');
  expect(input.getAttribute('aria-activedescendant')).toBe(initial[0].id);
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ kind: 'navigate' }));

  await user.clear(input);
  await user.type(input, 'nova tarefa estudar SQL amanhã 14h');
  expect(await screen.findByText(/Criar Task: estudar SQL/i)).not.toBeNull();
  await user.keyboard('{Enter}');
  expect(onCommand).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: 'create-task', payload: 'estudar SQL amanhã 14h' }),
  );

  fireEvent(view.container.querySelector('dialog')!, new Event('cancel', { cancelable: true }));
  expect(onClose).toHaveBeenCalled();
  view.unmount();
  expect(document.activeElement).toBe(before);
  before.remove();
});
