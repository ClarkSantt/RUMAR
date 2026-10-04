import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { available, money, parseMoney, projectGoal } from './domain';
import { decodeOfxBytes, fileHash, parseOfx, type OfxDocument } from './ofx';
import { FinanceRepository, type ImportPreview, type TransactionInput } from './repository';
import { Attachments } from '../attachments/Attachments';
import { FinancialConnections } from './connections/FinancialConnections';
import type {
  Account,
  Asset,
  Budget,
  Category,
  Contribution,
  Goal,
  MonthSummary,
  Plan,
  Recurring,
  Rule,
  Transaction,
  Valuation,
} from './types';
import './finance.css';

type Tab = 'overview' | 'transactions' | 'planning' | 'goals' | 'worth' | 'connections';
const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'transactions', label: 'Transações' },
  { id: 'planning', label: 'Planejamento' },
  { id: 'goals', label: 'Objetivos' },
  { id: 'worth', label: 'Patrimônio' },
  { id: 'connections', label: 'Contas conectadas' },
];
const accountTypes: Account['type'][] = [
  'checking',
  'digital',
  'savings',
  'cash',
  'investment',
  'credit_card',
  'other',
];
const accountLabels: Record<Account['type'], string> = {
  checking: 'Conta corrente',
  digital: 'Conta digital',
  savings: 'Poupança / reserva',
  cash: 'Dinheiro',
  investment: 'Investimento',
  credit_card: 'Cartão de crédito',
  other: 'Outro',
};
const blankTransaction = (date: string): TransactionInput => ({
  account_id: '',
  date,
  amount_cents: 0,
  transaction_type: 'expense',
  description: '',
  destination_account_id: null,
  category_id: null,
  notes: '',
});
interface Snapshot {
  accounts: Account[];
  allAccounts: Account[];
  categories: Category[];
  allCategories: Category[];
  rules: Rule[];
  summary: MonthSummary;
  plan: Plan | null;
  budgets: Budget[];
  recurring: Recurring[];
  goals: Goal[];
  assets: Asset[];
  worth: { account_cents: number; asset_cents: number; liability_cents: number; net_cents: number };
  spending: { category_id: string | null; name: string; cents: number }[];
  hidden: boolean;
}
function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label>
      {label}
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0,00"
      />
    </label>
  );
}
function amount(value: string) {
  return parseMoney(value);
}
function notice(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível salvar.';
}
function monthLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
    new Date(Number(value.slice(0, 4)), Number(value.slice(5)) - 1, 1),
  );
}

export function Finance({
  day,
  searchTarget,
}: {
  day: string;
  searchTarget?: { group: string; title: string; detail: string };
}) {
  const [repo, setRepo] = useState<FinanceRepository | null>(null),
    [tab, setTab] = useState<Tab>(
      searchTarget?.group === 'Transações'
        ? 'transactions'
        : searchTarget?.group === 'Objetivos financeiros'
          ? 'goals'
          : 'overview',
    ),
    [month, setMonth] = useState(
      searchTarget?.group === 'Transações' ? searchTarget.detail.slice(0, 7) : day.slice(0, 7),
    );
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [accountForm, setAccountForm] = useState({
    id: '',
    name: '',
    type: 'checking' as Account['type'],
    opening: '0,00',
  });
  const [categoryForm, setCategoryForm] = useState({
    id: '',
    name: '',
    kind: 'expense' as Category['kind'],
  });
  const [ruleForm, setRuleForm] = useState({
    id: '',
    pattern: '',
    match_type: 'contains' as Rule['match_type'],
    category_id: '',
    priority: '0',
  });
  const [transactionForm, setTransactionForm] = useState<TransactionInput & { id?: string }>(() =>
    blankTransaction(day),
  );
  const [transactionAmount, setTransactionAmount] = useState('');
  const [filters, setFilters] = useState({
    search:
      searchTarget?.group === 'Transações' && searchTarget.title !== 'Transação financeira'
        ? searchTarget.title
        : '',
    accountId: '',
    categoryId: '',
    type: '',
  });
  const [visibleRows, setVisibleRows] = useState<Transaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [rowsVersion, setRowsVersion] = useState(0);
  const [planForm, setPlanForm] = useState({ income: '', expense: '', goal: '', notes: '' });
  const [budgetForm, setBudgetForm] = useState({ category_id: '', amount: '' });
  const [recurringForm, setRecurringForm] = useState({
    id: '',
    description: '',
    account_id: '',
    category_id: '',
    transaction_type: 'expense' as 'income' | 'expense',
    amount: '',
    day_of_month: '1',
    subscription: false,
  });
  const [goalForm, setGoalForm] = useState({
    id: '',
    name: '',
    target: '',
    initial: '0,00',
    monthly: '0,00',
    rate: '0',
    target_date: '',
  });
  const [contributionForm, setContributionForm] = useState({
    goal_id: '',
    date: day,
    amount: '',
    notes: '',
  });
  const [assetForm, setAssetForm] = useState({
    id: '',
    name: '',
    kind: 'asset' as 'asset' | 'liability',
    type: 'Outro',
    notes: '',
    date: day,
    value: '',
  });
  const [importState, setImportState] = useState<{
    fileName: string;
    hash: string;
    document: OfxDocument;
    preview: ImportPreview;
  } | null>(null);
  const [importAccount, setImportAccount] = useState(''),
    [selectedPossible, setSelectedPossible] = useState<number[]>([]);
  const [history, setHistory] = useState<{ month: string; net_cents: number }[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [valuations, setValuations] = useState<Valuation[]>([]);
  useEffect(() => {
    let active = true;
    getDatabase()
      .then((db) => {
        if (active) setRepo(new FinanceRepository(db));
      })
      .catch((e) => {
        if (active) setError(notice(e));
      });
    return () => {
      active = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!repo) return;
    const [
      accounts,
      allAccounts,
      categories,
      allCategories,
      rules,
      summary,
      plan,
      budgets,
      recurring,
      goals,
      assets,
      worth,
      spending,
      hidden,
    ] = await Promise.all([
      repo.accounts(),
      repo.accounts(true),
      repo.categories(),
      repo.categories(undefined, true),
      repo.rules(),
      repo.monthSummary(month),
      repo.plan(month),
      repo.budgets(month),
      repo.recurring(false),
      repo.goals(),
      repo.assets(),
      repo.netWorth(day),
      repo.spendingByCategory(month),
      repo.hidden(),
    ]);
    setData({
      accounts,
      allAccounts,
      categories,
      allCategories,
      rules,
      summary,
      plan,
      budgets,
      recurring,
      goals,
      assets,
      worth,
      spending,
      hidden,
    });
    setPlanForm({
      income: plan ? money(plan.income_cents).replace('R$', '').trim() : '',
      expense: plan ? money(plan.expense_cents).replace('R$', '').trim() : '',
      goal: plan ? money(plan.goal_cents).replace('R$', '').trim() : '',
      notes: plan?.notes ?? '',
    });
    setRowsVersion((version) => version + 1);
  }, [repo, month, day]);
  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((e) => setError(notice(e)));
  }, [refresh]);
  useEffect(() => {
    const changed = () => void refresh().catch((e) => setError(notice(e)));
    window.addEventListener('rumo-finance-changed', changed);
    return () => window.removeEventListener('rumo-finance-changed', changed);
  }, [refresh]);
  useEffect(() => {
    if (!repo) return;
    let active = true;
    const timer = setTimeout(() => {
      void repo
        .transactions({ month, ...filters, limit: 50 })
        .then((rows) => {
          if (active) {
            setVisibleRows(rows);
            setHasMore(rows.length === 50);
          }
        })
        .catch((e) => {
          if (active) setError(notice(e));
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [repo, month, filters, rowsVersion]);
  async function loadMore() {
    if (!repo) return;
    try {
      const rows = await repo.transactions({
        month,
        ...filters,
        limit: 50,
        offset: visibleRows.length,
      });
      setVisibleRows((current) => [...current, ...rows]);
      setHasMore(rows.length === 50);
    } catch (e) {
      setError(notice(e));
    }
  }
  async function run(action: () => Promise<unknown>, success = 'Salvo.') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await refresh();
      setMessage(success);
    } catch (e) {
      setError(notice(e));
    } finally {
      setBusy(false);
    }
  }
  function f(cents: number) {
    return money(cents, data?.hidden ?? false);
  }
  const categoryNames = useMemo(
    () => new Map(data?.allCategories.map((c) => [c.id, c.name]) ?? []),
    [data?.allCategories],
  );
  const accountNames = useMemo(
    () => new Map(data?.allAccounts.map((a) => [a.id, a.name]) ?? []),
    [data?.allAccounts],
  );
  const currentGoal = data?.goals.find((g) => g.id === contributionForm.goal_id);
  const projection = currentGoal
    ? projectGoal(
        currentGoal.initial_amount_cents + (currentGoal.contributed_cents ?? 0),
        currentGoal.target_amount_cents,
        currentGoal.planned_monthly_contribution_cents,
        currentGoal.annual_return_rate,
        month,
      )
    : [];
  async function readOfx(file: File) {
    if (!repo) return;
    setError('');
    setImportState(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const document = parseOfx(decodeOfxBytes(bytes));
      const hash = await fileHash(bytes);
      if (!importAccount) throw Error('Selecione a conta antes de importar.');
      setImportState({
        fileName: file.name,
        hash,
        document,
        preview: await repo.previewOfx(importAccount, hash, document),
      });
      setSelectedPossible([]);
    } catch (e) {
      setError('Não foi possível importar este arquivo. ' + notice(e));
    }
  }
  const inputAccount = data?.accounts[0]?.id ?? '';
  if (!data)
    return (
      <div className="startup-state" role={error ? 'alert' : 'status'}>
        {error || 'Abrindo Finanças…'}
      </div>
    );
  return (
    <div className="finance-page">
      <header className="page-header">
        <p className="eyebrow">VIDA · REGISTROS LOCAIS</p>
        <h1>Finanças</h1>
        <p>Seu dinheiro, organizado com clareza.</p>
      </header>
      <div className="finance-toolbar">
        <nav className="nutrition-tabs" aria-label="Seções de Finanças">
          {tabs.map((t) => (
            <button
              key={t.id}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button
          className="text-button"
          onClick={() =>
            void run(
              () => repo!.setHidden(!data.hidden),
              data.hidden ? 'Valores visíveis.' : 'Valores ocultos.',
            )
          }
        >
          {data.hidden ? 'Mostrar valores' : 'Ocultar valores'}
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="field-help">
          {message}
        </p>
      )}
      {tab === 'connections' && <FinancialConnections />}
      {tab === 'overview' && (
        <>
          <div className="finance-section-heading">
            <h2>{monthLabel(month)}</h2>
            <label>
              Mês{' '}
              <input
                aria-label="Mês da visão geral"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
          </div>
          <div className="finance-metrics">
            <article className="finance-metric finance-primary">
              <span>Disponível este mês</span>
              <strong>{f(data.summary.available_cents)}</strong>
              <small>Receitas − despesas − aportes realizados</small>
            </article>
            <article className="finance-metric">
              <span>Receitas</span>
              <strong>{f(data.summary.income_cents)}</strong>
            </article>
            <article className="finance-metric">
              <span>Despesas</span>
              <strong>{f(data.summary.expense_cents)}</strong>
            </article>
            <article className="finance-metric">
              <span>Reservado para objetivos</span>
              <strong>{f(data.summary.reserved_cents)}</strong>
            </article>
          </div>
          <div className="finance-grid">
            <section className="finance-panel">
              <h2>Planejado e realizado</h2>
              <dl className="finance-facts">
                <div>
                  <dt>Receita planejada</dt>
                  <dd>{f(data.summary.planned_income_cents)}</dd>
                </div>
                <div>
                  <dt>Receita realizada</dt>
                  <dd>{f(data.summary.income_cents)}</dd>
                </div>
                <div>
                  <dt>Despesas planejadas</dt>
                  <dd>{f(data.summary.planned_expense_cents)}</dd>
                </div>
                <div>
                  <dt>Despesas realizadas</dt>
                  <dd>{f(data.summary.expense_cents)}</dd>
                </div>
                <div>
                  <dt>Disponível planejado</dt>
                  <dd>{f(data.summary.planned_available_cents)}</dd>
                </div>
              </dl>
            </section>
            <section className="finance-panel">
              <h2>Gastos por categoria</h2>
              {data.spending.length ? (
                <div className="finance-bars">
                  {data.spending.map((row) => (
                    <div key={row.category_id ?? 'none'}>
                      <span>{row.name}</span>
                      <div className="finance-bar">
                        <i
                          style={{
                            width: `${Math.min(100, (row.cents / Math.max(1, data.summary.expense_cents)) * 100)}%`,
                          }}
                        />
                      </div>
                      <strong>{f(row.cents)}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="field-help">Nenhuma despesa registrada neste mês.</p>
              )}
            </section>
          </div>
          <div className="finance-grid">
            <section className="finance-panel">
              <h2>Contas</h2>
              {data.accounts.length ? (
                <ul className="finance-list">
                  {data.accounts.map((a) => (
                    <li key={a.id}>
                      <span>
                        {a.name}
                        <small>{accountLabels[a.type]}</small>
                      </span>
                      <strong>{f(a.balance_cents ?? 0)}</strong>
                      <button
                        className="text-button"
                        onClick={() =>
                          setAccountForm({
                            id: a.id,
                            name: a.name,
                            type: a.type,
                            opening: money(a.opening_balance_cents).replace('R$', '').trim(),
                          })
                        }
                      >
                        Editar
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          void run(() => repo!.archiveAccount(a.id), 'Conta arquivada.')
                        }
                      >
                        Arquivar
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="field-help">Crie uma conta para começar.</p>
              )}
              <form
                className="finance-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await repo!.saveAccount(
                      {
                        name: accountForm.name,
                        type: accountForm.type,
                        opening_balance_cents: accountForm.opening.startsWith('-')
                          ? -amount(accountForm.opening.slice(1))
                          : amount(accountForm.opening),
                      },
                      accountForm.id || undefined,
                    );
                    setAccountForm({ id: '', name: '', type: 'checking', opening: '0,00' });
                  }, 'Conta salva.');
                }}
              >
                <h3>{accountForm.id ? 'Editar conta' : 'Nova conta'}</h3>
                <label>
                  Nome
                  <input
                    required
                    value={accountForm.name}
                    onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                  />
                </label>
                <label>
                  Tipo
                  <select
                    value={accountForm.type}
                    onChange={(e) =>
                      setAccountForm({ ...accountForm, type: e.target.value as Account['type'] })
                    }
                  >
                    {accountTypes.map((type) => (
                      <option key={type} value={type}>
                        {accountLabels[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <MoneyField
                  label="Saldo inicial (use - para dívida do cartão)"
                  value={accountForm.opening}
                  onChange={(opening) => setAccountForm({ ...accountForm, opening })}
                />
                <button className="primary-button" disabled={busy}>
                  Salvar conta
                </button>
                {accountForm.id && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setAccountForm({ id: '', name: '', type: 'checking', opening: '0,00' })
                    }
                  >
                    Cancelar edição
                  </button>
                )}
              </form>
            </section>
            <section className="finance-panel">
              <h2>Próximos previstos</h2>
              {data.recurring.some((r) => r.active) ? (
                <ul className="finance-list">
                  {data.recurring
                    .filter((r) => r.active)
                    .slice(0, 8)
                    .map((r) => (
                      <li key={r.id}>
                        <span>
                          {r.description}
                          <small>
                            Dia {r.day_of_month} · {r.subscription ? 'Assinatura' : 'Recorrência'}
                          </small>
                        </span>
                        <strong>{f(r.amount_cents)}</strong>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="field-help">Sem recorrências configuradas.</p>
              )}
              <button className="text-button" onClick={() => setTab('planning')}>
                Abrir planejamento →
              </button>
            </section>
          </div>
        </>
      )}
      {tab === 'transactions' && (
        <>
          <div className="finance-section-heading">
            <h2>Transações</h2>
            <label>
              Mês
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          </div>
          <div className="finance-filters">
            <label>
              Buscar
              <input
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder="Descrição"
              />
            </label>
            <label>
              Conta
              <select
                value={filters.accountId}
                onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}
              >
                <option value="">Todas</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Categoria
              <select
                value={filters.categoryId}
                onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
              >
                <option value="">Todas</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              >
                <option value="">Todos</option>
                <option value="income">Receita</option>
                <option value="expense">Despesa</option>
                <option value="transfer">Transferência</option>
              </select>
            </label>
          </div>
          <div className="finance-grid">
            <section className="finance-panel">
              <h3>Movimentações</h3>
              {visibleRows.length ? (
                <ul className="finance-list">
                  {visibleRows.map((t) => (
                    <li key={t.id}>
                      <span>
                        {t.description}
                        <small>
                          {t.date} ·{' '}
                          {t.transaction_type === 'transfer'
                            ? `${accountNames.get(t.account_id)} → ${accountNames.get(t.destination_account_id ?? '')}`
                            : (categoryNames.get(t.category_id ?? '') ?? 'Sem categoria')}
                          {t.external_id?.startsWith('of:') ? ' · Open Finance' : ''}
                        </small>
                      </span>
                      <strong>
                        {t.transaction_type === 'income'
                          ? '+'
                          : t.transaction_type === 'expense'
                            ? '−'
                            : '↔'}{' '}
                        {f(t.amount_cents)}
                      </strong>
                      <button
                        className="text-button"
                        onClick={() => {
                          setTransactionForm({ ...t });
                          setTransactionAmount(money(t.amount_cents).replace('R$', '').trim());
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          if (confirm('Excluir esta transação?'))
                            void run(() => repo!.deleteTransaction(t.id), 'Transação excluída.');
                        }}
                      >
                        Excluir
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="field-help">Nenhuma transação neste filtro.</p>
              )}
              {hasMore && (
                <button className="text-button" onClick={() => void loadMore()}>
                  Carregar mais transações
                </button>
              )}
              <p className="field-help">
                Busca e filtros consultam este mês no banco; a lista carrega em páginas de 50.
              </p>
            </section>
            <section className="finance-panel">
              <h3>{transactionForm.id ? 'Editar transação' : 'Nova transação'}</h3>
              <form
                className="finance-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await repo!.saveTransaction(
                      {
                        ...transactionForm,
                        account_id: transactionForm.account_id || inputAccount,
                        amount_cents: amount(transactionAmount),
                      },
                      transactionForm.id,
                    );
                    setTransactionForm(blankTransaction(day));
                    setTransactionAmount('');
                  }, 'Transação salva.');
                }}
              >
                <label>
                  Tipo
                  <select
                    value={transactionForm.transaction_type}
                    onChange={(e) =>
                      setTransactionForm({
                        ...transactionForm,
                        transaction_type: e.target.value as Transaction['transaction_type'],
                        category_id: null,
                        destination_account_id: null,
                      })
                    }
                  >
                    <option value="expense">Despesa</option>
                    <option value="income">Receita</option>
                    <option value="transfer">Transferência</option>
                  </select>
                </label>
                <label>
                  Data
                  <input
                    type="date"
                    required
                    value={transactionForm.date}
                    onChange={(e) =>
                      setTransactionForm({ ...transactionForm, date: e.target.value })
                    }
                  />
                </label>
                <label>
                  Conta de origem
                  <select
                    required
                    value={transactionForm.account_id || inputAccount}
                    onChange={(e) =>
                      setTransactionForm({ ...transactionForm, account_id: e.target.value })
                    }
                  >
                    {data.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                {transactionForm.transaction_type === 'transfer' && (
                  <label>
                    Conta de destino
                    <select
                      required
                      value={transactionForm.destination_account_id ?? ''}
                      onChange={(e) =>
                        setTransactionForm({
                          ...transactionForm,
                          destination_account_id: e.target.value,
                        })
                      }
                    >
                      <option value="">Selecione</option>
                      {data.accounts
                        .filter((a) => a.id !== (transactionForm.account_id || inputAccount))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  Descrição
                  <input
                    required
                    value={transactionForm.description}
                    onChange={(e) =>
                      setTransactionForm({ ...transactionForm, description: e.target.value })
                    }
                  />
                </label>
                <MoneyField
                  label="Valor em R$"
                  value={transactionAmount}
                  onChange={setTransactionAmount}
                />
                {transactionForm.transaction_type !== 'transfer' && (
                  <label>
                    Categoria
                    <select
                      value={transactionForm.category_id ?? ''}
                      onChange={(e) =>
                        setTransactionForm({
                          ...transactionForm,
                          category_id: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Aplicar regra ou sem categoria</option>
                      {data.categories
                        .filter((c) => c.kind === transactionForm.transaction_type)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  Observações
                  <input
                    value={transactionForm.notes ?? ''}
                    onChange={(e) =>
                      setTransactionForm({ ...transactionForm, notes: e.target.value })
                    }
                  />
                </label>
                <button className="primary-button" disabled={busy || !data.accounts.length}>
                  Salvar transação
                </button>
                {transactionForm.id && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setTransactionForm(blankTransaction(day));
                      setTransactionAmount('');
                    }}
                  >
                    Cancelar edição
                  </button>
                )}
              </form>
              {transactionForm.id && (
                <Attachments entityType="finance_transaction" entityId={transactionForm.id} />
              )}
            </section>
          </div>
          <div className="finance-grid">
            <section className="finance-panel">
              <h2>Importar OFX</h2>
              <p className="field-help">
                O arquivo é lido neste computador. Confira a prévia antes de gravar.
              </p>
              <label>
                Conta
                <select
                  value={importAccount}
                  onChange={(e) => {
                    setImportAccount(e.target.value);
                    setImportState(null);
                  }}
                >
                  <option value="">Selecione</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Arquivo .ofx
                <input
                  type="file"
                  accept=".ofx,application/x-ofx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void readOfx(file);
                  }}
                />
              </label>
              {importState && (
                <div className="finance-import-preview">
                  <h3>Prévia · {importState.fileName}</h3>
                  <p>
                    {importState.document.rows.length} transações ·{' '}
                    {importState.preview.rows.filter((r) => r.status === 'new').length} novas ·{' '}
                    {importState.preview.rows.filter((r) => r.status === 'duplicate').length}{' '}
                    duplicadas ·{' '}
                    {importState.preview.rows.filter((r) => r.status === 'possible').length}{' '}
                    possíveis duplicatas
                  </p>
                  <p>
                    Receitas novas: {f(importState.preview.income_cents)} · Despesas novas:{' '}
                    {f(importState.preview.expense_cents)}
                  </p>
                  {importState.preview.account && (
                    <p>Conta no arquivo: {importState.preview.account}</p>
                  )}
                  {importState.preview.duplicateFile ? (
                    <p role="status">
                      Este arquivo já foi importado. Lote {importState.preview.existingBatchId}.
                    </p>
                  ) : (
                    <>
                      <div className="finance-preview-rows">
                        {importState.preview.rows.slice(0, 150).map((row) => (
                          <label key={row.index}>
                            <span>
                              {row.date} · {row.description} · {f(row.amount_cents)}
                            </span>
                            <small>
                              {row.status === 'new'
                                ? 'Nova'
                                : row.status === 'duplicate'
                                  ? 'Duplicada por FITID/arquivo'
                                  : 'Possível duplicata'}
                            </small>
                            {row.status === 'possible' && (
                              <input
                                type="checkbox"
                                checked={selectedPossible.includes(row.index)}
                                onChange={(e) =>
                                  setSelectedPossible(
                                    e.target.checked
                                      ? [...selectedPossible, row.index]
                                      : selectedPossible.filter((i) => i !== row.index),
                                  )
                                }
                                aria-label={`Importar possível duplicata ${row.index + 1}`}
                              />
                            )}
                          </label>
                        ))}
                      </div>
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await repo!.importOfx(
                              importAccount,
                              importState.fileName,
                              importState.hash,
                              importState.document,
                              selectedPossible,
                            );
                            setImportState(null);
                          }, 'Arquivo importado.')
                        }
                      >
                        Importar confirmadas
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
            <section className="finance-panel">
              <h2>Categorias e regras</h2>
              <ul className="finance-list">
                {data.categories.map((c) => (
                  <li key={c.id}>
                    <span>
                      {c.name}
                      <small>{c.kind === 'income' ? 'Receita' : 'Despesa'}</small>
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setCategoryForm({ id: c.id, name: c.name, kind: c.kind })}
                    >
                      Editar
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        void run(() => repo!.archiveCategory(c.id), 'Categoria arquivada.')
                      }
                    >
                      Arquivar
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="finance-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await repo!.saveCategory(categoryForm, categoryForm.id || undefined);
                    setCategoryForm({ id: '', name: '', kind: 'expense' });
                  });
                }}
              >
                <h3>{categoryForm.id ? 'Editar categoria' : 'Nova categoria'}</h3>
                <label>
                  Nome
                  <input
                    required
                    value={categoryForm.name}
                    onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  />
                </label>
                <label>
                  Tipo
                  <select
                    value={categoryForm.kind}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, kind: e.target.value as Category['kind'] })
                    }
                  >
                    <option value="expense">Despesa</option>
                    <option value="income">Receita</option>
                  </select>
                </label>
                <button className="primary-button" disabled={busy}>
                  Salvar categoria
                </button>
              </form>
              <h3>Regras automáticas</h3>
              <ul className="finance-list">
                {data.rules.map((r) => (
                  <li key={r.id}>
                    <span>
                      {r.match_type === 'contains' ? 'Contém' : 'Exato'}: {r.pattern}
                      <small>→ {categoryNames.get(r.category_id)}</small>
                    </span>
                    <button
                      className="text-button"
                      onClick={() =>
                        setRuleForm({
                          id: r.id,
                          pattern: r.pattern,
                          match_type: r.match_type,
                          category_id: r.category_id,
                          priority: String(r.priority),
                        })
                      }
                    >
                      Editar
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        void run(
                          () => repo!.saveRule({ ...r, active: r.active ? 0 : 1 }, r.id),
                          r.active ? 'Regra pausada.' : 'Regra ativada.',
                        )
                      }
                    >
                      {r.active ? 'Pausar' : 'Ativar'}
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="finance-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await repo!.saveRule(
                      {
                        ...ruleForm,
                        priority: Number(ruleForm.priority),
                        active: 1,
                      },
                      ruleForm.id || undefined,
                    );
                    setRuleForm({
                      id: '',
                      pattern: '',
                      match_type: 'contains',
                      category_id: '',
                      priority: '0',
                    });
                  }, 'Regra salva.');
                }}
              >
                <label>
                  Padrão
                  <input
                    required
                    value={ruleForm.pattern}
                    onChange={(e) => setRuleForm({ ...ruleForm, pattern: e.target.value })}
                    placeholder="IFOOD"
                  />
                </label>
                <label>
                  Correspondência
                  <select
                    value={ruleForm.match_type}
                    onChange={(e) =>
                      setRuleForm({ ...ruleForm, match_type: e.target.value as Rule['match_type'] })
                    }
                  >
                    <option value="contains">Contém</option>
                    <option value="exact">Exata</option>
                  </select>
                </label>
                <label>
                  Categoria
                  <select
                    required
                    value={ruleForm.category_id}
                    onChange={(e) => setRuleForm({ ...ruleForm, category_id: e.target.value })}
                  >
                    <option value="">Selecione</option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Prioridade
                  <input
                    type="number"
                    value={ruleForm.priority}
                    onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })}
                  />
                </label>
                <button className="primary-button" disabled={busy}>
                  {ruleForm.id ? 'Salvar regra' : 'Criar regra'}
                </button>
              </form>
            </section>
          </div>
        </>
      )}
      {tab === 'planning' && (
        <>
          <div className="finance-section-heading">
            <h2>Planejamento de {monthLabel(month)}</h2>
            <label>
              Mês
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          </div>
          <div className="finance-grid">
            <section className="finance-panel">
              <h3>Plano mensal</h3>
              <form
                className="finance-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      repo!.savePlan({
                        month,
                        income_cents: amount(planForm.income || '0'),
                        expense_cents: amount(planForm.expense || '0'),
                        goal_cents: amount(planForm.goal || '0'),
                        notes: planForm.notes,
                      }),
                    'Plano salvo.',
                  );
                }}
              >
                <MoneyField
                  label="Receita prevista"
                  value={planForm.income}
                  onChange={(income) => setPlanForm({ ...planForm, income })}
                />
                <MoneyField
                  label="Despesas previstas"
                  value={planForm.expense}
                  onChange={(expense) => setPlanForm({ ...planForm, expense })}
                />
                <MoneyField
                  label="Aportes planejados"
                  value={planForm.goal}
                  onChange={(goal) => setPlanForm({ ...planForm, goal })}
                />
                <label>
                  Observações
                  <textarea
                    value={planForm.notes}
                    onChange={(e) => setPlanForm({ ...planForm, notes: e.target.value })}
                  />
                </label>
                <strong>
                  Disponível planejado:{' '}
                  {f(
                    available(
                      amount(planForm.income || '0'),
                      amount(planForm.expense || '0'),
                      amount(planForm.goal || '0'),
                    ),
                  )}
                </strong>
                <button className="primary-button" disabled={busy}>
                  Salvar plano
                </button>
              </form>
            </section>
            <section className="finance-panel">
              <h3>Orçamento por categoria</h3>
              <ul className="finance-list">
                {data.budgets.map((b) => (
                  <li key={b.category_id}>
                    <span>
                      {categoryNames.get(b.category_id)}
                      <small>
                        Realizado {f(b.realized_cents ?? 0)} de {f(b.amount_cents)}
                      </small>
                    </span>
                    <progress
                      max={b.amount_cents || 1}
                      value={Math.min(b.realized_cents ?? 0, b.amount_cents || 1)}
                    />
                    <button
                      className="text-button"
                      onClick={() =>
                        void run(
                          () => repo!.deleteBudget(month, b.category_id),
                          'Orçamento removido.',
                        )
                      }
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="finance-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await repo!.saveBudget(
                      month,
                      budgetForm.category_id,
                      amount(budgetForm.amount),
                    );
                    setBudgetForm({ category_id: '', amount: '' });
                  }, 'Orçamento salvo.');
                }}
              >
                <label>
                  Categoria
                  <select
                    required
                    value={budgetForm.category_id}
                    onChange={(e) => setBudgetForm({ ...budgetForm, category_id: e.target.value })}
                  >
                    <option value="">Selecione</option>
                    {data.categories
                      .filter((c) => c.kind === 'expense')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <MoneyField
                  label="Valor planejado"
                  value={budgetForm.amount}
                  onChange={(value) => setBudgetForm({ ...budgetForm, amount: value })}
                />
                <button className="primary-button" disabled={busy}>
                  Salvar orçamento
                </button>
              </form>
            </section>
          </div>
          <section className="finance-panel">
            <h2>Recorrências e assinaturas</h2>
            <p className="field-help">
              São previsões. Uma transação realizada só nasce quando você a registra.
            </p>
            <ul className="finance-list">
              {data.recurring.map((r) => (
                <li key={r.id}>
                  <span>
                    {r.description}
                    <small>
                      Dia {r.day_of_month} · {r.subscription ? 'Assinatura' : 'Recorrência'} ·{' '}
                      {r.transaction_type === 'income' ? 'Receita' : 'Despesa'}
                    </small>
                  </span>
                  <strong>{f(r.amount_cents)}</strong>
                  <button
                    className="text-button"
                    disabled={!r.active}
                    onClick={() =>
                      void run(() => repo!.realizeRecurring(r.id, day), 'Realização registrada.')
                    }
                  >
                    Registrar como realizado
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      setRecurringForm({
                        id: r.id,
                        description: r.description,
                        account_id: r.account_id,
                        category_id: r.category_id ?? '',
                        transaction_type: r.transaction_type,
                        amount: money(r.amount_cents).replace('R$', '').trim(),
                        day_of_month: String(r.day_of_month),
                        subscription: Boolean(r.subscription),
                      })
                    }
                  >
                    Editar
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      void run(
                        () => repo!.saveRecurring({ ...r, active: r.active ? 0 : 1 }, r.id),
                        r.active ? 'Recorrência pausada.' : 'Recorrência ativada.',
                      )
                    }
                  >
                    {r.active ? 'Pausar' : 'Ativar'}
                  </button>
                </li>
              ))}
            </ul>
            <p>
              Total mensal de assinaturas:{' '}
              {f(
                data.recurring
                  .filter((r) => r.active && r.subscription && r.transaction_type === 'expense')
                  .reduce((sum, r) => sum + r.amount_cents, 0),
              )}
            </p>
            <form
              className="finance-form finance-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await repo!.saveRecurring(
                    {
                      ...recurringForm,
                      account_id: recurringForm.account_id || inputAccount,
                      category_id: recurringForm.category_id || null,
                      amount_cents: amount(recurringForm.amount),
                      day_of_month: Number(recurringForm.day_of_month),
                      subscription: Number(recurringForm.subscription),
                    },
                    recurringForm.id || undefined,
                  );
                  setRecurringForm({
                    id: '',
                    description: '',
                    account_id: '',
                    category_id: '',
                    transaction_type: 'expense',
                    amount: '',
                    day_of_month: '1',
                    subscription: false,
                  });
                }, 'Recorrência salva.');
              }}
            >
              <label>
                Descrição
                <input
                  required
                  value={recurringForm.description}
                  onChange={(e) =>
                    setRecurringForm({ ...recurringForm, description: e.target.value })
                  }
                />
              </label>
              <label>
                Conta
                <select
                  value={recurringForm.account_id || inputAccount}
                  onChange={(e) =>
                    setRecurringForm({ ...recurringForm, account_id: e.target.value })
                  }
                >
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tipo
                <select
                  value={recurringForm.transaction_type}
                  onChange={(e) =>
                    setRecurringForm({
                      ...recurringForm,
                      transaction_type: e.target.value as 'income' | 'expense',
                      category_id: '',
                    })
                  }
                >
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                </select>
              </label>
              <label>
                Categoria
                <select
                  value={recurringForm.category_id}
                  onChange={(e) =>
                    setRecurringForm({ ...recurringForm, category_id: e.target.value })
                  }
                >
                  <option value="">Sem categoria</option>
                  {data.categories
                    .filter((c) => c.kind === recurringForm.transaction_type)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <MoneyField
                label="Valor"
                value={recurringForm.amount}
                onChange={(value) => setRecurringForm({ ...recurringForm, amount: value })}
              />
              <label>
                Dia do mês
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={recurringForm.day_of_month}
                  onChange={(e) =>
                    setRecurringForm({ ...recurringForm, day_of_month: e.target.value })
                  }
                />
              </label>
              <label className="finance-check">
                <input
                  type="checkbox"
                  checked={recurringForm.subscription}
                  onChange={(e) =>
                    setRecurringForm({ ...recurringForm, subscription: e.target.checked })
                  }
                />{' '}
                Assinatura
              </label>
              <button className="primary-button" disabled={busy || !data.accounts.length}>
                {recurringForm.id ? 'Salvar recorrência' : 'Adicionar recorrência'}
              </button>
            </form>
          </section>
        </>
      )}
      {tab === 'goals' && (
        <>
          <div className="finance-grid">
            <section className="finance-panel">
              <h2>Objetivos</h2>
              {data.goals.length ? (
                <ul className="finance-goals">
                  {data.goals.map((g) => {
                    const current = g.initial_amount_cents + (g.contributed_cents ?? 0),
                      points = projectGoal(
                        current,
                        g.target_amount_cents,
                        g.planned_monthly_contribution_cents,
                        g.annual_return_rate,
                        month,
                      ),
                      last = points.at(-1);
                    return (
                      <li key={g.id}>
                        <div className="finance-section-heading">
                          <h3>{g.name}</h3>
                          <strong>
                            {f(current)} de {f(g.target_amount_cents)}
                          </strong>
                        </div>
                        <progress
                          max={g.target_amount_cents}
                          value={Math.min(current, g.target_amount_cents)}
                        />
                        <p>
                          Aporte planejado: {f(g.planned_monthly_contribution_cents)}/mês · Taxa
                          anual informada: {g.annual_return_rate}%
                        </p>
                        <small>
                          Projeção:{' '}
                          {last && last.amount_cents >= g.target_amount_cents
                            ? monthLabel(last.month)
                            : 'Sem previsão com as premissas atuais'}
                          . Aporte ao fim de cada mês; rendimento estimado não altera saldo real.
                        </small>
                        <div className="finance-row">
                          <button
                            className="text-button"
                            onClick={() => {
                              setContributionForm({ ...contributionForm, goal_id: g.id });
                              void repo!
                                .contributions(g.id)
                                .then(setContributions)
                                .catch((e) => setError(notice(e)));
                            }}
                          >
                            Aportes
                          </button>
                          <button
                            className="text-button"
                            onClick={() =>
                              setGoalForm({
                                id: g.id,
                                name: g.name,
                                target: money(g.target_amount_cents).replace('R$', '').trim(),
                                initial: money(g.initial_amount_cents).replace('R$', '').trim(),
                                monthly: money(g.planned_monthly_contribution_cents)
                                  .replace('R$', '')
                                  .trim(),
                                rate: String(g.annual_return_rate),
                                target_date: g.target_date ?? '',
                              })
                            }
                          >
                            Editar
                          </button>
                          <button
                            className="text-button"
                            onClick={() =>
                              void run(() => repo!.archiveGoal(g.id), 'Objetivo arquivado.')
                            }
                          >
                            Arquivar
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="field-help">Nenhum objetivo ainda.</p>
              )}
            </section>
            <section className="finance-panel">
              <h2>{goalForm.id ? 'Editar objetivo' : 'Novo objetivo'}</h2>
              <form
                className="finance-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await repo!.saveGoal(
                      {
                        name: goalForm.name,
                        target_amount_cents: amount(goalForm.target),
                        initial_amount_cents: amount(goalForm.initial),
                        planned_monthly_contribution_cents: amount(goalForm.monthly),
                        annual_return_rate: Number(goalForm.rate.replace(',', '.')),
                        target_date: goalForm.target_date || null,
                      },
                      goalForm.id || undefined,
                    );
                    setGoalForm({
                      id: '',
                      name: '',
                      target: '',
                      initial: '0,00',
                      monthly: '0,00',
                      rate: '0',
                      target_date: '',
                    });
                  }, 'Objetivo salvo.');
                }}
              >
                <label>
                  Nome
                  <input
                    required
                    value={goalForm.name}
                    onChange={(e) => setGoalForm({ ...goalForm, name: e.target.value })}
                  />
                </label>
                <MoneyField
                  label="Meta"
                  value={goalForm.target}
                  onChange={(target) => setGoalForm({ ...goalForm, target })}
                />
                <MoneyField
                  label="Valor inicial real"
                  value={goalForm.initial}
                  onChange={(initial) => setGoalForm({ ...goalForm, initial })}
                />
                <MoneyField
                  label="Aporte mensal planejado"
                  value={goalForm.monthly}
                  onChange={(monthly) => setGoalForm({ ...goalForm, monthly })}
                />
                <label>
                  Taxa anual estimada (%)
                  <input
                    inputMode="decimal"
                    value={goalForm.rate}
                    onChange={(e) => setGoalForm({ ...goalForm, rate: e.target.value })}
                  />
                </label>
                <label>
                  Data alvo opcional
                  <input
                    type="date"
                    value={goalForm.target_date}
                    onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })}
                  />
                </label>
                <button className="primary-button" disabled={busy}>
                  Salvar objetivo
                </button>
              </form>
              {contributionForm.goal_id && (
                <>
                  <h3>Aporte para {currentGoal?.name}</h3>
                  <form
                    className="finance-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await repo!.addContribution(
                          contributionForm.goal_id,
                          contributionForm.date,
                          amount(contributionForm.amount),
                          contributionForm.notes,
                        );
                        setContributions(await repo!.contributions(contributionForm.goal_id));
                        setContributionForm({ ...contributionForm, amount: '', notes: '' });
                      }, 'Aporte registrado.');
                    }}
                  >
                    <label>
                      Data
                      <input
                        type="date"
                        value={contributionForm.date}
                        onChange={(e) =>
                          setContributionForm({ ...contributionForm, date: e.target.value })
                        }
                      />
                    </label>
                    <MoneyField
                      label="Valor"
                      value={contributionForm.amount}
                      onChange={(value) =>
                        setContributionForm({ ...contributionForm, amount: value })
                      }
                    />
                    <label>
                      Observações
                      <input
                        value={contributionForm.notes}
                        onChange={(e) =>
                          setContributionForm({ ...contributionForm, notes: e.target.value })
                        }
                      />
                    </label>
                    <button className="primary-button" disabled={busy}>
                      Registrar aporte
                    </button>
                  </form>
                  <ul className="finance-list">
                    {contributions.map((c) => (
                      <li key={c.id}>
                        <span>
                          {c.date}
                          <small>{c.notes || 'Aporte registrado'}</small>
                        </span>
                        <strong>{f(c.amount_cents)}</strong>
                        <button
                          className="text-button"
                          onClick={() =>
                            void run(async () => {
                              await repo!.deleteContribution(c.id);
                              setContributions(await repo!.contributions(c.goal_id));
                            }, 'Aporte removido.')
                          }
                        >
                          Remover
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="field-help">
                    O aporte reserva orçamento; não cria uma despesa nem movimenta uma conta
                    automaticamente.
                  </p>
                  {projection.length > 0 && (
                    <p className="field-help">
                      Valor projetado após 12 meses:{' '}
                      {f(projection[Math.min(12, projection.length - 1)].amount_cents)}
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
      {tab === 'worth' && (
        <>
          <div className="finance-metrics">
            <article className="finance-metric finance-primary">
              <span>Patrimônio líquido</span>
              <strong>{f(data.worth.net_cents)}</strong>
            </article>
            <article className="finance-metric">
              <span>Contas (inclui cartões)</span>
              <strong>{f(data.worth.account_cents)}</strong>
            </article>
            <article className="finance-metric">
              <span>Bens manuais</span>
              <strong>{f(data.worth.asset_cents)}</strong>
            </article>
            <article className="finance-metric">
              <span>Passivos manuais</span>
              <strong>{f(data.worth.liability_cents)}</strong>
            </article>
          </div>
          <div className="finance-grid">
            <section className="finance-panel">
              <h2>Bens e passivos</h2>
              <ul className="finance-list">
                {data.assets.map((a) => (
                  <li key={a.id}>
                    <span>
                      {a.name}
                      <small>
                        {a.kind === 'asset' ? 'Ativo' : 'Passivo'} ·{' '}
                        {a.type === 'other' ? 'Outro' : a.type}
                      </small>
                    </span>
                    <strong>{f(a.value_cents ?? 0)}</strong>
                    <button
                      className="text-button"
                      onClick={() => {
                        setAssetForm({
                          id: a.id,
                          name: a.name,
                          kind: a.kind,
                          type: a.type,
                          notes: a.notes,
                          date: day,
                          value: money(a.value_cents ?? 0)
                            .replace('R$', '')
                            .trim(),
                        });
                        void repo!
                          .valuations(a.id)
                          .then(setValuations)
                          .catch((e) => setError(notice(e)));
                      }}
                    >
                      Avaliar / editar
                    </button>
                    <button
                      className="text-button"
                      onClick={() => void run(() => repo!.archiveAsset(a.id), 'Bem arquivado.')}
                    >
                      Arquivar
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="finance-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const id = await repo!.saveAsset(
                      {
                        name: assetForm.name,
                        kind: assetForm.kind,
                        type: assetForm.type,
                        notes: assetForm.notes,
                      },
                      assetForm.id || undefined,
                    );
                    await repo!.saveValuation(id, assetForm.date, amount(assetForm.value));
                    setAssetForm({
                      id: '',
                      name: '',
                      kind: 'asset',
                      type: 'Outro',
                      notes: '',
                      date: day,
                      value: '',
                    });
                  }, 'Bem e avaliação salvos.');
                }}
              >
                <h3>{assetForm.id ? 'Editar e avaliar' : 'Novo bem ou passivo'}</h3>
                <label>
                  Nome
                  <input
                    required
                    value={assetForm.name}
                    onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                  />
                </label>
                <label>
                  Natureza
                  <select
                    value={assetForm.kind}
                    onChange={(e) =>
                      setAssetForm({ ...assetForm, kind: e.target.value as 'asset' | 'liability' })
                    }
                  >
                    <option value="asset">Ativo</option>
                    <option value="liability">Passivo</option>
                  </select>
                </label>
                <label>
                  Tipo
                  <input
                    value={assetForm.type}
                    onChange={(e) => setAssetForm({ ...assetForm, type: e.target.value })}
                  />
                </label>
                <label>
                  Data da avaliação
                  <input
                    type="date"
                    value={assetForm.date}
                    onChange={(e) => setAssetForm({ ...assetForm, date: e.target.value })}
                  />
                </label>
                <MoneyField
                  label="Valor informado"
                  value={assetForm.value}
                  onChange={(value) => setAssetForm({ ...assetForm, value })}
                />
                <label>
                  Notas
                  <input
                    value={assetForm.notes}
                    onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })}
                  />
                </label>
                <button className="primary-button" disabled={busy}>
                  Salvar avaliação
                </button>
              </form>
              {assetForm.id && (
                <div>
                  <h3>Avaliações de {assetForm.name}</h3>
                  <ul className="finance-list">
                    {valuations.map((v) => (
                      <li key={v.id}>
                        <span>{v.date}</span>
                        <strong>{f(v.value_cents)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <section className="finance-panel">
              <h2>Histórico de patrimônio</h2>
              <p className="field-help">
                Saldos de contas são derivados das transações; bens usam a última avaliação até cada
                mês.
              </p>
              <button
                className="text-button"
                onClick={() =>
                  void run(async () => {
                    const [y, m] = month.split('-').map(Number);
                    const months = Array.from({ length: 12 }, (_, i) => {
                      const d = new Date(y, m - 1 - i, 1);
                      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    }).reverse();
                    setHistory(await repo!.netWorthHistory(months));
                  }, 'Histórico atualizado.')
                }
              >
                Carregar últimos 12 meses
              </button>
              {history.length > 0 && (
                <div
                  className="finance-history"
                  role="img"
                  aria-label="Patrimônio líquido nos últimos doze meses"
                >
                  {history.map((point) => (
                    <div key={point.month}>
                      <span>{point.month.slice(5)}</span>
                      <div
                        style={{
                          height: `${Math.max(3, (Math.abs(point.net_cents) / Math.max(1, ...history.map((p) => Math.abs(p.net_cents)))) * 130)}px`,
                        }}
                      />
                      <strong>{f(point.net_cents)}</strong>
                    </div>
                  ))}
                </div>
              )}
              <table className="finance-table">
                <caption>Valores por mês</caption>
                <tbody>
                  {history.map((point) => (
                    <tr key={point.month}>
                      <th>{monthLabel(point.month)}</th>
                      <td>{f(point.net_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
