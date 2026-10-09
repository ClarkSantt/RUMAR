import { useEffect, useState } from 'react';
import { addDays, localDate } from '../../lib/dates';
import { getDatabase } from '../../lib/database/connection';
import { weekStart } from '../habits/domain';
import { WeeklyReviewRepository, type WeeklyReviewData } from './repository';
import './review-experience.css';

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function WeeklyReview({
  onNavigate,
  onTimeline,
  onMonthlyReview,
}: {
  onNavigate: (
    page:
      | 'tasks'
      | 'projects'
      | 'habits'
      | 'routines'
      | 'workouts'
      | 'nutrition'
      | 'finance'
      | 'calendar',
  ) => void;
  onTimeline: () => void;
  onMonthlyReview?: () => void;
}) {
  const [week, setWeek] = useState(() => weekStart(localDate()));
  const [data, setData] = useState<WeeklyReviewData | null>(null);
  const [error, setError] = useState('');
  const [reflection, setReflection] = useState<WeeklyReviewData['reflection']>({
    workedWell: '',
    didNotWork: '',
    changeNext: '',
    prioritiesNext: '',
  });
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => new WeeklyReviewRepository(db).load(week, localDate()))
      .then((result) => {
        if (active) {
          setData(result);
          setReflection(result.reflection);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar a revisão.');
      });
    return () => {
      active = false;
    };
  }, [week]);
  async function saveReflection() {
    try {
      await new WeeklyReviewRepository(await getDatabase()).saveReflection(week, reflection);
      setData((current) => (current ? { ...current, reflection } : current));
      setError('');
    } catch {
      setError('A reflexão não foi salva. Tente novamente.');
    }
  }
  async function finalizeReview() {
    if (!data) return;
    try {
      const repo = new WeeklyReviewRepository(await getDatabase());
      await repo.saveReflection(week, reflection);
      await repo.finalize(week, { ...data, reflection });
      const saved = await repo.load(week, localDate());
      setData(saved);
      setReflection(saved.reflection);
      setError('');
    } catch {
      setError('A revisão não pôde ser finalizada. Tente novamente.');
    }
  }
  return (
    <div className="legacy-review-page">
      <header className="page-header">
        <h1>Revisão semanal</h1>
        <p>Olhe para a semana e escolha o que vem a seguir.</p>
      </header>
      <div className="review-navigation">
        <button className="secondary-button" onClick={() => setWeek(addDays(week, -7))}>
          Semana anterior
        </button>
        <strong>
          {week.split('-').reverse().join('/')} a {addDays(week, 6).split('-').reverse().join('/')}
        </strong>
        {onMonthlyReview && (
          <button className="secondary-button" onClick={onMonthlyReview}>
            Revisão mensal
          </button>
        )}
        <button className="secondary-button" onClick={() => setWeek(weekStart(localDate()))}>
          Semana atual
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p role="status">Carregando revisão…</p>
      ) : (
        <>
          {data.tasks.completed === 0 &&
            data.habits.done === 0 &&
            data.routines.every((row) => row.done === 0) &&
            data.workouts.completed === 0 &&
            data.activity.days === 0 &&
            data.nutrition.days === 0 &&
            data.finance.income === 0 &&
            data.finance.expense === 0 && (
              <p className="field-help">Nenhum registro nesta semana.</p>
            )}
          <section className="review-story" aria-label="Resumo da semana">
            <div className="review-story-title">
              <div>
                <h2>O que aconteceu</h2>
                <p>Resumo preparado automaticamente a partir dos seus registros.</p>
              </div>
              {data.finalizedAt && <span className="review-finalized">Snapshot salvo</span>}
            </div>
            <div className="review-story-summary">
              <p>
                <strong>
                  {data.planning.completed}/{data.planning.planned}
                </strong>
                <span>planejamentos concluídos</span>
              </p>
              <p>
                <strong>{data.tasks.completed}</strong>
                <span>tarefas concluídas</span>
              </p>
              <p>
                <strong>
                  {data.habits.done}/{data.habits.target}
                </strong>
                <span>consistência de hábitos</span>
              </p>
              <p>
                <strong>{data.workouts.completed}</strong>
                <span>treinos realizados</span>
              </p>
            </div>
            <p className="review-planning-detail">
              {data.planning.skipped} pulados · {data.planning.cancelled} cancelados ·{' '}
              {Math.floor(data.planning.focusedSeconds / 60)} min de foco
            </p>
          </section>
          <section className="review-story review-writing">
            <h2>Reflexão</h2>
            <p>
              Os números preparam o contexto. As respostas registram o que você quer levar adiante.
            </p>
            {(
              [
                ['workedWell', 'O que funcionou bem?'],
                ['didNotWork', 'O que não funcionou?'],
                ['changeNext', 'O que quero mudar?'],
                ['prioritiesNext', 'Quais são as prioridades da próxima semana?'],
              ] as [keyof WeeklyReviewData['reflection'], string][]
            ).map(([key, label]) => (
              <label className="review-question" key={key}>
                <span>{label}</span>
                <textarea
                  value={reflection[key]}
                  onChange={(event) =>
                    setReflection((current) => ({ ...current, [key]: event.target.value }))
                  }
                  rows={3}
                  maxLength={4000}
                />
              </label>
            ))}
            <div className="review-writing-actions">
              <button
                className="secondary-button"
                onClick={() => void saveReflection()}
                disabled={JSON.stringify(reflection) === JSON.stringify(data.reflection)}
              >
                Salvar respostas
              </button>
              {!data.finalizedAt && (
                <button className="primary-button" onClick={() => void finalizeReview()}>
                  Finalizar revisão
                </button>
              )}
            </div>
          </section>
          <section className="review-story review-next">
            <h2>O que vem a seguir</h2>
            <button className="review-line" onClick={() => onNavigate('calendar')}>
              <strong>Próxima semana</strong>
              <span>
                {data.next.tasks} tarefas · {data.next.workouts} treinos · {data.next.bills} contas
                previstas · {data.next.projectDeadlines} prazos de projeto
              </span>
            </button>
          </section>
          <details className="review-context">
            <summary>Explorar registros por área</summary>
            <div className="review-grid">
              <section className="review-section">
                <h2>Organização</h2>
                <button className="review-line" onClick={() => onNavigate('tasks')}>
                  <strong>Tarefas</strong>
                  <span>
                    {data.tasks.completed} {data.tasks.completed === 1 ? 'concluída' : 'concluídas'}{' '}
                    · {data.tasks.pending} {data.tasks.pending === 1 ? 'pendente' : 'pendentes'} ·{' '}
                    {data.tasks.overdue} {data.tasks.overdue === 1 ? 'vencida' : 'vencidas'}
                  </span>
                </button>
                {data.tasks.pendingTitles.length > 0 && (
                  <ul>
                    {data.tasks.pendingTitles.map((title, i) => (
                      <li key={i}>{title}</li>
                    ))}
                  </ul>
                )}
                <button className="review-line" onClick={() => onNavigate('projects')}>
                  <strong>Projetos</strong>
                  <span>
                    {data.projects.withActivity} com atividade · {data.projects.withoutActivity} sem
                    atividade
                  </span>
                </button>
                <p className="review-detail">
                  Planejado: {Math.floor(data.planning.plannedSeconds / 60)} min · Foco registrado:{' '}
                  {Math.floor(data.planning.focusedSeconds / 60)} min
                </p>
                {data.projects.rows.map((row) => (
                  <p className="review-detail" key={row.id}>
                    {row.name}: {row.completed}/{row.total} tarefas · +{row.completedWeek}{' '}
                    {row.completedWeek === 1 ? 'concluída' : 'concluídas'} na semana
                  </p>
                ))}
                <button className="review-line" onClick={() => onNavigate('habits')}>
                  <strong>Hábitos</strong>
                  <span>
                    {data.habits.done} de {data.habits.target}{' '}
                    {data.habits.target === 1 ? 'ocorrência' : 'ocorrências'}
                  </span>
                </button>
                {data.habits.rows.map((row) => (
                  <p className="review-detail" key={row.id}>
                    {row.name}: {row.done}/{row.target}
                    {row.needsAttention ? ' · atenção: abaixo de 50% da meta' : ''}
                  </p>
                ))}
                <button className="review-line" onClick={() => onNavigate('routines')}>
                  <strong>Rotinas</strong>
                  <span>
                    {data.routines.length}{' '}
                    {data.routines.length === 1 ? 'acompanhada' : 'acompanhadas'}
                  </span>
                </button>
                {data.routines.map((row) => (
                  <p className="review-detail" key={row.id}>
                    {row.name}: {row.done}/{row.target} dias
                  </p>
                ))}
              </section>
              <section className="review-section">
                <h2>Treinos e atividade</h2>
                <button className="review-line" onClick={() => onNavigate('workouts')}>
                  <strong>Treinos</strong>
                  <span>
                    {data.workouts.completed}{' '}
                    {data.workouts.completed === 1 ? 'realizado' : 'realizados'} ·{' '}
                    {data.workouts.planned}{' '}
                    {data.workouts.planned === 1 ? 'programado' : 'programados'}
                  </span>
                </button>
                <p>{number.format(data.workouts.minutes)} min registrados</p>
                {data.workouts.estimatedCalories > 0 && (
                  <p>Gasto estimado: {number.format(data.workouts.estimatedCalories)} kcal</p>
                )}
                <p>
                  Passos: {number.format(data.activity.steps)} em {data.activity.days} dias · média{' '}
                  {number.format(data.activity.average)}
                </p>
              </section>
              <section className="review-section">
                <h2>Alimentação e corpo</h2>
                <button className="review-line" onClick={() => onNavigate('nutrition')}>
                  <strong>Alimentação</strong>
                  <span>
                    {data.nutrition.days}{' '}
                    {data.nutrition.days === 1 ? 'dia registrado' : 'dias registrados'}
                  </span>
                </button>
                {data.nutrition.days > 0 && (
                  <p>
                    Média: {number.format(data.nutrition.caloriesAverage)} kcal ·{' '}
                    {number.format(data.nutrition.proteinAverage)} g de proteína
                  </p>
                )}
                {data.nutrition.estimatedBalance !== null && (
                  <p>
                    Balanço energético estimado: {number.format(data.nutrition.estimatedBalance)}{' '}
                    kcal ({data.nutrition.balanceDays} dias com dados)
                  </p>
                )}
                {data.body.firstWeight !== null && data.body.lastWeight !== null && (
                  <p>
                    Peso registrado: {data.body.firstWeight.toLocaleString('pt-BR')} →{' '}
                    {data.body.lastWeight.toLocaleString('pt-BR')} kg
                  </p>
                )}
              </section>
              <section className="review-section">
                <h2>Finanças</h2>
                <button className="review-line" onClick={() => onNavigate('finance')}>
                  <strong>Receitas</strong>
                  <span>
                    {data.finance.hidden ? 'R$ •••••' : money.format(data.finance.income / 100)}
                  </span>
                </button>
                <p>
                  Despesas:{' '}
                  {data.finance.hidden ? 'R$ •••••' : money.format(data.finance.expense / 100)}
                </p>
                <p>
                  Balanço:{' '}
                  {data.finance.hidden
                    ? 'R$ •••••'
                    : money.format((data.finance.income - data.finance.expense) / 100)}
                </p>
                {!data.finance.hidden && typeof data.finance.expenseTrendPercent === 'number' && (
                  <p>
                    Tendência semanal: {data.finance.expenseTrendPercent > 0 ? '+' : ''}
                    {data.finance.expenseTrendPercent.toLocaleString('pt-BR')}% em despesas
                  </p>
                )}
              </section>
              {data.objectives.length > 0 && (
                <section className="review-section">
                  <h2>Objetivos</h2>
                  {data.objectives.map((row) => (
                    <p className="review-detail" key={row.id}>
                      {row.name}: {row.activities}{' '}
                      {row.activities === 1 ? 'atividade relacionada' : 'atividades relacionadas'}
                    </p>
                  ))}
                  <button className="secondary-button" onClick={onTimeline}>
                    Ver semana na Timeline
                  </button>
                </section>
              )}
            </div>
          </details>
          <nav className="review-actions" aria-label="Ações após a revisão">
            {data.milestones.length > 0 && (
              <p>
                Marcos concluídos:{' '}
                {data.milestones
                  .slice(0, 5)
                  .map((m) => m.title)
                  .join(' · ')}
              </p>
            )}
            <button className="secondary-button" onClick={() => onNavigate('tasks')}>
              Criar tarefa
            </button>
            <button className="secondary-button" onClick={() => onNavigate('projects')}>
              Criar projeto
            </button>
            <button className="secondary-button" onClick={() => onNavigate('workouts')}>
              Ajustar plano de treino
            </button>
            <button className="secondary-button" onClick={() => onNavigate('calendar')}>
              Abrir calendário
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
