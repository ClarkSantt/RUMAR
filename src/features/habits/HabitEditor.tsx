import { useEffect, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { getDatabase } from '../../lib/database/connection';
import { addDays, weekdays } from '../../lib/dates';
import type { Habit, HabitInput, HabitEntry } from './domain';
import { HabitsRepository } from './repository';
import { VisibilityControl } from '../calendar/VisibilityControl';
const repository = async () => new HabitsRepository(await getDatabase());
export function HabitEditor({
  habit,
  day,
  onClose,
  onSaved,
}: {
  habit: Habit | null;
  day: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<HabitInput>(
      habit ?? {
        name: '',
        description: '',
        frequency: 'daily',
        weekdays: [1, 3, 5],
        weekly_target: 3,
        kind: 'boolean',
        target_value: 1,
        unit: '',
        start_date: day,
        end_date: null,
        project_id: null,
        active: 1,
      },
    ),
    [projects, setProjects] = useState<{ id: string; name: string }[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [historyDate, setHistoryDate] = useState(day),
    [historyValue, setHistoryValue] = useState('0'),
    [history, setHistory] = useState<HabitEntry[]>([]),
    [revision, setRevision] = useState(0),
    [confirmArchive, setConfirmArchive] = useState(false);
  const change = <K extends keyof HabitInput>(key: K, value: HabitInput[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  useEffect(() => {
    let active = true;
    void repository()
      .then((r) => r.projectOptions())
      .then((rows) => {
        if (active) setProjects(rows);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!habit) return;
    let active = true;
    void repository()
      .then((r) => r.entries(addDays(historyDate, -29), historyDate, habit.id))
      .then((rows) => {
        if (active) {
          setHistory(rows);
          setHistoryValue(String(rows.find((e) => e.entry_date === historyDate)?.value ?? 0));
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [habit, historyDate, revision]);
  async function action(callback: (r: HabitsRepository) => Promise<unknown>, close = true) {
    setBusy(true);
    setError('');
    try {
      await callback(await repository());
      if (close) onSaved();
      else setRevision((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={habit ? 'Editar hábito' : 'Novo hábito'}
      drawer
      onClose={habit ? onSaved : onClose}
      busy={busy}
      error={error}
    >
      <div className="drawer-body">
        {habit && <VisibilityControl kind="habit" id={habit.id} />}
        {habit && (
          <div className="habit-detail-intro">
            <span>Hábito · {habit.active ? 'Ativo' : 'Pausado'}</span>
            <h3>{habit.name}</h3>
            {habit.description && <p>{habit.description}</p>}
            <small>
              {habit.kind === 'quantity'
                ? `Meta: ${habit.target_value} ${habit.unit}`
                : 'Registro: feito ou não feito'}{' '}
              ·{' '}
              {habit.frequency === 'daily'
                ? 'Todos os dias'
                : habit.frequency === 'weekly_target'
                  ? `${habit.weekly_target} vezes por semana`
                  : 'Dias selecionados'}
            </small>
          </div>
        )}
        <form
          id="habit-form"
          className="habit-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action((r) => r.save(draft, habit?.id));
          }}
        >
          <label>
            Nome
            <input
              required
              maxLength={500}
              value={draft.name}
              onChange={(e) => change('name', e.target.value)}
            />
          </label>
          <label>
            Descrição
            <textarea
              value={draft.description}
              onChange={(e) => change('description', e.target.value)}
            />
          </label>
          <label>
            Frequência
            <select
              value={draft.frequency}
              onChange={(e) => change('frequency', e.target.value as HabitInput['frequency'])}
            >
              <option value="daily">Todos os dias</option>
              <option value="weekdays">Dias da semana</option>
              <option value="weekly_target">Vezes por semana</option>
            </select>
          </label>
          {draft.frequency === 'weekdays' && (
            <div className="habit-days" role="group" aria-label="Dias do hábito">
              {weekdays.map((d) => (
                <label key={d.value}>
                  <input
                    type="checkbox"
                    checked={draft.weekdays.includes(d.value)}
                    onChange={(e) =>
                      change(
                        'weekdays',
                        e.target.checked
                          ? [...draft.weekdays, d.value]
                          : draft.weekdays.filter((v) => v !== d.value),
                      )
                    }
                  />
                  {d.short}
                </label>
              ))}
            </div>
          )}
          {draft.frequency === 'weekly_target' && (
            <label>
              Vezes por semana
              <input
                type="number"
                min="1"
                max="7"
                required
                value={draft.weekly_target}
                onChange={(e) => change('weekly_target', Number(e.target.value))}
              />
            </label>
          )}
          <label>
            Registro
            <select
              value={draft.kind}
              onChange={(e) => change('kind', e.target.value as HabitInput['kind'])}
            >
              <option value="boolean">Feito / não feito</option>
              <option value="quantity">Quantidade</option>
            </select>
          </label>
          {draft.kind === 'quantity' && (
            <div className="habit-columns">
              <label>
                Meta
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  value={draft.target_value}
                  onChange={(e) => change('target_value', Number(e.target.value))}
                />
              </label>
              <label>
                Unidade
                <input
                  required
                  placeholder="minutos, páginas…"
                  value={draft.unit}
                  onChange={(e) => change('unit', e.target.value)}
                />
              </label>
            </div>
          )}
          <div className="habit-columns">
            <label>
              Início
              <input
                type="date"
                required
                value={draft.start_date}
                onChange={(e) => change('start_date', e.target.value)}
              />
            </label>
            <label>
              Fim opcional
              <input
                type="date"
                min={draft.start_date}
                value={draft.end_date ?? ''}
                onChange={(e) => change('end_date', e.target.value || null)}
              />
            </label>
          </div>
          <label>
            Projeto
            <select
              value={draft.project_id ?? ''}
              onChange={(e) => change('project_id', e.target.value || null)}
            >
              <option value="">Sem projeto</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="habit-inline">
            <input
              type="checkbox"
              checked={!!draft.active}
              onChange={(e) => change('active', e.target.checked ? 1 : 0)}
            />
            Hábito ativo
          </label>
        </form>
        {habit && (
          <section className="habit-history">
            <h3>Histórico</h3>
            <p className="muted">
              Consulte e corrija um registro. A lista mostra os 30 dias até a data escolhida.
            </p>
            <form
              className="habit-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action((r) => r.record(habit.id, historyDate, Number(historyValue)), false);
              }}
            >
              <label>
                Data do registro
                <input
                  type="date"
                  min={habit.start_date}
                  max={day}
                  value={historyDate}
                  onChange={(e) => setHistoryDate(e.target.value)}
                  required
                />
              </label>
              <label>
                Valor
                {habit.kind === 'boolean' ? (
                  <select value={historyValue} onChange={(e) => setHistoryValue(e.target.value)}>
                    <option value="0">Não feito</option>
                    <option value="1">Feito</option>
                  </select>
                ) : (
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={historyValue}
                    onChange={(e) => setHistoryValue(e.target.value)}
                    required
                  />
                )}
              </label>
              <button className="secondary-button" disabled={busy}>
                Salvar registro
              </button>
            </form>
            <ul className="habit-history-list">
              {history.map((e) => (
                <li key={e.entry_date}>
                  {e.entry_date.split('-').reverse().join('/')}{' '}
                  <span>
                    {habit.kind === 'boolean'
                      ? e.value
                        ? 'Feito'
                        : 'Não feito'
                      : `${e.value} ${habit.unit}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <footer className="drawer-footer">
        {habit &&
          (confirmArchive ? (
            <>
              <span>Arquivar hábito?</span>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => void action((r) => r.archive(habit.id))}
              >
                Confirmar
              </button>
              <button onClick={() => setConfirmArchive(false)}>Cancelar</button>
            </>
          ) : (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setConfirmArchive(true)}
            >
              Arquivar
            </button>
          ))}
        <button form="habit-form" className="primary-button" disabled={busy}>
          Salvar hábito
        </button>
      </footer>
    </Dialog>
  );
}
