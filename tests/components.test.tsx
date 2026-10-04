// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickEntry } from '../src/components/QuickEntry';
import { TaskList } from '../src/features/tasks/TaskList';
import type { RumoStore } from '../src/hooks/useRumo';
import type { TaskOccurrence } from '../src/types/models';
afterEach(cleanup);
describe('keyboard and persistence feedback', () => {
  it('saves quick entry on Enter and clears only after success', async () => {
    const user = userEvent.setup(),
      save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<QuickEntry placeholder="Adicionar tarefa" onSave={save} busy={false} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'Comprar shampoo{Enter}');
    expect(save).toHaveBeenCalledWith('Comprar shampoo');
    expect((input as HTMLInputElement).value).toBe('Comprar shampoo');
    await user.keyboard('{Enter}');
    expect((input as HTMLInputElement).value).toBe('');
  });
  it('supports multiline capture without submitting Shift+Enter', async () => {
    const user = userEvent.setup(),
      save = vi.fn().mockResolvedValue(true);
    render(<QuickEntry placeholder="Capturar" onSave={save} busy={false} multiline />);
    await user.type(screen.getByRole('textbox'), 'Primeira{Shift>}{Enter}{/Shift}Segunda');
    expect(save).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(save).toHaveBeenCalledWith('Primeira\nSegunda');
  });
  it('rolls back optimistic checkbox on persistence failure', async () => {
    const user = userEvent.setup();
    let resolve: (result: boolean) => void = () => {};
    const pending = new Promise<boolean>((r) => {
      resolve = r;
    });
    const row: TaskOccurrence = {
      date: null,
      completed: false,
      task: {
        id: '1',
        title: 'Tarefa',
        description: '',
        priority: 'normal',
        due_date: null,
        due_time: null,
        recurrence: null,
        status: 'pending',
        created_at: '',
        updated_at: '',
        completed_at: null,
        archived_at: null,
        sort_order: 0,
        source_inbox_id: null,
      },
    };
    const store = {
      busy: false,
      run: vi.fn(() => pending),
      data: { subtasks: [], subtaskCompletions: [] },
    } as unknown as RumoStore;
    render(<TaskList rows={[row]} store={store} onOpen={() => {}} />);
    await user.click(screen.getByRole('checkbox'));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    resolve(false);
    await vi.waitFor(() =>
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false),
    );
  });
});
