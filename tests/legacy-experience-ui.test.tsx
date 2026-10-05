// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { database } from './database';
import { getDatabase } from '../src/lib/database/connection';
import { ThoughtsRepository } from '../src/features/thoughts/repository';
import { Thoughts } from '../src/features/thoughts/Thoughts';
import { Timeline } from '../src/features/timeline/Timeline';
import { WeeklyReview } from '../src/features/weekly-review/WeeklyReview';
import { Settings } from '../src/features/settings/Settings';
import type { RumoStore } from '../src/hooks/useRumo';

vi.mock('../src/lib/database/connection', () => ({ getDatabase: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({ databasePath: 'fixture.db', appVersion: 'test' }),
}));
vi.mock('../src/features/energy/GeneralProfile', () => ({ GeneralProfile: () => null }));
vi.mock('../src/features/attachments/Attachments', () => ({ Attachments: () => null }));

let db: ReturnType<typeof database>;
beforeEach(() => {
  db = database();
  vi.mocked(getDatabase).mockResolvedValue(db.connection);
});
afterEach(() => {
  cleanup();
  db.sqlite.close();
  vi.restoreAllMocks();
});

it('keeps thought search, selection, writing and conversion discoverable by keyboard', async () => {
  const repo = new ThoughtsRepository(db.connection);
  const thought = await repo.create();
  await repo.save(thought.id, { title: 'Ideia de teste', content: 'Primeira ação clara' });
  render(<Thoughts initialThoughtId={thought.id} />);
  const user = userEvent.setup();
  expect(await screen.findByDisplayValue('Ideia de teste')).toBeTruthy();
  const editor = screen.getByRole('region', { name: 'Editor de pensamento' });
  expect(editor).toBeTruthy();
  await user.click(screen.getByText('Organizar e transformar'));
  expect(screen.getByRole('button', { name: 'Arquivar pensamento' })).toBeTruthy();
  await user.type(screen.getByRole('textbox', { name: 'Buscar pensamentos' }), 'ausente');
  await waitFor(() => expect(screen.queryByRole('button', { name: /Ideia de teste/ })).toBeNull());
  await user.click(screen.getByRole('button', { name: 'Novo pensamento' }));
  expect(await screen.findByPlaceholderText('Sem título')).toBeTruthy();
});

it('keeps Timeline quick filters and advanced filters accessible without losing source navigation', async () => {
  const repo = new ThoughtsRepository(db.connection);
  const thought = await repo.create();
  await repo.save(thought.id, { title: 'Registro de teste', content: 'Histórico' });
  const onNavigate = vi.fn();
  render(<Timeline onNavigate={onNavigate} />);
  const user = userEvent.setup();
  const thoughtFilter = screen.getByRole('button', { name: 'Pensamentos' });
  await user.click(thoughtFilter);
  expect(thoughtFilter.getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByText('Período e filtros avançados'));
  expect(screen.getByLabelText('Período inicial')).toBeTruthy();
  const event = await screen.findByRole(
    'button',
    { name: /Pensamentos.*Pensamento criado.*Registro de teste/ },
    { timeout: 5000 },
  );
  await user.click(event);
  expect(onNavigate).toHaveBeenCalledWith('thoughts', thought.id);
});

it('opens the review narrative before secondary metrics and retains its details', async () => {
  render(<WeeklyReview onNavigate={vi.fn()} onTimeline={vi.fn()} />);
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: 'O que aconteceu' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: /O que aprendi nesta semana/ })).toBeTruthy();
  const details = screen.getByText('Explorar registros por área').closest('details');
  expect(details?.open).toBe(false);
  await user.click(screen.getByText('Explorar registros por área'));
  expect(details?.open).toBe(true);
  const period = /\d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}/;
  const oldPeriod = screen.getByText(period).textContent;
  await user.click(screen.getByRole('button', { name: 'Semana anterior' }));
  await waitFor(() => expect(screen.getByText(period).textContent).not.toBe(oldPeriod));
});

it('switches Settings sections and exposes the current section to assistive technology', async () => {
  const store = {
    data: { settings: { name: 'Ana', theme: 'light' } },
    busy: false,
    run: vi.fn(),
  } as unknown as RumoStore;
  render(<Settings store={store} />);
  const user = userEvent.setup();
  const appearance = screen.getByRole('button', { name: 'Aparência' });
  await user.click(appearance);
  expect(appearance.getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('group', { name: 'Tema' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Escuro' }));
  expect(store.run).toHaveBeenCalledOnce();
  await user.type(screen.getByRole('searchbox', { name: 'Buscar seção' }), 'backup');
  expect(screen.getByRole('button', { name: 'Backup e dados' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Aparência' })).toBeNull();
});
