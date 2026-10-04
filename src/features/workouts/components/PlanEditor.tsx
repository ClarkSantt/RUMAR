import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Dialog } from '../../../components/Dialog';
import { EmptyState } from '../../../components/EmptyState';
import { getDatabase } from '../../../lib/database/connection';
import { HabitsRepository } from '../../habits/repository';
import { PlansRepository } from '../repositories/plans';
import type { WorkoutDay, WorkoutPlan } from '../types';
import { useWorkoutAction } from './useWorkoutAction';
import { DayForm, PlanForm } from './PlanForms';
import { PlanDay } from './PlanDay';
import '../workouts.css';
import { weekdays } from '../../../lib/dates';
import { SaveTemplateButton } from '../../templates/SaveTemplateButton';

export function PlanEditor({ onChange }: { onChange?: () => void }) {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]),
    [step, setStep] = useState(5),
    [showArchived, setShowArchived] = useState(false),
    [selected, setSelected] = useState(''),
    [dayData, setDayData] = useState<{ planId: string; rows: WorkoutDay[] }>({
      planId: '',
      rows: [],
    }),
    [dayId, setDayId] = useState(''),
    [habits, setHabits] = useState<{ id: string; name: string }[]>([]),
    [revision, setRevision] = useState(0),
    [loaded, setLoaded] = useState(false);
  const [planEditor, setPlanEditor] = useState<'new' | 'edit' | null>(null),
    [dayEditor, setDayEditor] = useState<WorkoutDay | 'new' | null>(null),
    [confirm, setConfirm] = useState<
      { kind: 'archive'; plan: WorkoutPlan } | { kind: 'day'; day: WorkoutDay } | null
    >(null);
  const action = useWorkoutAction(() => {
    setRevision((r) => r + 1);
    onChange?.();
  });
  const { setError } = action;
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => {
        const [all, available] = await Promise.all([
          new PlansRepository(db).list(showArchived),
          new HabitsRepository(db).list(),
        ]);
        if (active) {
          setPlans(all);
          setHabits(available.filter((h) => h.kind === 'boolean' && h.active));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError('Não foi possível carregar os planos.');
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [revision, showArchived, setError]);
  const visiblePlans = plans.filter((p) => showArchived || !p.archived_at);
  const plan =
    visiblePlans.find((p) => p.id === selected) ??
    visiblePlans.find((p) => p.active) ??
    visiblePlans[0];
  const planId = plan?.id;
  const days = dayData.planId === planId ? dayData.rows : [];
  useEffect(() => {
    let active = true;
    if (planId)
      void getDatabase()
        .then((db) => new PlansRepository(db).days(planId))
        .then((rows) => {
          if (active) setDayData({ planId, rows });
        })
        .catch(() => {
          if (active) setError('Não foi possível carregar os dias do plano.');
        });
    return () => {
      active = false;
    };
  }, [planId, revision, setError]);
  const day = days.find((d) => d.id === dayId) ?? days[0];
  const run = (fn: (repo: PlansRepository) => Promise<unknown>) =>
    action.run(async () => fn(new PlansRepository(await getDatabase())));
  return (
    <section>
      <header className="workout-section-heading">
        <div>
          <h2>Planos de treino</h2>
          <p>Organize seus dias e as séries planejadas.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            action.setError('');
            setPlanEditor('new');
          }}
        >
          <Plus size={16} />
          Novo plano
        </button>
      </header>
      <label>
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />{' '}
        Mostrar planos arquivados
      </label>
      {action.error && !planEditor && !dayEditor && !confirm && (
        <p role="alert" className="workout-error">
          {action.error}
        </p>
      )}
      {!loaded ? (
        <p role="status">Carregando planos…</p>
      ) : !plan ? (
        <EmptyState
          title="Nenhum plano de treino ainda."
          description="Crie seu primeiro plano para começar."
        />
      ) : (
        <>
          <label htmlFor="workout-plan-select">Plano</label>
          <select
            id="workout-plan-select"
            value={plan.id}
            onChange={(e) => {
              setSelected(e.target.value);
              setDayId('');
            }}
          >
            {visiblePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived_at ? ' · Arquivado' : p.active ? ' · Ativo' : ''}
              </option>
            ))}
          </select>
          <div className="workout-plan-summary">
            <SaveTemplateButton kind="workout" sourceId={plan.id} initialName={plan.name} />
            <div>
              <h3>{plan.name}</h3>
              {plan.description && <p className="workout-notes">{plan.description}</p>}
              <p>
                {plan.archived_at
                  ? 'Plano arquivado · somente leitura'
                  : plan.active
                    ? 'Plano ativo · usado no Início e Calendário'
                    : 'Plano inativo'}
                {plan.habit_id
                  ? ` · Hábito: ${habits.find((h) => h.id === plan.habit_id)?.name ?? 'indisponível'}`
                  : ''}
              </p>
            </div>
            <fieldset className="workout-row-actions" disabled={Boolean(plan.archived_at)}>
              {!plan.active && (
                <button
                  className="secondary-button"
                  disabled={action.busy}
                  onClick={() => void run((repo) => repo.activate(plan.id))}
                >
                  Ativar plano
                </button>
              )}
              <button
                className="secondary-button"
                disabled={action.busy}
                onClick={() => {
                  action.setError('');
                  setPlanEditor('edit');
                }}
              >
                Editar plano
              </button>
              <button
                className="text-button"
                disabled={action.busy}
                onClick={() => {
                  action.setError('');
                  setConfirm({ kind: 'archive', plan });
                }}
              >
                Arquivar plano
              </button>
            </fieldset>
          </div>
          <nav className="tabs" aria-label="Etapas do planejamento">
            {['Informações', 'Divisão', 'Dias', 'Exercícios', 'Revisão'].map((label, i) => (
              <button
                key={label}
                aria-current={step === i + 1 ? 'step' : undefined}
                onClick={() => {
                  setStep(i + 1);
                  if (i === 0 && !plan.archived_at) setPlanEditor('edit');
                }}
              >
                {i + 1}. {label}
              </button>
            ))}
          </nav>
          <p className="field-help">
            {step === 2
              ? 'Crie os treinos da divisão abaixo; renomeie, remova ou ordene pelo cabeçalho de cada treino.'
              : step === 3
                ? 'Edite cada treino para selecionar um ou mais dias. Dias sem treino representam descanso.'
                : step === 4
                  ? 'Selecione cada treino e adicione os exercícios da biblioteca, com séries, repetições e descanso.'
                  : step === 5
                    ? 'Revise a programação semanal. Somente o plano ativo alimenta Hoje, Início e Calendário.'
                    : 'Defina nome, descrição e o vínculo opcional com um hábito.'}
          </p>
          {(step === 3 || step === 5) && (
            <div className="workout-plan-summary" style={{ flexWrap: 'wrap' }}>
              {weekdays.map((w) => (
                <div key={w.value}>
                  <strong>{w.short}</strong>
                  <p>
                    {days
                      .filter((d) => d.weekdays?.includes(w.value))
                      .map((d) => `${d.name} · ${d.exercise_count ?? 0} exercícios`)
                      .join(' · ') || 'Sem treino'}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="workout-row-actions">
            <button
              className="secondary-button"
              disabled={step <= 1}
              onClick={() => setStep((s) => s - 1)}
            >
              Etapa anterior
            </button>
            <button
              className="secondary-button"
              disabled={step >= 5}
              onClick={() => setStep((s) => s + 1)}
            >
              Próxima etapa
            </button>
          </div>
          <div className="workout-day-navigation">
            <nav className="workout-day-tabs" aria-label="Dias do plano">
              {days.map((d) => (
                <button
                  key={d.id}
                  aria-current={day?.id === d.id ? 'page' : undefined}
                  onClick={() => setDayId(d.id)}
                >
                  {d.name}
                </button>
              ))}
            </nav>
            <button
              className="secondary-button"
              disabled={action.busy || Boolean(plan.archived_at)}
              onClick={() => {
                action.setError('');
                setDayEditor('new');
              }}
            >
              <Plus size={16} />
              Adicionar dia
            </button>
          </div>
          {day ? (
            <fieldset disabled={Boolean(plan.archived_at)}>
              <PlanDay
                key={day.id}
                day={day}
                index={days.findIndex((d) => d.id === day.id)}
                total={days.length}
                disabled={action.busy}
                onEdit={() => {
                  action.setError('');
                  setDayEditor(day);
                }}
                onRemove={() => {
                  action.setError('');
                  setConfirm({ kind: 'day', day });
                }}
                onMove={(direction) => void run((repo) => repo.moveDay(day.id, direction))}
                onChange={() => {
                  setRevision((n) => n + 1);
                  onChange?.();
                }}
              />
            </fieldset>
          ) : (
            <EmptyState
              title="Nenhum dia de treino neste plano."
              description="Adicione dias como Push, Pull ou Upper, com ou sem dia fixo."
            />
          )}
        </>
      )}
      {planEditor && (
        <PlanForm
          plan={planEditor === 'edit' ? plan : undefined}
          habits={habits}
          busy={action.busy}
          error={action.error}
          onClose={() => setPlanEditor(null)}
          onSave={(input) =>
            run(async (repo) => {
              const id = await repo.save(input, planEditor === 'edit' ? plan?.id : undefined);
              setSelected(id);
              if (planEditor === 'new') setStep(2);
            })
          }
        />
      )}
      {dayEditor && plan && (
        <DayForm
          day={dayEditor === 'new' ? undefined : dayEditor}
          busy={action.busy}
          error={action.error}
          onClose={() => setDayEditor(null)}
          onSave={(input) =>
            run(async (repo) => {
              const id = await repo.saveDay(
                plan.id,
                input,
                dayEditor === 'new' ? undefined : dayEditor.id,
              );
              setDayId(id);
            })
          }
        />
      )}
      {confirm && (
        <Dialog
          title={confirm.kind === 'archive' ? 'Arquivar plano?' : 'Remover dia do plano?'}
          busy={action.busy}
          error={action.error || undefined}
          onClose={() => setConfirm(null)}
        >
          <div className="dialog-content">
            <p>
              {confirm.kind === 'archive'
                ? `“${confirm.plan.name}” deixará de aparecer no planejamento. Os treinos realizados serão preservados.`
                : `“${confirm.day.name}” e seus exercícios planejados serão removidos do plano. Sessões anteriores serão preservadas.`}
            </p>
          </div>
          <footer className="drawer-footer">
            <button
              className="secondary-button"
              disabled={action.busy}
              onClick={() => setConfirm(null)}
            >
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={action.busy}
              onClick={() =>
                void run((repo) =>
                  confirm.kind === 'archive'
                    ? repo.archive(confirm.plan.id)
                    : repo.removeDay(confirm.day.id),
                ).then((ok) => {
                  if (ok) setConfirm(null);
                })
              }
            >
              {confirm.kind === 'archive' ? 'Arquivar plano' : 'Remover dia'}
            </button>
          </footer>
        </Dialog>
      )}
    </section>
  );
}
