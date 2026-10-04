import { useState } from 'react';
import { Dialog } from '../../../components/Dialog';
import { weekdays } from '../../../lib/dates';
import type { DayInput, PlanInput, WorkoutDay, WorkoutPlan } from '../types';

interface FormProps<T> {
  busy: boolean;
  error: string;
  onSave: (input: T) => Promise<boolean>;
  onClose: () => void;
}
export function PlanForm({
  plan,
  habits,
  busy,
  error,
  onSave,
  onClose,
}: FormProps<PlanInput> & { plan?: WorkoutPlan; habits: { id: string; name: string }[] }) {
  const [draft, setDraft] = useState<PlanInput>({
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    habit_id: plan?.habit_id ?? null,
  });
  return (
    <Dialog
      title={plan ? 'Editar plano' : 'Novo plano de treino'}
      onClose={onClose}
      busy={busy}
      error={error || undefined}
    >
      <form
        className="workout-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(draft).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        <div className="dialog-content">
          <fieldset disabled={busy}>
            <label htmlFor="plan-name">Nome do plano</label>
            <input
              id="plan-name"
              required
              maxLength={500}
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <label htmlFor="plan-description">Descrição</label>
            {!plan && (
              <label>
                <input
                  type="checkbox"
                  checked={draft.activate ?? false}
                  onChange={(e) => setDraft({ ...draft, activate: e.target.checked })}
                />{' '}
                Plano ativo
              </label>
            )}
            <textarea
              id="plan-description"
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <label htmlFor="plan-habit">
              Hábito vinculado <span>opcional</span>
            </label>
            <select
              id="plan-habit"
              value={draft.habit_id ?? ''}
              onChange={(e) => setDraft({ ...draft, habit_id: e.target.value || null })}
            >
              <option value="">Sem vínculo</option>
              {draft.habit_id && !habits.some((h) => h.id === draft.habit_id) && (
                <option value={draft.habit_id}>Hábito indisponível — remova o vínculo</option>
              )}
              {habits.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <p className="field-help">
              Ao concluir um treino, o hábito de marcar feito será registrado para a data da sessão.
              Iniciar ou descartar não conta.
            </p>
          </fieldset>
        </div>
        <footer className="drawer-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            Salvar plano
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
export function DayForm({
  day,
  busy,
  error,
  onSave,
  onClose,
}: FormProps<DayInput> & { day?: WorkoutDay }) {
  const [draft, setDraft] = useState<DayInput>({
    name: day?.name ?? '',
    weekday: day?.weekday ?? null,
    weekdays: day?.weekdays ?? (day?.weekday == null ? [] : [day.weekday]),
    notes: day?.notes ?? '',
  });
  return (
    <Dialog
      title={day ? 'Editar dia de treino' : 'Novo dia de treino'}
      onClose={onClose}
      busy={busy}
      error={error || undefined}
    >
      <form
        className="workout-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(draft).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        <div className="dialog-content">
          <fieldset disabled={busy}>
            <label htmlFor="workout-day-name">Nome do dia</label>
            <input
              id="workout-day-name"
              required
              maxLength={500}
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <fieldset>
              <legend>Dias da semana</legend>
              {weekdays.map((d) => (
                <label key={d.value}>
                  <input
                    type="checkbox"
                    checked={draft.weekdays?.includes(d.value) ?? false}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        weekdays: e.target.checked
                          ? [...(draft.weekdays ?? []), d.value]
                          : (draft.weekdays ?? []).filter((w) => w !== d.value),
                      })
                    }
                  />
                  {d.label}
                </label>
              ))}
              <p className="field-help">
                Sem seleção: treino sem dia fixo. Dias sem treino representam descanso.
              </p>
            </fieldset>
            <label htmlFor="workout-day-notes">Observações</label>
            <textarea
              id="workout-day-notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </fieldset>
        </div>
        <footer className="drawer-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            Salvar dia
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
