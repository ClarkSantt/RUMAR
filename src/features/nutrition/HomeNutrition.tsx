import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { formatAmount, remaining, type Nutrients } from './domain';
import { NutritionRepository } from './repository';
import type { Goals } from './types';
export function HomeNutrition({
  day,
  onNavigate,
  compact = false,
}: {
  day: string;
  onNavigate: () => void;
  compact?: boolean;
}) {
  const [totals, setTotals] = useState<Nutrients>({}),
    [goals, setGoals] = useState<Goals>();
  useEffect(() => {
    let alive = true;
    void getDatabase()
      .then((db) => new NutritionRepository(db).daySummary(day))
      .then(([values, target]) => {
        if (alive) {
          setTotals(values);
          setGoals(target);
        }
      });
    return () => {
      alive = false;
    };
  }, [day]);
  if (compact)
    return (
      <section className="home-pulse-item home-nutrition-pulse">
        <span className="summary-label">Alimentação</span>
        <strong>
          {formatAmount(totals.energy_kcal ?? 0, 0)}
          {goals?.calories == null ? '' : ` / ${formatAmount(goals.calories, 0)}`} kcal
        </strong>
        <span className="summary-caption">
          Proteínas {formatAmount(totals.protein_g ?? 0)} g · Carboidratos{' '}
          {formatAmount(totals.carbohydrate_g ?? 0)} g
        </span>
        <button className="text-button" onClick={onNavigate}>
          Ver alimentação
        </button>
      </section>
    );
  return (
    <section className="secondary-section">
      <div className="section-heading">
        <h2>Alimentação</h2>
        <button className="text-button" onClick={onNavigate}>
          Abrir alimentação
        </button>
      </div>
      <button className="calendar-detail-item" onClick={onNavigate}>
        <strong>
          {formatAmount(totals.energy_kcal ?? 0, 0)}{' '}
          {goals?.calories == null ? '' : `/ ${formatAmount(goals.calories, 0)}`} kcal
        </strong>
        {goals?.calories != null && (
          <span className="field-help">
            {' '}
            · {formatAmount(remaining(totals.energy_kcal, goals.calories) ?? 0, 0)} restantes
          </span>
        )}
        <span className="field-help">
          {' '}
          · Carbs {formatAmount(totals.carbohydrate_g ?? 0)} g · Proteínas{' '}
          {formatAmount(totals.protein_g ?? 0)} g · Gorduras {formatAmount(totals.fat_g ?? 0)} g
        </span>
      </button>
    </section>
  );
}
