import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { Dialog } from '../../components/Dialog';
import { localDate } from '../../lib/dates';
import { AutomationsRepository, type Execution } from './repository';
import {
  actions,
  triggers,
  nextOccurrence,
  type AutomationRule,
  type RuleDraft,
  type TriggerType,
  type ActionType,
} from './domain';
const empty: RuleDraft = {
  name: '',
  enabled: true,
  trigger_type: 'schedule',
  trigger_config: { mode: 'weekly', weekday: 0, time: '19:00' },
  conditions: {},
  action_type: 'task',
  action_config: { title: '' },
  missed_policy: 'ignore',
};
export function AutomationsSettings() {
  const [rows, setRows] = useState<AutomationRule[]>([]),
    [draft, setDraft] = useState<RuleDraft | null>(null),
    [id, setId] = useState<string>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [logs, setLogs] = useState<Execution[] | null>(null),
    [targets, setTargets] = useState<{
      objectives: { id: string; name: string }[];
      projects: { id: string; name: string }[];
    }>({ objectives: [], projects: [] });
  async function load() {
    const db = await getDatabase();
    setRows(await new AutomationsRepository(db).list());
  }
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => {
        const [r, o, p] = await Promise.all([
          new AutomationsRepository(db).list(),
          db.select<{ id: string; name: string }[]>(
            "SELECT id,name FROM objectives WHERE deleted_at IS NULL AND lifecycle_status!='archived' ORDER BY name",
          ),
          db.select<{ id: string; name: string }[]>(
            'SELECT id,name FROM projects WHERE archived_at IS NULL ORDER BY name',
          ),
        ]);
        if (active) {
          setRows(r);
          setTargets({ objectives: o, projects: p });
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar automações.');
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: (r: AutomationsRepository) => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action(new AutomationsRepository(await getDatabase()));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section">
      <h2>Automações locais</h2>
      <p>
        Regras internas enquanto o RUMAR está aberto. Execuções perdidas são ignoradas por padrão.
        Não há serviço em segundo plano.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className="secondary-button"
        onClick={() => {
          setId(undefined);
          setDraft(structuredClone(empty));
        }}
      >
        + Nova automação
      </button>
      {!rows.length && <p>Nenhuma automação configurada.</p>}
      <ul className="automation-list">
        {rows.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <p>
                {triggers[r.trigger_type]} → {actions[r.action_type]}
              </p>
              <small>
                Última execução:{' '}
                {r.last_run_at ? new Date(r.last_run_at).toLocaleString('pt-BR') : 'nenhuma'}
                {r.trigger_type === 'schedule' &&
                  r.enabled &&
                  ` · Próxima: ${nextOccurrence(r.trigger_config) ? new Date(nextOccurrence(r.trigger_config)!).toLocaleString('pt-BR') : 'nenhuma'}`}
              </small>
            </div>
            <label>
              <input
                type="checkbox"
                checked={r.enabled}
                disabled={busy}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void run((repo) => repo.enable(r.id, checked));
                }}
              />{' '}
              Ativa
            </label>
            <div className="automation-actions">
              <button
                className="text-button"
                onClick={() => {
                  setId(r.id);
                  setDraft(structuredClone(r));
                }}
              >
                Editar
              </button>
              <button
                className="text-button"
                onClick={() => void run(async (repo) => setLogs(await repo.logs(r.id)))}
              >
                Histórico
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Excluir esta regra e seu log? As entidades criadas serão preservadas.',
                    )
                  )
                    void run((repo) => repo.remove(r.id));
                }}
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
      {draft && (
        <Dialog
          title={id ? 'Editar automação' : 'Nova automação'}
          onClose={() => setDraft(null)}
          busy={busy}
          error={error}
        >
          <form
            className="editor-form dialog-content"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async (r) => {
                await r.save(draft, id);
                setDraft(null);
              });
            }}
          >
            <label>
              Nome
              <input
                autoFocus
                required
                maxLength={160}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <h3>Quando</h3>
            <label>
              Gatilho
              <select
                value={draft.trigger_type}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    trigger_type: e.target.value as TriggerType,
                    trigger_config:
                      e.target.value === 'schedule'
                        ? { mode: 'weekly', weekday: 0, time: '19:00' }
                        : { days: 1, time: '09:00' },
                  })
                }
              >
                {Object.entries(triggers).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {draft.trigger_type === 'schedule' && (
              <>
                <label>
                  Frequência
                  <select
                    value={draft.trigger_config.mode}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        trigger_config: {
                          ...draft.trigger_config,
                          mode: e.target.value as 'daily' | 'weekly' | 'monthly' | 'once',
                          weekday: 0,
                          month_day: 1,
                          date: localDate(),
                        },
                      })
                    }
                  >
                    <option value="daily">Todo dia</option>
                    <option value="weekly">Toda semana</option>
                    <option value="monthly">Todo mês</option>
                    <option value="once">Data específica</option>
                  </select>
                </label>
                {draft.trigger_config.mode === 'weekly' && (
                  <label>
                    Dia da semana
                    <select
                      value={draft.trigger_config.weekday}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          trigger_config: {
                            ...draft.trigger_config,
                            weekday: Number(e.target.value),
                          },
                        })
                      }
                    >
                      {['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map(
                        (d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                {draft.trigger_config.mode === 'monthly' && (
                  <label>
                    Dia do mês (limitado ao último dia)
                    <input
                      type="number"
                      min={1}
                      max={31}
                      required
                      value={draft.trigger_config.month_day}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          trigger_config: {
                            ...draft.trigger_config,
                            month_day: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                )}
                {draft.trigger_config.mode === 'once' && (
                  <label>
                    Data
                    <input
                      type="date"
                      required
                      value={draft.trigger_config.date ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          trigger_config: { ...draft.trigger_config, date: e.target.value },
                        })
                      }
                    />
                  </label>
                )}
              </>
            )}
            {['schedule', 'task_due', 'task_overdue', 'objective_due', 'finance_due'].includes(
              draft.trigger_type,
            ) && (
              <>
                <label>
                  Horário
                  <input
                    required
                    type="time"
                    value={draft.trigger_config.time ?? '09:00'}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        trigger_config: { ...draft.trigger_config, time: e.target.value },
                      })
                    }
                  />
                </label>
                {draft.trigger_type !== 'schedule' && (
                  <label>
                    {draft.trigger_type === 'task_overdue'
                      ? 'Dias após vencer'
                      : 'Dias antes do prazo'}
                    <input
                      required
                      type="number"
                      min={0}
                      max={365}
                      value={draft.trigger_config.days ?? 1}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          trigger_config: { ...draft.trigger_config, days: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                )}
                <label>
                  Ao perder uma ocorrência
                  <select
                    value={draft.missed_policy}
                    onChange={(e) =>
                      setDraft({ ...draft, missed_policy: e.target.value as 'ignore' | 'latest' })
                    }
                  >
                    <option value="ignore">Ignorar ocorrência perdida</option>
                    <option value="latest">Executar somente a última pendente ao abrir</option>
                  </select>
                </label>
              </>
            )}
            <h3>Se — opcional</h3>
            <label>
              Projeto
              <select
                value={draft.conditions.project_id ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    conditions: { ...draft.conditions, project_id: e.target.value || undefined },
                  })
                }
              >
                <option value="">Qualquer projeto</option>
                {targets.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ID da origem (opcional)
              <input
                value={draft.conditions.entity_id ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    conditions: { ...draft.conditions, entity_id: e.target.value || undefined },
                  })
                }
              />
            </label>
            <label>
              Status da tarefa/objetivo
              <select
                value={draft.conditions.status ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    conditions: {
                      ...draft.conditions,
                      status: (e.target.value || undefined) as 'pending' | 'completed' | undefined,
                    },
                  })
                }
              >
                <option value="">Qualquer status</option>
                <option value="pending">Pendente</option>
                <option value="completed">Concluído</option>
              </select>
            </label>
            <h3>Então</h3>
            <label>
              Ação
              <select
                value={draft.action_type}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    action_type: e.target.value as ActionType,
                    action_config: e.target.value === 'link' ? { objective_id: '' } : { title: '' },
                  })
                }
              >
                {Object.entries(actions).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {draft.action_type !== 'link' && (
              <label>
                Título
                <input
                  required
                  maxLength={160}
                  value={draft.action_config.title ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      action_config: { ...draft.action_config, title: e.target.value },
                    })
                  }
                />
              </label>
            )}
            {['link', 'moment'].includes(draft.action_type) && (
              <label>
                Objetivo
                <select
                  required={draft.action_type === 'link'}
                  value={draft.action_config.objective_id ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      action_config: {
                        ...draft.action_config,
                        objective_id: e.target.value || undefined,
                      },
                    })
                  }
                >
                  <option value="">Selecione</option>
                  {targets.objectives.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {draft.action_type === 'notification' && (
              <p>
                Exige Notificações e a categoria Automações ativadas. A privacidade configurada
                também se aplica.
              </p>
            )}
            <p className="muted">
              Prévia: {triggers[draft.trigger_type]}
              {draft.trigger_type === 'schedule' &&
                ` · ${draft.trigger_config.mode} às ${draft.trigger_config.time}`}{' '}
              → {actions[draft.action_type]} {draft.action_config.title ?? ''}
            </p>
            <button className="primary-button" disabled={busy}>
              Salvar regra
            </button>
          </form>
        </Dialog>
      )}
      {logs && (
        <Dialog title="Histórico da automação" onClose={() => setLogs(null)}>
          {!logs.length ? (
            <p>Nenhuma execução registrada.</p>
          ) : (
            <ul className="automation-list">
              {logs.map((l) => (
                <li key={l.id}>
                  <div>
                    <strong>
                      {l.status === 'done'
                        ? 'Executada'
                        : l.status === 'ignored'
                          ? 'Ignorada'
                          : 'Falhou'}
                    </strong>
                    <p>{new Date(l.executed_at).toLocaleString('pt-BR')}</p>
                    <p>{l.reason || 'Ação interna persistida.'}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
    </section>
  );
}
