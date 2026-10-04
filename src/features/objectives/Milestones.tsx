import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { Dialog } from '../../components/Dialog';
import {
  emptyMilestone,
  MilestonesRepository,
  parseMilestoneValue,
  type Milestone,
  type MilestoneDraft,
} from './milestones-repository';

export function Milestones({
  objectiveId,
  onChanged,
}: {
  objectiveId: string;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<Milestone[]>([]),
    [draft, setDraft] = useState<MilestoneDraft | null>(null),
    [editing, setEditing] = useState<string>(),
    [goals, setGoals] = useState<{ id: string; name: string }[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setRows(await new MilestonesRepository(await getDatabase()).list(objectiveId));
  }
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => ({
        rows: await new MilestonesRepository(db).list(objectiveId),
        goals: await db.select<{ id: string; name: string }[]>(
          'SELECT id,name FROM finance_goals WHERE archived_at IS NULL ORDER BY name',
        ),
      }))
      .then((data) => {
        if (active) {
          setRows(data.rows);
          setGoals(data.goals);
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os marcos.');
      });
    return () => {
      active = false;
    };
  }, [objectiveId]);
  async function mutate(action: (repo: MilestonesRepository) => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await action(new MilestonesRepository(await getDatabase()));
      await refresh();
      setError('');
      onChanged?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar o marco.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="review-section">
      <div className="section-heading">
        <h2>Marcos</h2>
        <button
          className="secondary-button"
          onClick={() => {
            setEditing(undefined);
            setDraft(emptyMilestone());
          }}
        >
          + Novo marco
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!rows.length ? (
        <p className="field-help">Divida o objetivo em etapas quando fizer sentido.</p>
      ) : (
        <>
          <p className="field-help">
            {rows.filter((m) => m.effective_status === 'completed').length} de {rows.length}{' '}
            concluídos. O objetivo permanece sob seu controle.
          </p>
          <ol className="milestone-list">
            {rows.map((m, index) => (
              <li
                key={m.id}
                draggable={!busy}
                onDragStart={(e) => e.dataTransfer.setData('application/rumo-milestone', m.id)}
                onDragOver={(e) => {
                  if (!busy) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('application/rumo-milestone');
                  if (id && id !== m.id) void mutate((repo) => repo.place(id, m.id));
                }}
              >
                <div className="review-line">
                  <label>
                    <input
                      type="checkbox"
                      checked={m.effective_status === 'completed'}
                      disabled={busy || m.mode !== 'manual'}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        void mutate((repo) => repo.complete(m.id, checked));
                      }}
                    />{' '}
                    {m.title}
                  </label>
                  <span>
                    {m.target_date?.split('-').reverse().join('/')}
                    {m.mode === 'financial_goal' ? ' · Derivado da meta financeira' : ''}
                  </span>
                </div>
                {m.description && <p className="field-help">{m.description}</p>}
                <div className="review-actions">
                  <button
                    className="secondary-button"
                    disabled={busy || index === 0}
                    aria-label={`Mover ${m.title} para cima`}
                    onClick={() => void mutate((repo) => repo.move(m.id, -1))}
                  >
                    ↑
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || index === rows.length - 1}
                    aria-label={`Mover ${m.title} para baixo`}
                    onClick={() => void mutate((repo) => repo.move(m.id, 1))}
                  >
                    ↓
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || m.hidden}
                    onClick={() => {
                      setEditing(m.id);
                      setDraft({ ...m });
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Excluir apenas este marco? O objetivo será preservado.'))
                        void mutate((repo) => repo.remove(m.id));
                    }}
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {draft && (
        <Dialog
          title={editing ? 'Editar marco' : 'Novo marco'}
          onClose={() => setDraft(null)}
          busy={busy}
          error={error}
        >
          <form
            className="dialog-content"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate((repo) => repo.save(objectiveId, draft, editing)).then((ok) => {
                if (ok) setDraft(null);
              });
            }}
          >
            <label htmlFor="milestone-title">Título</label>
            <input
              id="milestone-title"
              autoFocus
              maxLength={160}
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <label htmlFor="milestone-description">Descrição opcional</label>
            <textarea
              id="milestone-description"
              maxLength={2000}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <label htmlFor="milestone-date">Prazo opcional</label>
            <input
              id="milestone-date"
              type="date"
              value={draft.target_date ?? ''}
              onChange={(e) => setDraft({ ...draft, target_date: e.target.value || null })}
            />
            <label htmlFor="milestone-mode">Conclusão</label>
            <select
              id="milestone-mode"
              value={draft.mode}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  mode: e.target.value as MilestoneDraft['mode'],
                  unit: e.target.value === 'financial_goal' ? 'BRL' : '',
                  financial_goal_id: null,
                })
              }
            >
              <option value="manual">Manual</option>
              <option value="financial_goal">Derivada de meta financeira</option>
            </select>
            {draft.mode === 'financial_goal' && (
              <>
                <label htmlFor="milestone-goal">Meta financeira</label>
                <select
                  id="milestone-goal"
                  required
                  value={draft.financial_goal_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, financial_goal_id: e.target.value })}
                >
                  <option value="">Selecione</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label htmlFor="milestone-value">
              {draft.mode === 'financial_goal' ? 'Valor alvo em reais' : 'Valor alvo opcional'}
            </label>
            <input
              id="milestone-value"
              inputMode="decimal"
              defaultValue={
                draft.target_value?.toLocaleString('pt-BR', {
                  useGrouping: draft.mode === 'financial_goal',
                  maximumFractionDigits: 6,
                }) ?? ''
              }
              onChange={(e) => {
                try {
                  setDraft({
                    ...draft,
                    target_value: e.target.value.trim()
                      ? parseMilestoneValue(e.target.value, draft.mode)
                      : null,
                  });
                } catch {
                  setDraft({ ...draft, target_value: NaN });
                }
              }}
            />
            {draft.mode === 'manual' && (
              <>
                <label htmlFor="milestone-unit">Unidade opcional</label>
                <input
                  id="milestone-unit"
                  maxLength={40}
                  value={draft.unit}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                />
              </>
            )}
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setDraft(null)}>
                Cancelar
              </button>
              <button className="primary-button" disabled={busy}>
                Salvar marco
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
