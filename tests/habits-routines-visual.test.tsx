// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDatabase, type SqlConnection } from '../src/lib/database/connection';
import { HabitCard } from '../src/features/habits/HabitCard';
import { Habits } from '../src/features/habits/Habits';
import { HabitsRepository } from '../src/features/habits/repository';
import { RoutineSequenceCard } from '../src/features/routines/RoutineSequenceCard';
import { Routines } from '../src/features/routines/Routines';
import { RoutinesRepository } from '../src/features/routines/repository';
import type { Habit, HabitEntry } from '../src/features/habits/domain';
import type {
  Routine,
  RoutineCompletion,
  RoutineItem,
  RoutineOccurrence,
} from '../src/features/routines/domain';

vi.mock('../src/lib/database/connection', () => ({ getDatabase: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const day = '2026-10-04';
const habit: Habit = {
  id: 'h1',
  name: 'Ler',
  description: 'Vinte minutos por dia.',
  frequency: 'daily',
  weekdays: [],
  weekly_target: 7,
  kind: 'boolean',
  target_value: 1,
  unit: '',
  start_date: '2026-09-01',
  end_date: null,
  project_id: null,
  active: 1,
  archived_at: null,
  sort_order: 0,
  created_at: day,
  updated_at: day,
};
const entries: HabitEntry[] = [
  { habit_id: 'h1', entry_date: '2026-10-03', value: 1, updated_at: day },
];
const routine: Routine = {
  id: 'r1',
  name: 'Rotina da noite',
  description: 'Preparar o dia seguinte.',
  frequency: 'daily',
  weekdays: [],
  time_of_day: '21:00',
  active: 1,
  archived_at: null,
  sort_order: 0,
  created_at: day,
  updated_at: day,
};
const items: RoutineItem[] = ['Ler', 'Planejar amanhã'].map((title, index) => ({
  id: `i${index}`,
  routine_id: 'r1',
  title,
  sort_order: index,
  created_at: day,
  updated_at: day,
}));
const occurrence: RoutineOccurrence = {
  id: 'o1',
  routine_id: 'r1',
  occurrence_date: day,
  started_at: day,
  completed_at: null,
};
const completions: RoutineCompletion[] = [
  { occurrence_id: 'o1', item_id: 'i0', completed_at: day },
];
const noop = () => {};

it('mantém check-in booleano nativo operável por teclado e progresso textual', async () => {
  const onRecord = vi.fn();
  render(
    <HabitCard
      habit={habit}
      entries={entries}
      day={day}
      busy={false}
      onRecord={onRecord}
      onEdit={noop}
    />,
  );
  expect(screen.getByText('1 de 7 dias')).toBeTruthy();
  const checkbox = screen.getByRole('checkbox', { name: 'Concluir hoje' });
  checkbox.focus();
  await userEvent.setup().keyboard(' ');
  expect(onRecord).toHaveBeenCalledWith(1);
  expect(screen.getByLabelText('Progresso semanal de Ler')).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Semana de Ler' }).children).toHaveLength(7);
});

it('registra quantidade existente sem presumir incremento fixo', async () => {
  const user = userEvent.setup();
  const onRecord = vi.fn();
  render(
    <HabitCard
      habit={{ ...habit, kind: 'quantity', target_value: 2.5, unit: 'L' }}
      entries={[{ habit_id: 'h1', entry_date: day, value: 1.7, updated_at: day }]}
      day={day}
      busy={false}
      onRecord={onRecord}
      onEdit={noop}
    />,
  );
  expect(screen.getByText('1.7 / 2.5 L')).toBeTruthy();
  const input = screen.getByRole('spinbutton', { name: 'Registrar quantidade em L' });
  await user.clear(input);
  await user.type(input, '2.1');
  await user.click(screen.getByRole('button', { name: 'Registrar' }));
  expect(onRecord).toHaveBeenCalledWith(2.1);
});

it('menu do hábito aceita Enter e Escape com retorno de foco', async () => {
  const user = userEvent.setup();
  render(
    <HabitCard habit={habit} entries={[]} day={day} busy={false} onRecord={noop} onEdit={noop} />,
  );
  const summary = screen.getByLabelText('Mais ações de Ler');
  summary.focus();
  await user.keyboard('{Enter}');
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(true);
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Editar e ver histórico' }),
  );
  await user.keyboard('{Escape}');
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(false);
  expect(document.activeElement).toBe(summary);
});

it('rotina distingue início, sequência, conclusão e reabertura', async () => {
  const user = userEvent.setup();
  const onStart = vi.fn(),
    onToggleStep = vi.fn(),
    onComplete = vi.fn(),
    onReopen = vi.fn();
  const props = {
    routine,
    items,
    eligible: true,
    busy: false,
    onExpand: noop,
    onEdit: noop,
    onStart,
    onComplete,
    onReopen,
    onToggleStep,
  };
  const { rerender } = render(<RoutineSequenceCard {...props} completions={[]} expanded={false} />);
  expect(screen.getByText('0 de 2 concluídas')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Iniciar rotina' }));
  expect(onStart).toHaveBeenCalledOnce();
  rerender(
    <RoutineSequenceCard {...props} occurrence={occurrence} completions={completions} expanded />,
  );
  expect(screen.getByText('1 de 2 concluídas')).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: 'Planejar amanhã' }));
  expect(onToggleStep).toHaveBeenCalledWith('i1', true);
  expect(screen.getByRole('button', { name: 'Concluir rotina' }).hasAttribute('disabled')).toBe(
    true,
  );
  rerender(
    <RoutineSequenceCard
      {...props}
      occurrence={occurrence}
      completions={[...completions, { occurrence_id: 'o1', item_id: 'i1', completed_at: day }]}
      expanded
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Concluir rotina' }));
  expect(onComplete).toHaveBeenCalledOnce();
  rerender(
    <RoutineSequenceCard
      {...props}
      occurrence={{ ...occurrence, completed_at: day }}
      completions={completions}
      expanded
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Reabrir ocorrência' }));
  expect(onReopen).toHaveBeenCalledOnce();
});

it('expansão da rotina e menu secundário mantêm semântica de teclado', async () => {
  const user = userEvent.setup();
  const onExpand = vi.fn();
  render(
    <RoutineSequenceCard
      routine={routine}
      items={items}
      completions={[]}
      eligible
      expanded={false}
      busy={false}
      onExpand={onExpand}
      onEdit={noop}
      onStart={noop}
      onComplete={noop}
      onReopen={noop}
      onToggleStep={noop}
    />,
  );
  const toggle = screen.getByRole('button', { name: 'Expandir Rotina da noite' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(onExpand).toHaveBeenCalledOnce();
  const summary = screen.getByLabelText('Mais ações de Rotina da noite');
  summary.focus();
  await user.keyboard(' ');
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(true);
  await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(summary);
});

it('estados vazios respeitam as coleções reais', async () => {
  vi.mocked(getDatabase).mockResolvedValue({} as SqlConnection);
  vi.spyOn(HabitsRepository.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(HabitsRepository.prototype, 'entries').mockResolvedValue([]);
  vi.spyOn(RoutinesRepository.prototype, 'list').mockResolvedValue([]);
  render(
    <>
      <Habits />
      <Routines />
    </>,
  );
  await waitFor(() => expect(screen.getByText('Nenhum hábito ainda.')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('Nenhuma rotina ainda.')).toBeTruthy());
});
