import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { money } from './domain';
import { FinanceRepository } from './repository';
import type { MonthSummary } from './types';

export function HomeFinance({ day, onNavigate }: { day: string; onNavigate: () => void }) {
  const [summary, setSummary] = useState<MonthSummary | null>(null),
    [hidden, setHidden] = useState(false);
  useEffect(() => {
    let live = true;
    void getDatabase()
      .then(async (db) => {
        const repo = new FinanceRepository(db);
        const [next, privacy] = await Promise.all([
          repo.monthSummary(day.slice(0, 7)),
          repo.hidden(),
        ]);
        if (live) {
          setSummary(next);
          setHidden(privacy);
        }
      })
      .catch(() => {
        if (live) setSummary(null);
      });
    return () => {
      live = false;
    };
  }, [day]);
  if (
    !summary ||
    (!summary.income_cents &&
      !summary.expense_cents &&
      !summary.reserved_cents &&
      !summary.planned_income_cents)
  )
    return null;
  return (
    <section className="secondary-section home-finance">
      <div className="section-heading">
        <h2>Finanças</h2>
        <button className="text-button" onClick={onNavigate}>
          Abrir →
        </button>
      </div>
      <div className="home-finance-line">
        <span>Disponível este mês</span>
        <strong>{money(summary.available_cents, hidden)}</strong>
      </div>
      <p className="field-help">
        Despesas {money(summary.expense_cents, hidden)} · Objetivos{' '}
        {money(summary.reserved_cents, hidden)} reservado
      </p>
    </section>
  );
}
