import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { getDatabase } from '../../lib/database/connection';
import { localDate } from '../../lib/dates';
import type { RumoStore } from '../../hooks/useRumo';
import { EnergyRepository } from '../energy/repository';
import { BodyProgressRepository } from '../body-progress/repository';
import { FinanceRepository } from '../finance/repository';
import { ObjectivesRepository, emptyObjectiveDraft } from '../objectives/repository';
import { TimelineRepository } from '../timeline/repository';
import { parseQuickAdd, type QuickMode } from './parser';
import { PlannerRepository, defaultBlock } from '../calendar/planner-repository';
import { MilestonesRepository, emptyMilestone } from '../objectives/milestones-repository';

type AccountOption = { id: string; name: string };
const labels: Record<QuickMode, string> = {
  auto: 'Automático',
  block: 'Time Block',
  milestone: 'Marco',
  task: 'Tarefa',
  thought: 'Pensamento',
  steps: 'Passos',
  weight: 'Peso',
  finance: 'Finança',
  objective: 'Objetivo',
  moment: 'Momento',
  inbox: 'Inbox',
};
export function QuickAdd({ store, onClose }: { store: RumoStore; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<QuickMode>('auto');
  const [account, setAccount] = useState('');
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [transactionType, setTransactionType] = useState<'income' | 'expense'>('expense');
  const [error, setError] = useState('');
  const [createBlock, setCreateBlock] = useState(true);
  const [objectives, setObjectives] = useState<{ id: string; name: string }[]>([]);
  const [objective, setObjective] = useState('');
  const suggestion = useMemo(() => parseQuickAdd(input, mode, localDate()), [input, mode]);
  useEffect(() => {
    if (suggestion.kind !== 'milestone') return;
    let active = true;
    void getDatabase()
      .then((db) =>
        db.select<{ id: string; name: string }[]>(
          "SELECT id,name FROM objectives WHERE status IN('active','paused') ORDER BY name",
        ),
      )
      .then((rows) => {
        if (active) setObjectives(rows);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os objetivos.');
      });
    return () => {
      active = false;
    };
  }, [suggestion.kind]);
  useEffect(() => {
    if (suggestion.kind !== 'finance') return;
    let active = true;
    void getDatabase()
      .then((db) => new FinanceRepository(db).accounts())
      .then((rows) => {
        if (active) {
          setAccounts(rows);
          setAccount((current) => current || rows[0]?.id || '');
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar as contas.');
      });
    return () => {
      active = false;
    };
  }, [suggestion.kind]);
  async function submit() {
    if (!input.trim() || store.busy) return;
    setError('');
    const message: Record<typeof suggestion.kind, string> = {
      task: 'Tarefa criada.',
      block: 'Time Block criado.',
      milestone: 'Marco criado.',
      thought: 'Pensamento salvo.',
      steps: 'Passos registrados.',
      weight: 'Peso registrado.',
      finance: 'Transação registrada.',
      objective: 'Objetivo criado.',
      moment: 'Momento registrado.',
      inbox: 'Guardado no Inbox.',
    };
    if (suggestion.kind === 'finance' && !account) {
      setError('Escolha uma conta antes de confirmar a transação.');
      return;
    }
    if (suggestion.kind === 'milestone' && !objective) {
      setError('Selecione o objetivo deste marco antes de confirmar.');
      return;
    }
    const ok = await store.run(async (repo) => {
      const db = await getDatabase();
      switch (suggestion.kind) {
        case 'milestone':
          await new MilestonesRepository(db).save(objective, {
            ...emptyMilestone(),
            title: suggestion.title,
          });
          break;
        case 'task':
          if (createBlock && suggestion.endTime && suggestion.date && suggestion.time) {
            await new PlannerRepository(db).createTaskBlock(
              suggestion.title,
              suggestion.date,
              suggestion.time,
              suggestion.endTime,
            );
            break;
          }
          await repo.createTask({
            title: suggestion.title,
            description: '',
            priority: 'normal',
            due_date: suggestion.date,
            due_time: suggestion.time,
            recurrence: null,
          });
          break;
        case 'block':
          await new PlannerRepository(db).save({
            ...defaultBlock(suggestion.date, suggestion.time),
            title: suggestion.title,
            end_time: suggestion.endTime,
          });
          break;
        case 'thought': {
          const now = new Date().toISOString();
          await db.execute(
            'INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
            [crypto.randomUUID(), suggestion.content.slice(0, 80), suggestion.content, now],
          );
          break;
        }
        case 'steps': {
          const activity = new EnergyRepository(db);
          const previous = await activity.activityEntry(suggestion.date);
          await activity.activity(
            suggestion.date,
            suggestion.value,
            previous?.notes ?? '',
            previous?.workout_steps ?? 0,
          );
          break;
        }
        case 'weight':
          await new BodyProgressRepository(db).saveWeight(suggestion.date, suggestion.value);
          break;
        case 'finance':
          await new FinanceRepository(db).saveTransaction({
            account_id: account,
            date: localDate(),
            amount_cents: suggestion.cents,
            transaction_type: transactionType,
            description: suggestion.description,
          });
          break;
        case 'objective':
          await new ObjectivesRepository(db).create({
            ...emptyObjectiveDraft(),
            name: suggestion.name,
          });
          break;
        case 'moment':
          await new TimelineRepository(db).saveNote(suggestion.date, suggestion.title, '');
          break;
        case 'inbox':
          await repo.createInbox(suggestion.content);
          break;
      }
    }, message[suggestion.kind]);
    if (ok) onClose();
  }
  return (
    <Dialog
      title="Adicionar ao RUMAR"
      onClose={onClose}
      busy={store.busy}
      error={error || (store.notice?.error ? store.notice.message : undefined)}
    >
      <form
        className="dialog-content"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="quick-add-input">O que você quer registrar?</label>
        <input
          id="quick-add-input"
          autoFocus
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Comprar ração amanhã, 9230 passos, peso 90,8…"
        />
        <label htmlFor="quick-add-mode">Tipo</label>
        <select
          id="quick-add-mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as QuickMode)}
        >
          {Object.entries(labels).map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
        <div className="quick-suggestion" aria-live="polite">
          {suggestion.kind === 'block' ? (
            <p>
              <strong>Time Block</strong> · {suggestion.title} · {suggestion.date} ·{' '}
              {suggestion.time}–{suggestion.endTime}
            </p>
          ) : suggestion.kind === 'task' ? (
            <p>
              <strong>Tarefa</strong> · {suggestion.title}
              {suggestion.date ? ` · ${suggestion.date}` : ''}
              {suggestion.time ? ` às ${suggestion.time}` : ''}
            </p>
          ) : suggestion.kind === 'steps' ? (
            <p>
              <strong>Atividade</strong> · {suggestion.value.toLocaleString('pt-BR')} passos hoje
            </p>
          ) : suggestion.kind === 'weight' ? (
            <p>
              <strong>Progresso corporal</strong> · {suggestion.value.toLocaleString('pt-BR')} kg
              hoje
            </p>
          ) : suggestion.kind === 'thought' ? (
            <p>
              <strong>Pensamento</strong> · {suggestion.content}
            </p>
          ) : suggestion.kind === 'finance' ? (
            <p>
              <strong>Transação · confirme antes de salvar</strong> · {suggestion.description} ·{' '}
              {(suggestion.cents / 100).toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}
            </p>
          ) : suggestion.kind === 'milestone' ? (
            <p>
              <strong>Marco</strong> · {suggestion.title} · selecione um objetivo
            </p>
          ) : suggestion.kind === 'objective' ? (
            <p>
              <strong>Objetivo</strong> · {suggestion.name}
            </p>
          ) : suggestion.kind === 'moment' ? (
            <p>
              <strong>Momento</strong> · {suggestion.title} · Hoje
            </p>
          ) : (
            <p>
              <strong>Inbox</strong> · classificação depois, sem perder a captura.
            </p>
          )}
        </div>
        {suggestion.kind === 'task' && suggestion.endTime && (
          <label>
            <input
              type="checkbox"
              checked={createBlock}
              onChange={(e) => setCreateBlock(e.target.checked)}
            />{' '}
            Criar Time Block de {suggestion.time} a {suggestion.endTime} (planejamento separado do
            prazo)
          </label>
        )}
        {suggestion.kind === 'finance' && (
          <>
            <label htmlFor="quick-finance-kind">Tipo da transação</label>
            <select
              id="quick-finance-kind"
              value={transactionType}
              onChange={(event) => setTransactionType(event.target.value as 'income' | 'expense')}
            >
              <option value="expense">Despesa</option>
              <option value="income">Receita</option>
            </select>
            <label htmlFor="quick-finance-account">Conta</label>
            <select
              id="quick-finance-account"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
            >
              <option value="">Selecione uma conta</option>
              {accounts.map((row) => (
                <option value={row.id} key={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </>
        )}
        {suggestion.kind === 'milestone' && (
          <>
            <label htmlFor="quick-milestone-objective">Objetivo</label>
            <select
              id="quick-milestone-objective"
              required
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            >
              <option value="">Selecione um objetivo</option>
              {objectives.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {!objectives.length && (
              <p className="field-help">
                Crie um objetivo para associar o marco ou escolha Inbox para guardar a captura.
              </p>
            )}
          </>
        )}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={!input.trim() || store.busy}>
            Confirmar
          </button>
        </div>
        <p className="input-hint">Ctrl + Espaço abre a captura. Ctrl + K continua buscando.</p>
      </form>
    </Dialog>
  );
}
