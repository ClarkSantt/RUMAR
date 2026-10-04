// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseForm } from '../src/features/workouts/components/ExerciseForm';
import { DayForm, PlanForm } from '../src/features/workouts/components/PlanForms';
import { DayExerciseForm } from '../src/features/workouts/components/DayExerciseForm';
import type { Exercise } from '../src/features/workouts/types';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);
describe('Formulários de planejamento de treinos', () => {
  it('mantém exercício digitado após falha e fecha apenas quando persistido', async () => {
    const user = userEvent.setup(),
      save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      close = vi.fn();
    render(<ExerciseForm busy={false} error="" onSave={save} onClose={close} />);
    await user.type(screen.getByLabelText('Nome'), 'Supino personalizado');
    await user.selectOptions(screen.getByLabelText('Tipo de carga'), 'per_side');
    await user.type(screen.getByLabelText(/Observações/), 'Banco ajustado');
    await user.click(screen.getByRole('button', { name: 'Salvar exercício' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Supino personalizado',
        load_type: 'per_side',
        notes: 'Banco ajustado',
      }),
    );
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Supino personalizado');
    await user.click(screen.getByRole('button', { name: 'Salvar exercício' }));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('persiste domingo como zero, distinguindo de sem dia fixo', async () => {
    const user = userEvent.setup(),
      save = vi.fn().mockResolvedValue(false);
    render(<DayForm busy={false} error="" onSave={save} onClose={() => {}} />);
    await user.type(screen.getByLabelText('Nome do dia'), 'Upper');
    await user.click(screen.getByRole('checkbox', { name: 'Domingo' }));
    await user.click(screen.getByRole('button', { name: 'Salvar dia' }));
    expect(save).toHaveBeenLastCalledWith({
      name: 'Upper',
      weekday: null,
      weekdays: [0],
      notes: '',
    });
    await user.click(screen.getByRole('checkbox', { name: 'Domingo' }));
    await user.click(screen.getByRole('button', { name: 'Salvar dia' }));
    expect(save).toHaveBeenLastCalledWith({
      name: 'Upper',
      weekday: null,
      weekdays: [],
      notes: '',
    });
  });
  it('permite vincular e remover hábito booleano do plano explicitamente', async () => {
    const user = userEvent.setup(),
      save = vi.fn().mockResolvedValue(false);
    render(
      <PlanForm
        habits={[{ id: 'habit', name: 'Treinar' }]}
        busy={false}
        error=""
        onSave={save}
        onClose={() => {}}
      />,
    );
    await user.type(screen.getByLabelText('Nome do plano'), 'PPL + Upper/Lower');
    await user.selectOptions(screen.getByLabelText(/Hábito vinculado/), 'habit');
    await user.click(screen.getByRole('button', { name: 'Salvar plano' }));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ habit_id: 'habit' }));
    await user.selectOptions(screen.getByLabelText(/Hábito vinculado/), '');
    await user.click(screen.getByRole('button', { name: 'Salvar plano' }));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ habit_id: null }));
  });
  it('busca exercício, salva faixa planejada e bloqueia máxima menor que mínima', async () => {
    const user = userEvent.setup(),
      save = vi.fn().mockResolvedValue(false),
      exercises: Exercise[] = [
        {
          id: 'bench',
          name: 'Supino reto',
          muscle_group: 'Peito',
          equipment: 'Barra',
          load_type: 'per_side',
          notes: '',
          is_custom: 0,
          created_at: '',
          updated_at: '',
          archived_at: null,
          aliases_json: '[]',
          secondary_muscles_json: '[]',
          movement_pattern: '',
        },
      ];
    render(
      <DayExerciseForm
        exercises={exercises}
        busy={false}
        error=""
        onSave={save}
        onClose={() => {}}
      />,
    );
    await user.type(screen.getByLabelText('Buscar na biblioteca'), 'supino');
    await user.selectOptions(screen.getByLabelText('Exercício'), 'bench');
    await user.clear(screen.getByLabelText('Reps mínimas'));
    await user.type(screen.getByLabelText('Reps mínimas'), '12');
    await user.click(screen.getByRole('button', { name: 'Salvar exercício no dia' }));
    expect(save).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Reps máximas'));
    await user.type(screen.getByLabelText('Reps máximas'), '15');
    await user.type(screen.getByLabelText(/Descanso em segundos/), '120');
    await user.click(screen.getByRole('button', { name: 'Salvar exercício no dia' }));
    expect(save).toHaveBeenCalledWith({
      exercise_id: 'bench',
      target_sets: 3,
      min_reps: 12,
      max_reps: 15,
      rest_seconds: 120,
      notes: '',
    });
  });
});
