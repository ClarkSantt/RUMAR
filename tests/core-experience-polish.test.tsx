// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MetricChart } from '../src/features/body-progress/BodyProgress';

vi.mock('../src/lib/database/connection', () => ({
  getDatabase: vi.fn(() => new Promise(() => {})),
}));
import { Nutrition } from '../src/features/nutrition/Nutrition';

afterEach(cleanup);

it('explica a evolução corporal com escala, datas, variação e tabela textual', () => {
  render(
    <MetricChart
      points={[
        { date: '2026-10-04', value: 76.4 },
        { date: '2026-09-04', value: 78.2 },
      ]}
      label="Peso"
      unit="kg"
    />,
  );
  expect(
    screen.getByRole('img', { name: /Evolução de Peso: de 78,2 kg.*para 76,4 kg/ }),
  ).toBeTruthy();
  expect(screen.getByText(/−1,8 kg no período/)).toBeTruthy();
  expect(screen.getByRole('table', { name: 'Histórico de peso' })).toBeTruthy();
  expect(screen.getByLabelText(/desde a medição anterior/)).toBeTruthy();
});

it('mantém oito destinos de alimentação acessíveis com prioridade de navegação', async () => {
  render(<Nutrition day="2026-10-04" />);
  const nav = screen.getByRole('navigation', { name: 'Seções de alimentação' });
  expect(nav.querySelectorAll('button')).toHaveLength(8);
  const diet = screen.getByRole('button', { name: 'Dieta' });
  diet.focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(diet.getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: 'Alimentos' })).toBeTruthy();
});
