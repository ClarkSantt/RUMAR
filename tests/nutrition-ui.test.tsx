// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NutrientSummary } from '../src/features/nutrition/Nutrition';
afterEach(cleanup);

it('mostra consumido, meta e restante sem inventar micros ausentes', async () => {
  render(
    <NutrientSummary
      values={{ energy_kcal: 976, carbohydrate_g: 125, protein_g: 47, fat_g: 32, iron_mg: 8.2 }}
      goals={{ calories: 2074, carbs_g: 260, protein_g: 104, fat_g: 70 }}
    />,
  );
  expect(screen.getByText('1.098 kcal restantes')).toBeTruthy();
  expect(screen.getByText('125 / 260 g')).toBeTruthy();
  expect(
    screen.getByRole('progressbar', { name: 'Progresso de calorias' }).getAttribute('value'),
  ).toBe('976');
  await userEvent.click(screen.getByText('Micronutrientes e fibras'));
  expect(screen.getByText('8,2 mg')).toBeTruthy();
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});
