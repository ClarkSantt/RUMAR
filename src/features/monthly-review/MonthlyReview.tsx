import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { localDate, parseDate } from '../../lib/dates';
import { durationLabel } from '../calendar/planner-domain';
import {
  adjacentMonth,
  monthStart,
  MonthlyReviewRepository,
  type MonthlyReviewData,
} from './repository';
type Page =
  | 'tasks'
  | 'projects'
  | 'objectives'
  | 'habits'
  | 'routines'
  | 'workouts'
  | 'nutrition'
  | 'finance'
  | 'calendar';
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
const monthLabel = (value: string) =>
  parseDate(value).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const metricLabels: Record<string, string> = {
  weight: 'Peso',
  body_fat: 'Gordura corporal',
  waist: 'Cintura',
  chest: 'Peito',
  hips: 'Quadril',
  abdomen: 'Abdômen',
};
const volumeLabels: Record<string, string> = {
  total: 'carga total registrada',
  per_side: 'carga registrada por lado',
  per_dumbbell: 'carga registrada por halter',
  additional: 'carga adicional registrada',
};
export function MonthlyReview({
  onNavigate,
  onTimeline,
  onWeeklyReview,
}: {
  onNavigate: (page: Page, id?: string) => void;
  onTimeline: (id?: string) => void;
  onWeeklyReview?: () => void;
}) {
  const [month, setMonth] = useState(() => monthStart(localDate())),
    [data, setData] = useState<MonthlyReviewData | null>(null),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => new MonthlyReviewRepository(db).load(month))
      .then((result) => {
        if (active) {
          setData(result);
          setNote(result.note);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar a revisão mensal.');
      });
    return () => {
      active = false;
    };
  }, [month]);
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await new MonthlyReviewRepository(await getDatabase()).saveNote(month, note);
      setSaved(true);
      setData((current) => (current ? { ...current, note } : current));
      setError('');
    } catch {
      setError('A nota não foi salva. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }
  function changeMonth(next: string) {
    if (next === month) return;
    if (
      data &&
      !data.privateMode &&
      note !== data.note &&
      !window.confirm('A nota mensal ainda não foi salva. Trocar de mês e descartar esta edição?')
    )
      return;
    setData(null);
    setSaved(false);
    setMonth(next);
  }
  const empty =
    data &&
    !data.tasks.completed &&
    !data.projects.withActivity &&
    !data.objectives.completed &&
    !data.milestones.length &&
    !data.habits.done &&
    !data.routines &&
    !data.workouts.sessions &&
    !data.focus.sessions &&
    !data.activity.days &&
    !data.nutrition.days &&
    !data.finance.income &&
    !data.finance.expense &&
    !data.moments.length;
  return (
    <>
      <header className="page-header">
        <p className="eyebrow">REGISTRAR → REVISAR → CONTINUAR</p>
        <h1>Revisão Mensal</h1>
        <p>Um resumo do que foi registrado no RUMAR.</p>
      </header>
      <div className="review-navigation">
        <button
          className="secondary-button"
          disabled={saving}
          onClick={() => changeMonth(adjacentMonth(month, -1))}
        >
          Mês anterior
        </button>
        <strong>{monthLabel(month)}</strong>
        <button
          className="secondary-button"
          disabled={saving || month >= monthStart(localDate())}
          onClick={() => changeMonth(adjacentMonth(month, 1))}
        >
          Próximo mês
        </button>
        <button
          className="secondary-button"
          disabled={saving}
          onClick={() => changeMonth(monthStart(localDate()))}
        >
          Mês atual
        </button>
        {onWeeklyReview && (
          <button className="secondary-button" onClick={onWeeklyReview}>
            Revisão semanal
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p role="status">Carregando revisão…</p>
      ) : (
        <>
          {data.effectiveEnd < data.end && (
            <p className="field-help">
              Período registrado até {data.effectiveEnd.split('-').reverse().join('/')}. Dias
              futuros não entram nas métricas realizadas.
            </p>
          )}
          {empty && <p className="field-help">Nenhum registro neste mês.</p>}
          <section className="review-section">
            <h2>Resumo do mês</h2>
            <div className="review-navigation">
              <span>{data.tasks.completed} tarefas concluídas</span>
              <span>{data.workouts.sessions} treinos</span>
              <span>{durationLabel(data.focus.seconds)} de foco registrado</span>
              <span>{data.nutrition.days} dias de alimentação registrada</span>
            </div>
          </section>
          <div className="review-grid">
            <section className="review-section">
              <h2>Objetivos e projetos</h2>
              <button className="review-line" onClick={() => onNavigate('objectives')}>
                <strong>Objetivos</strong>
                <span>
                  {data.objectives.active} ativos · {data.objectives.withActivity} com atividade ·{' '}
                  {data.objectives.completed} concluídos
                </span>
              </button>
              {data.objectives.updates.map((o) => (
                <button
                  key={o.id}
                  className="review-line"
                  onClick={() => onNavigate('objectives', o.id)}
                >
                  <span>{o.name}</span>
                  <span>{o.activities} registros relacionados</span>
                </button>
              ))}
              <button className="review-line" onClick={() => onNavigate('projects')}>
                <strong>Projetos</strong>
                <span>
                  {data.projects.completed} concluídos · {data.projects.withActivity} com atividade
                </span>
              </button>
              <h3>Marcos concluídos</h3>
              {data.milestones.length ? (
                data.milestones.slice(0, 6).map((m) => (
                  <button
                    key={m.id}
                    className="review-line"
                    onClick={() => onNavigate('objectives', m.objective_id)}
                  >
                    <span>{m.title}</span>
                    <small>
                      {m.objective_name} · {m.achieved_date?.split('-').reverse().join('/')}
                    </small>
                  </button>
                ))
              ) : (
                <p className="field-help">Nenhum marco concluído no período.</p>
              )}
            </section>
            <section className="review-section">
              <h2>Tempo e organização</h2>
              <button className="review-line" onClick={() => onNavigate('tasks')}>
                <strong>Tarefas</strong>
                <span>
                  {data.tasks.completed} concluídas · {data.tasks.pending} pendentes ao fim do
                  período
                </span>
              </button>
              <button className="review-line" onClick={() => onNavigate('habits')}>
                <strong>Hábitos</strong>
                <span>
                  {data.habits.done} de {data.habits.target} ocorrências registradas
                  {data.habits.target
                    ? ` · ${Math.round((data.habits.done / data.habits.target) * 100)}%`
                    : ''}
                </span>
              </button>
              <button className="review-line" onClick={() => onNavigate('routines')}>
                <strong>Rotinas</strong>
                <span>{data.routines} execuções concluídas</span>
              </button>
              <button className="review-line" onClick={() => onNavigate('calendar')}>
                <strong>Time Blocks planejados no mês</strong>
                <span>{durationLabel(data.planningSeconds)}</span>
              </button>
              <p className="review-line">
                <strong>Foco registrado</strong>
                <span>
                  {durationLabel(data.focus.seconds)} · {data.focus.sessions} sessões concluídas
                </span>
              </p>
              <p className="field-help">
                Planejamento e foco são registros diferentes. Não representam uma pontuação de
                produtividade.
              </p>
            </section>
            <section className="review-section">
              <h2>Treinos e corpo</h2>
              <button className="review-line" onClick={() => onNavigate('workouts')}>
                <strong>Treinos</strong>
                <span>
                  {data.workouts.sessions} sessões · {durationLabel(data.workouts.minutes * 60)}
                </span>
              </button>
              {data.workouts.volumes.map((v) => (
                <p className="review-line" key={v.load_type}>
                  <span>Volume: {volumeLabels[v.load_type] ?? v.load_type}</span>
                  <span>{number.format(v.volume)} kg × reps</span>
                </p>
              ))}
              <p className="field-help">
                Volumes mantêm os tipos de carga separados. Aquecimentos não entram no volume
                principal.
              </p>
              <p>
                Gasto estimado em treinos: {number.format(data.workouts.estimatedCalories)} kcal
              </p>
              <p className="review-line">
                <strong>Passos</strong>
                <span>
                  {number.format(data.activity.average)} por dia registrado · {data.activity.days}/
                  {data.elapsedDays} dias · total {number.format(data.activity.steps)}
                </span>
              </p>
              {data.body.map((b) => (
                <p className="review-line" key={b.metric_key}>
                  <strong>{metricLabels[b.metric_key] ?? b.metric_key}</strong>
                  <span>
                    {b.first.toLocaleString('pt-BR')} → {b.last.toLocaleString('pt-BR')} {b.unit}
                  </span>
                </p>
              ))}
              {data.privateMode && (
                <p className="field-help">Valores corporais ocultos pelo modo privado.</p>
              )}
            </section>
            <section className="review-section">
              <h2>Alimentação</h2>
              <button className="review-line" onClick={() => onNavigate('nutrition')}>
                <strong>Média registrada</strong>
                <span>{number.format(data.nutrition.caloriesAverage)} kcal/dia</span>
              </button>
              <p className="review-line">
                <strong>Proteína média</strong>
                <span>{number.format(data.nutrition.proteinAverage)} g/dia</span>
              </p>
              <p>
                {data.nutrition.days} de {data.elapsedDays} dias com alimentação registrada.
              </p>
              <p>
                Balanço energético acumulado estimado:{' '}
                {data.nutrition.balance === null
                  ? 'Sem dados suficientes'
                  : `${number.format(data.nutrition.balance)} kcal`}
              </p>
              <p className="field-help">
                Balanço disponível em {data.nutrition.balanceDays} dias. Usa as estimativas e os
                registros existentes, sem converter o saldo em perda de gordura.
              </p>
            </section>
            <section className="review-section">
              <h2>Finanças</h2>
              <button className="review-line" onClick={() => onNavigate('finance')}>
                <strong>Receitas</strong>
                <span>{data.finance.hidden ? 'R$ •••••' : money(data.finance.income)}</span>
              </button>
              <p className="review-line">
                <strong>Despesas</strong>
                <span>{data.finance.hidden ? 'R$ •••••' : money(data.finance.expense)}</span>
              </p>
              <p className="review-line">
                <strong>Balanço</strong>
                <span>
                  {data.finance.hidden
                    ? 'R$ •••••'
                    : money(data.finance.income - data.finance.expense)}
                </span>
              </p>
              {data.finance.categories.map((c) => (
                <p className="review-line" key={c.name}>
                  <span>{c.name}</span>
                  <span>{money(c.amount)}</span>
                </p>
              ))}
            </section>
            <section className="review-section">
              <h2>Momentos do mês</h2>
              {data.moments.map((m) => (
                <button
                  className="review-line"
                  key={m.id}
                  onClick={() => onTimeline(m.objectiveId ?? undefined)}
                >
                  <span>{m.title}</span>
                  <small>{m.date.split('-').reverse().join('/')}</small>
                </button>
              ))}
              {!data.moments.length && (
                <p className="field-help">
                  {data.privateMode
                    ? 'Conteúdo oculto pelo modo privado.'
                    : 'Nenhum momento destacado no período.'}
                </p>
              )}
              <button className="secondary-button" onClick={() => onTimeline()}>
                Abrir Timeline
              </button>
            </section>
          </div>
          <section className="review-section">
            <h2>Comparação com mês anterior</h2>
            <p className="field-help">
              Mês atual consultado: {data.elapsedDays} dias. {monthLabel(data.previous.month)}: mês
              completo. As médias consideram apenas dias registrados.
            </p>
            <table>
              <caption>Registros dos períodos consultados</caption>
              <thead>
                <tr>
                  <th>Métrica</th>
                  <th>{monthLabel(data.start)}</th>
                  <th>{monthLabel(data.previous.month)}</th>
                  <th>Diferença</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Treinos</th>
                  <td>{data.workouts.sessions}</td>
                  <td>{data.previous.workouts}</td>
                  <td>{data.workouts.sessions - data.previous.workouts}</td>
                </tr>
                <tr>
                  <th>Passos médios/dia registrado</th>
                  <td>
                    {number.format(data.activity.average)} ({data.activity.days} dias)
                  </td>
                  <td>
                    {number.format(data.previous.averageSteps)} ({data.previous.registeredDays}{' '}
                    dias)
                  </td>
                  <td>
                    {data.activity.days && data.previous.registeredDays
                      ? number.format(data.activity.average - data.previous.averageSteps)
                      : 'Sem cobertura comparável'}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
          <section className="review-section">
            <h2>Nota mensal</h2>
            {data.privateMode ? (
              <p className="field-help">
                Desative o modo privado da Timeline para consultar ou editar a nota pessoal.
              </p>
            ) : (
              <>
                <label htmlFor="monthly-note">Reflexão pessoal opcional</label>
                <textarea
                  id="monthly-note"
                  rows={4}
                  maxLength={8000}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setSaved(false);
                  }}
                />
                <button className="secondary-button" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Salvando…' : 'Salvar nota'}
                </button>
                {saved && <p role="status">Nota salva.</p>}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
