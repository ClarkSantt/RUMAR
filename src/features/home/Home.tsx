import { ArrowRight, Check, Clock3, Inbox, Play, RefreshCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { QuickEntry } from '../../components/QuickEntry';
import type { RumoStore } from '../../hooks/useRumo';
import { fullDate, greeting, localDate } from '../../lib/dates';
import { getDatabase } from '../../lib/database/connection';
import type { TaskOccurrence } from '../../types/models';
import { requestFocus } from '../calendar/focus';
import { PlanningRepository } from '../planning/repository';
import { HomeRepository, type HomeDayData, type HomePlanningItem } from './repository';
import './home-day.css';

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function itemTime(item: HomePlanningItem, day = localDate()) {
  if (item.block_date !== day) return `Amanhã ${item.start_time}`;
  if (item.schedule_kind === 'fixed') return `${item.start_time}–${item.end_time}`;
  if (item.schedule_kind === 'period')
    return { morning: 'Manhã', afternoon: 'Tarde', evening: 'Noite' }[item.day_period ?? 'morning'];
  return 'Flexível';
}

export function Home({
  store,
  now,
  onInbox,
  onReview,
  onPlanning,
  onTasks,
  onWorkouts,
  onNutrition,
  onFinance,
  loadDay,
}: {
  store: RumoStore;
  now: Date;
  onOpen: (row: TaskOccurrence) => void;
  onInbox: () => void;
  onReview: () => void;
  onPlanning?: () => void;
  onTasks?: () => void;
  onWorkouts?: () => void;
  onNutrition?: () => void;
  onFinance?: () => void;
  loadDay?: () => Promise<HomeDayData>;
  quickSummary?: ReactNode;
  continuation?: ReactNode;
}) {
  const day = localDate(now);
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const [summary, setSummary] = useState<HomeDayData | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void (loadDay ? loadDay() : getDatabase().then((db) => new HomeRepository(db).day(day, time)))
      .then((result) => {
        if (active) {
          setSummary(result);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível atualizar o seu dia.');
      });
    return () => {
      active = false;
    };
  }, [day, time, revision, store.data, loadDay]);

  async function complete(item: HomePlanningItem) {
    try {
      await new PlanningRepository(await getDatabase()).setStatus(item.id, 'completed');
      setRevision((value) => value + 1);
    } catch {
      setError('Não foi possível concluir este item.');
    }
  }

  const current = summary?.planning.now;
  return (
    <div className="home-day-page">
      <header className="page-header home-header">
        <div>
          <h1>
            {greeting(now)}, {store.data!.settings.name}.
          </h1>
          <p className="date-line">{fullDate(day)}</p>
        </div>
        {summary && (
          <p className="home-day-progress" aria-live="polite">
            <strong>{summary.planning.completed}</strong> de {summary.planning.total} planejados
            concluídos
          </p>
        )}
      </header>
      {error && (
        <p role="alert" className="home-day-error">
          {error}{' '}
          <button className="text-button" onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw size={14} /> Tentar novamente
          </button>
        </p>
      )}
      {!summary ? (
        <p role="status">Preparando o seu dia…</p>
      ) : (
        <>
          <section className="home-now" aria-labelledby="home-now-title">
            <div className="home-section-kicker" id="home-now-title">
              {current?.block_date === day &&
              current.schedule_kind === 'fixed' &&
              current.start_time <= time &&
              current.end_time > time
                ? 'Agora'
                : 'Próximo'}
            </div>
            {current ? (
              <div className="home-now-content">
                <div>
                  <p className="home-now-time">
                    <Clock3 size={16} /> {itemTime(current, day)}
                  </p>
                  <h2>{current.title}</h2>
                  <p>
                    {current.source_type === 'standalone' ? 'Item do dia' : current.source_type}
                  </p>
                </div>
                <div className="home-now-actions">
                  <button
                    className="secondary-button"
                    onClick={() =>
                      requestFocus({
                        title: current.title,
                        taskId: current.source_type === 'task' ? current.source_id : null,
                        blockId: current.id,
                        occurrenceDate: current.block_date,
                      })
                    }
                  >
                    <Play size={16} /> Iniciar foco
                  </button>
                  <button className="primary-button" onClick={() => void complete(current)}>
                    <Check size={16} /> Concluir
                  </button>
                </div>
              </div>
            ) : (
              <div className="home-now-empty">
                <h2>Seu tempo está livre agora.</h2>
                <p>Escolha o que merece atenção ou preserve este espaço.</p>
                <button className="secondary-button" onClick={onPlanning}>
                  Abrir planejamento
                </button>
              </div>
            )}
          </section>

          <section className="home-next" aria-labelledby="home-next-title">
            <div className="home-section-heading">
              <h2 id="home-next-title">Depois</h2>
              <button className="text-button" onClick={onPlanning}>
                Ver planejamento <ArrowRight size={14} />
              </button>
            </div>
            {summary.planning.next.length ? (
              <div className="home-next-list">
                {summary.planning.next.map((item) => (
                  <button key={item.id} onClick={onPlanning}>
                    <time>{itemTime(item, day)}</time>
                    <strong>{item.title}</strong>
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="field-help">Nada mais planejado por enquanto.</p>
            )}
          </section>

          <div className="home-day-columns">
            <section className="home-today-summary" aria-labelledby="home-today-title">
              <div className="home-section-heading">
                <h2 id="home-today-title">Hoje</h2>
              </div>
              <div className="home-summary-lines">
                <button onClick={onPlanning}>
                  <span>Planejamento</span>
                  <strong>
                    {summary.planning.completed}/{summary.planning.total}
                  </strong>
                </button>
                {summary.habits.map((habit) => (
                  <button key={habit.id} onClick={onPlanning}>
                    <span>{habit.name}</span>
                    <strong>
                      {habit.reached
                        ? '✓'
                        : `${number.format(habit.value)}/${number.format(habit.target)}${habit.unit ? ` ${habit.unit}` : ''}`}
                    </strong>
                  </button>
                ))}
                <button onClick={onWorkouts}>
                  <span>Treino</span>
                  <strong>
                    {summary.workout ? `${summary.workout.name} concluído` : 'Não registrado'}
                  </strong>
                </button>
                <button onClick={onNutrition}>
                  <span>Alimentação</span>
                  <strong>
                    {number.format(summary.nutrition.calories)}
                    {summary.nutrition.calorieGoal
                      ? `/${number.format(summary.nutrition.calorieGoal)}`
                      : ''}{' '}
                    kcal · {number.format(summary.nutrition.protein)} g proteína
                  </strong>
                </button>
                <button onClick={onFinance}>
                  <span>Finanças</span>
                  <strong>
                    {summary.finance.hidden
                      ? 'Valores ocultos'
                      : `${money.format(summary.finance.expense / 100)} gastos hoje`}
                  </strong>
                </button>
              </div>
            </section>

            <section className="home-pending" aria-labelledby="home-pending-title">
              <div className="home-section-heading">
                <h2 id="home-pending-title">Pendências</h2>
                <button className="text-button" onClick={onTasks}>
                  Ver tarefas <ArrowRight size={14} />
                </button>
              </div>
              {summary.overdue.rows.length ? (
                <div className="home-pending-list">
                  {summary.overdue.rows.map((task) => (
                    <button key={task.id} onClick={onTasks}>
                      <strong>{task.title}</strong>
                      <span>Vencida em {task.due_date.split('-').reverse().join('/')}</span>
                    </button>
                  ))}
                  {summary.overdue.count > summary.overdue.rows.length && (
                    <p className="field-help">
                      +{summary.overdue.count - summary.overdue.rows.length} para retomar
                    </p>
                  )}
                </div>
              ) : (
                <p className="field-help">Nenhuma tarefa vencida.</p>
              )}
              {summary.planning.pending > 0 && (
                <button className="home-skipped" onClick={onPlanning}>
                  {summary.planning.pending} itens planejados ainda abertos
                </button>
              )}
              {summary.planning.skipped > 0 && (
                <button className="home-skipped" onClick={onPlanning}>
                  {summary.planning.skipped} itens pulados hoje
                </button>
              )}
            </section>
          </div>

          <section className="home-capture" aria-label="Captura rápida">
            <QuickEntry
              placeholder="Adicionar tarefa para hoje…"
              busy={store.busy}
              onSave={(title) =>
                store.run(
                  (repo) =>
                    repo.createTask({
                      title,
                      description: '',
                      priority: 'normal',
                      due_date: day,
                      due_time: null,
                      recurrence: null,
                    }),
                  'Tarefa adicionada.',
                )
              }
            />
            <button className="capture-hint" onClick={onInbox}>
              <Inbox size={16} />
              <span>Uma ideia para depois? Guarde no Inbox.</span>
            </button>
            <button className="capture-hint review-hint" onClick={onReview}>
              <span>Revisar a semana</span>
              <ArrowRight size={16} />
            </button>
          </section>
        </>
      )}
    </div>
  );
}
