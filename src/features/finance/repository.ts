import type { SqlConnection } from '../../lib/database/connection';
import { available, normalizeDescription, validCents, validDate } from './domain';
import type { OfxDocument, OfxRow } from './ofx';
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

const uuid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
function name(value: string): string {
  const result = value.trim();
  if (!result) throw Error('Informe um nome.');
  return result;
}
function monthRange(month: string): [string, string] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Mês inválido.');
  return [month + '-01', month + '-31'];
}
export type TransactionInput = Pick<
  Transaction,
  'account_id' | 'date' | 'amount_cents' | 'transaction_type' | 'description'
> &
  Partial<Pick<Transaction, 'destination_account_id' | 'category_id' | 'notes'>>;
export type PreviewRow = OfxRow & {
  status: 'new' | 'duplicate' | 'possible';
  category_id: string | null;
  index: number;
};
export interface ImportPreview {
  rows: PreviewRow[];
  duplicateFile: boolean;
  existingBatchId: string | null;
  income_cents: number;
  expense_cents: number;
  account: string | null;
  currency: string | null;
}

export class FinanceRepository {
  constructor(private readonly db: SqlConnection) {}

  accounts(includeArchived = false) {
    return this.db.select<Account[]>(
      `SELECT a.*,
      a.opening_balance_cents+COALESCE((SELECT SUM(CASE WHEN t.transaction_type='income' THEN t.amount_cents ELSE -t.amount_cents END) FROM finance_transactions t WHERE t.account_id=a.id),0)
      +COALESCE((SELECT SUM(t.amount_cents) FROM finance_transactions t WHERE t.destination_account_id=a.id),0) balance_cents
      FROM finance_accounts a WHERE $1=1 OR a.archived_at IS NULL ORDER BY a.name`,
      [Number(includeArchived)],
    );
  }
  async saveAccount(input: Pick<Account, 'name' | 'type' | 'opening_balance_cents'>, id?: string) {
    if (
      !['checking', 'digital', 'savings', 'cash', 'investment', 'credit_card', 'other'].includes(
        input.type,
      )
    )
      throw Error('Tipo de conta inválido.');
    if (!Number.isSafeInteger(input.opening_balance_cents)) throw Error('Saldo inicial inválido.');
    const key = id ?? uuid(),
      now = stamp();
    const result = await this.db.execute(
      id
        ? 'UPDATE finance_accounts SET name=$1,type=$2,opening_balance_cents=$3,updated_at=$4 WHERE id=$5'
        : 'INSERT INTO finance_accounts(name,type,opening_balance_cents,updated_at,id,created_at) VALUES($1,$2,$3,$4,$5,$4)',
      [name(input.name), input.type, input.opening_balance_cents, now, key],
    );
    if (!result.rowsAffected) throw Error('Conta não encontrada.');
    return key;
  }
  archiveAccount(id: string) {
    return this.db.execute('UPDATE finance_accounts SET archived_at=$2,updated_at=$2 WHERE id=$1', [
      id,
      stamp(),
    ]);
  }

  categories(kind?: 'income' | 'expense', includeArchived = false) {
    return this.db.select<Category[]>(
      'SELECT * FROM finance_categories WHERE ($1 IS NULL OR kind=$1) AND ($2=1 OR archived_at IS NULL) ORDER BY kind,name',
      [kind ?? null, Number(includeArchived)],
    );
  }
  async saveCategory(input: Pick<Category, 'name' | 'kind'>, id?: string) {
    if (!['income', 'expense'].includes(input.kind)) throw Error('Tipo de categoria inválido.');
    const key = id ?? uuid(),
      now = stamp();
    const result = await this.db.execute(
      id
        ? 'UPDATE finance_categories SET name=$1,kind=$2,updated_at=$3 WHERE id=$4'
        : 'INSERT INTO finance_categories(name,kind,updated_at,id,created_at) VALUES($1,$2,$3,$4,$3)',
      [name(input.name), input.kind, now, key],
    );
    if (!result.rowsAffected) throw Error('Categoria não encontrada.');
    return key;
  }
  archiveCategory(id: string) {
    return this.db.execute(
      'UPDATE finance_categories SET archived_at=$2,updated_at=$2 WHERE id=$1',
      [id, stamp()],
    );
  }
  rules() {
    return this.db.select<Rule[]>(
      'SELECT * FROM finance_rules ORDER BY priority DESC,created_at,id',
    );
  }
  async saveRule(
    input: Pick<Rule, 'pattern' | 'match_type' | 'category_id' | 'priority' | 'active'>,
    id?: string,
  ) {
    if (!['contains', 'exact'].includes(input.match_type) || !Number.isSafeInteger(input.priority))
      throw Error('Regra inválida.');
    const key = id ?? uuid(),
      now = stamp();
    const result = await this.db.execute(
      id
        ? 'UPDATE finance_rules SET pattern=$1,match_type=$2,category_id=$3,priority=$4,active=$5,updated_at=$6 WHERE id=$7'
        : 'INSERT INTO finance_rules(pattern,match_type,category_id,priority,active,updated_at,id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$6)',
      [
        normalizeDescription(name(input.pattern)),
        input.match_type,
        input.category_id,
        input.priority,
        Number(input.active),
        now,
        key,
      ],
    );
    if (!result.rowsAffected) throw Error('Regra não encontrada.');
    return key;
  }
  async matchCategory(description: string, kind: 'income' | 'expense'): Promise<string | null> {
    const normalized = normalizeDescription(description);
    const rows = await this.db.select<{ category_id: string }[]>(
      `SELECT r.category_id FROM finance_rules r JOIN finance_categories c ON c.id=r.category_id
      WHERE r.active=1 AND c.archived_at IS NULL AND c.kind=$2 AND
      ((r.match_type='exact' AND r.pattern=$1) OR (r.match_type='contains' AND instr($1,r.pattern)>0))
      ORDER BY r.priority DESC,r.created_at,r.id LIMIT 1`,
      [normalized, kind],
    );
    return rows[0]?.category_id ?? null;
  }

  transactions(
    filters: {
      month?: string;
      accountId?: string;
      categoryId?: string;
      type?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const [start, end] = filters.month ? monthRange(filters.month) : ['0000-01-01', '9999-12-31'];
    return this.db.select<Transaction[]>(
      `SELECT * FROM finance_transactions WHERE date BETWEEN $1 AND $2
      AND ($3='' OR account_id=$3 OR destination_account_id=$3)
      AND ($4='' OR category_id=$4) AND ($5='' OR transaction_type=$5)
      AND ($6='' OR instr(normalized_description,$6)>0)
      ORDER BY date DESC,created_at DESC,id LIMIT $7 OFFSET $8`,
      [
        start,
        end,
        filters.accountId ?? '',
        filters.categoryId ?? '',
        filters.type ?? '',
        normalizeDescription(filters.search ?? ''),
        Math.max(1, Math.min(200, filters.limit ?? 50)),
        Math.max(0, filters.offset ?? 0),
      ],
    );
  }
  async saveTransaction(input: TransactionInput, id?: string) {
    validDate(input.date);
    validCents(input.amount_cents);
    if (!['income', 'expense', 'transfer'].includes(input.transaction_type))
      throw Error('Tipo de transação inválido.');
    if (
      input.transaction_type === 'transfer' &&
      (!input.destination_account_id || input.destination_account_id === input.account_id)
    )
      throw Error('Selecione outra conta de destino.');
    const description = name(input.description),
      key = id ?? uuid(),
      now = stamp();
    const category =
      input.transaction_type === 'transfer'
        ? null
        : (input.category_id ?? (await this.matchCategory(description, input.transaction_type)));
    const values = [
      input.account_id,
      input.destination_account_id ?? null,
      input.date,
      input.amount_cents,
      input.transaction_type,
      description,
      normalizeDescription(description),
      category,
      input.notes?.trim() ?? '',
      now,
      key,
    ];
    const result = await this.db.execute(
      id
        ? `UPDATE finance_transactions SET account_id=$1,destination_account_id=$2,date=$3,amount_cents=$4,transaction_type=$5,
        description=$6,normalized_description=$7,category_id=$8,notes=$9,updated_at=$10 WHERE id=$11`
        : `INSERT INTO finance_transactions(account_id,destination_account_id,date,amount_cents,transaction_type,description,
        normalized_description,category_id,notes,updated_at,id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10)`,
      values,
    );
    if (!result.rowsAffected) throw Error('Transação não encontrada.');
    return key;
  }
  deleteTransaction(id: string) {
    return this.db.execute('DELETE FROM finance_transactions WHERE id=$1', [id]);
  }
  async monthSummary(month: string): Promise<MonthSummary> {
    const [start, end] = monthRange(month);
    const [flow] = await this.db.select<{ income: number; expense: number }[]>(
      `SELECT
      COALESCE(SUM(CASE WHEN transaction_type='income' THEN amount_cents ELSE 0 END),0) income,
      COALESCE(SUM(CASE WHEN transaction_type='expense' THEN amount_cents ELSE 0 END),0) expense
      FROM finance_transactions WHERE date BETWEEN $1 AND $2`,
      [start, end],
    );
    const [reserve] = await this.db.select<{ cents: number }[]>(
      `SELECT COALESCE(SUM(amount_cents),0) cents FROM finance_goal_contributions WHERE date BETWEEN $1 AND $2`,
      [start, end],
    );
    const [balances] = await this.db.select<
      { cents: number }[]
    >(`SELECT COALESCE(SUM(opening_balance_cents),0)+
      COALESCE((SELECT SUM(CASE WHEN transaction_type='income' THEN amount_cents WHEN transaction_type='expense' THEN -amount_cents ELSE 0 END) FROM finance_transactions),0) cents FROM finance_accounts`);
    const plan = await this.plan(month);
    return {
      income_cents: flow.income,
      expense_cents: flow.expense,
      reserved_cents: reserve.cents,
      balance_cents: balances.cents,
      available_cents: available(flow.income, flow.expense, reserve.cents),
      planned_income_cents: plan?.income_cents ?? 0,
      planned_expense_cents: plan?.expense_cents ?? 0,
      planned_goal_cents: plan?.goal_cents ?? 0,
      planned_available_cents: available(
        plan?.income_cents ?? 0,
        plan?.expense_cents ?? 0,
        plan?.goal_cents ?? 0,
      ),
    };
  }
  spendingByCategory(month: string) {
    const [start, end] = monthRange(month);
    return this.db.select<{ category_id: string | null; name: string; cents: number }[]>(
      `SELECT t.category_id,COALESCE(c.name,'Sem categoria') name,SUM(t.amount_cents) cents
      FROM finance_transactions t LEFT JOIN finance_categories c ON c.id=t.category_id
      WHERE t.transaction_type='expense' AND t.date BETWEEN $1 AND $2 GROUP BY t.category_id ORDER BY cents DESC`,
      [start, end],
    );
  }

  plan(month: string) {
    monthRange(month);
    return this.db
      .select<Plan[]>('SELECT * FROM finance_month_plans WHERE month=$1', [month])
      .then((rows) => rows[0] ?? null);
  }
  savePlan(input: Plan) {
    monthRange(input.month);
    validCents(input.income_cents, true);
    validCents(input.expense_cents, true);
    validCents(input.goal_cents, true);
    return this.db.execute(
      `INSERT INTO finance_month_plans(month,income_cents,expense_cents,goal_cents,notes,updated_at) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(month) DO UPDATE SET income_cents=excluded.income_cents,expense_cents=excluded.expense_cents,
      goal_cents=excluded.goal_cents,notes=excluded.notes,updated_at=excluded.updated_at`,
      [
        input.month,
        input.income_cents,
        input.expense_cents,
        input.goal_cents,
        input.notes.trim(),
        stamp(),
      ],
    );
  }
  budgets(month: string) {
    const [start, end] = monthRange(month);
    return this.db.select<Budget[]>(
      `SELECT b.*,COALESCE((SELECT SUM(t.amount_cents) FROM finance_transactions t
      WHERE t.category_id=b.category_id AND t.transaction_type='expense' AND t.date BETWEEN $2 AND $3),0) realized_cents
      FROM finance_category_budgets b WHERE b.month=$1 ORDER BY b.category_id`,
      [month, start, end],
    );
  }
  async saveBudget(month: string, categoryId: string, cents: number) {
    monthRange(month);
    validCents(cents, true);
    if (!(await this.plan(month)))
      await this.savePlan({ month, income_cents: 0, expense_cents: 0, goal_cents: 0, notes: '' });
    return this.db.execute(
      `INSERT INTO finance_category_budgets(month,category_id,amount_cents) VALUES($1,$2,$3)
      ON CONFLICT(month,category_id) DO UPDATE SET amount_cents=excluded.amount_cents`,
      [month, categoryId, cents],
    );
  }
  deleteBudget(month: string, categoryId: string) {
    return this.db.execute(
      'DELETE FROM finance_category_budgets WHERE month=$1 AND category_id=$2',
      [month, categoryId],
    );
  }

  recurring(activeOnly = true) {
    return this.db.select<Recurring[]>(
      'SELECT * FROM finance_recurring WHERE $1=0 OR active=1 ORDER BY day_of_month,description',
      [Number(activeOnly)],
    );
  }
  async saveRecurring(input: Omit<Recurring, 'id' | 'active'> & { active?: number }, id?: string) {
    validCents(input.amount_cents);
    if (!['income', 'expense'].includes(input.transaction_type))
      throw Error('Tipo de recorrência inválido.');
    if (input.category_id) {
      const category = await this.db.select<Category[]>(
        'SELECT * FROM finance_categories WHERE id=$1 AND kind=$2 AND archived_at IS NULL',
        [input.category_id, input.transaction_type],
      );
      if (!category.length) throw Error('Categoria incompatível com a recorrência.');
    }
    if (!Number.isInteger(input.day_of_month) || input.day_of_month < 1 || input.day_of_month > 31)
      throw Error('Dia da recorrência inválido.');
    const key = id ?? uuid(),
      now = stamp(),
      values = [
        name(input.description),
        input.account_id,
        input.category_id,
        input.transaction_type,
        input.amount_cents,
        input.day_of_month,
        Number(input.subscription),
        Number(input.active ?? 1),
        now,
        key,
      ];
    const result = await this.db.execute(
      id
        ? 'UPDATE finance_recurring SET description=$1,account_id=$2,category_id=$3,transaction_type=$4,amount_cents=$5,day_of_month=$6,subscription=$7,active=$8,updated_at=$9 WHERE id=$10'
        : 'INSERT INTO finance_recurring(description,account_id,category_id,transaction_type,amount_cents,day_of_month,subscription,active,updated_at,id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9)',
      values,
    );
    if (!result.rowsAffected) throw Error('Recorrência não encontrada.');
    return key;
  }
  async realizeRecurring(id: string, date: string) {
    validDate(date);
    const rows = await this.db.select<Recurring[]>(
      'SELECT * FROM finance_recurring WHERE id=$1 AND active=1',
      [id],
    );
    const row = rows[0];
    if (!row) throw Error('Recorrência não encontrada.');
    const key = uuid(),
      now = stamp(),
      description = name(row.description);
    await this.db.execute(
      `INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,category_id,source,recurring_id,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'recurring',$9,$10,$10) ON CONFLICT DO NOTHING`,
      [
        key,
        row.account_id,
        date,
        row.amount_cents,
        row.transaction_type,
        description,
        normalizeDescription(description),
        row.category_id,
        id,
        now,
      ],
    );
    const existing = await this.db.select<{ id: string }[]>(
      'SELECT id FROM finance_transactions WHERE recurring_id=$1 AND date=$2',
      [id, date],
    );
    return existing[0]?.id ?? key;
  }

  goals(includeArchived = false) {
    return this.db.select<Goal[]>(
      `SELECT g.*,COALESCE((SELECT SUM(c.amount_cents) FROM finance_goal_contributions c WHERE c.goal_id=g.id),0) contributed_cents
    FROM finance_goals g WHERE $1=1 OR g.archived_at IS NULL ORDER BY g.created_at DESC,g.id`,
      [Number(includeArchived)],
    );
  }
  async saveGoal(
    input: Pick<
      Goal,
      | 'name'
      | 'target_amount_cents'
      | 'initial_amount_cents'
      | 'planned_monthly_contribution_cents'
      | 'annual_return_rate'
      | 'target_date'
    >,
    id?: string,
  ) {
    validCents(input.target_amount_cents);
    validCents(input.initial_amount_cents, true);
    validCents(input.planned_monthly_contribution_cents, true);
    if (
      !Number.isFinite(input.annual_return_rate) ||
      input.annual_return_rate < 0 ||
      input.annual_return_rate > 1000
    )
      throw Error('Taxa anual inválida.');
    if (input.target_date) validDate(input.target_date);
    const key = id ?? uuid(),
      now = stamp(),
      values = [
        name(input.name),
        input.target_amount_cents,
        input.initial_amount_cents,
        input.planned_monthly_contribution_cents,
        input.annual_return_rate,
        input.target_date,
        now,
        key,
      ];
    const result = await this.db.execute(
      id
        ? 'UPDATE finance_goals SET name=$1,target_amount_cents=$2,initial_amount_cents=$3,planned_monthly_contribution_cents=$4,annual_return_rate=$5,target_date=$6,updated_at=$7 WHERE id=$8'
        : 'INSERT INTO finance_goals(name,target_amount_cents,initial_amount_cents,planned_monthly_contribution_cents,annual_return_rate,target_date,updated_at,id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7)',
      values,
    );
    if (!result.rowsAffected) throw Error('Objetivo não encontrado.');
    return key;
  }
  archiveGoal(id: string) {
    return this.db.execute('UPDATE finance_goals SET archived_at=$2,updated_at=$2 WHERE id=$1', [
      id,
      stamp(),
    ]);
  }
  contributions(goalId: string) {
    return this.db.select<Contribution[]>(
      'SELECT * FROM finance_goal_contributions WHERE goal_id=$1 ORDER BY date DESC,id',
      [goalId],
    );
  }
  async addContribution(
    goalId: string,
    date: string,
    cents: number,
    notes = '',
    transactionId?: string,
  ) {
    validDate(date);
    validCents(cents);
    if (transactionId) {
      const rows = await this.db.select<Transaction[]>(
        "SELECT * FROM finance_transactions WHERE id=$1 AND transaction_type='transfer'",
        [transactionId],
      );
      if (!rows.length) throw Error('Aporte só pode ser vinculado a uma transferência.');
    }
    const key = uuid();
    await this.db.execute(
      'INSERT INTO finance_goal_contributions(id,goal_id,date,amount_cents,transaction_id,notes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [key, goalId, date, cents, transactionId ?? null, notes.trim(), stamp()],
    );
    return key;
  }
  deleteContribution(id: string) {
    return this.db.execute('DELETE FROM finance_goal_contributions WHERE id=$1', [id]);
  }

  assets(includeArchived = false) {
    return this.db.select<Asset[]>(
      `SELECT a.*,v.value_cents FROM finance_assets a LEFT JOIN finance_asset_valuations v ON v.id=
    (SELECT id FROM finance_asset_valuations WHERE asset_id=a.id ORDER BY date DESC,id DESC LIMIT 1)
    WHERE $1=1 OR a.archived_at IS NULL ORDER BY a.name`,
      [Number(includeArchived)],
    );
  }
  async saveAsset(input: Pick<Asset, 'name' | 'kind' | 'type' | 'notes'>, id?: string) {
    if (!['asset', 'liability'].includes(input.kind)) throw Error('Tipo de bem inválido.');
    const key = id ?? uuid(),
      now = stamp(),
      values = [
        name(input.name),
        input.kind,
        input.type.trim() || 'other',
        input.notes.trim(),
        now,
        key,
      ];
    const result = await this.db.execute(
      id
        ? 'UPDATE finance_assets SET name=$1,kind=$2,type=$3,notes=$4,updated_at=$5 WHERE id=$6'
        : 'INSERT INTO finance_assets(name,kind,type,notes,updated_at,id,created_at) VALUES($1,$2,$3,$4,$5,$6,$5)',
      values,
    );
    if (!result.rowsAffected) throw Error('Bem não encontrado.');
    return key;
  }
  archiveAsset(id: string) {
    return this.db.execute('UPDATE finance_assets SET archived_at=$2,updated_at=$2 WHERE id=$1', [
      id,
      stamp(),
    ]);
  }
  async saveValuation(assetId: string, date: string, cents: number) {
    validDate(date);
    validCents(cents, true);
    return this.db.execute(
      `INSERT INTO finance_asset_valuations(id,asset_id,date,value_cents,created_at) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(asset_id,date) DO UPDATE SET value_cents=excluded.value_cents`,
      [uuid(), assetId, date, cents, stamp()],
    );
  }
  valuations(assetId: string) {
    return this.db.select<Valuation[]>(
      'SELECT * FROM finance_asset_valuations WHERE asset_id=$1 ORDER BY date DESC',
      [assetId],
    );
  }
  async netWorth(date: string) {
    validDate(date);
    const [accounts] = await this.db.select<{ cents: number }[]>(
      `SELECT COALESCE(SUM(opening_balance_cents),0)
      +COALESCE((SELECT SUM(CASE WHEN transaction_type='income' THEN amount_cents WHEN transaction_type='expense' THEN -amount_cents ELSE 0 END) FROM finance_transactions WHERE date<=$1),0) cents FROM finance_accounts`,
      [date],
    );
    const [manual] = await this.db.select<{ assets: number; liabilities: number }[]>(
      `SELECT
      COALESCE(SUM(CASE WHEN a.kind='asset' THEN v.value_cents ELSE 0 END),0) assets,
      COALESCE(SUM(CASE WHEN a.kind='liability' THEN v.value_cents ELSE 0 END),0) liabilities
      FROM finance_assets a LEFT JOIN finance_asset_valuations v ON v.id=(SELECT id FROM finance_asset_valuations
      WHERE asset_id=a.id AND date<=$1 ORDER BY date DESC,id DESC LIMIT 1)
      WHERE a.archived_at IS NULL OR a.archived_at>$2`,
      [date, date + 'T23:59:59Z'],
    );
    return {
      account_cents: accounts.cents,
      asset_cents: manual.assets,
      liability_cents: manual.liabilities,
      net_cents: accounts.cents + manual.assets - manual.liabilities,
    };
  }
  netWorthHistory(months: string[]) {
    return Promise.all(
      months.map(async (month) => {
        monthRange(month);
        const [year, number] = month.split('-').map(Number);
        const last = new Date(year, number, 0).getDate();
        return { month, ...(await this.netWorth(`${month}-${String(last).padStart(2, '0')}`)) };
      }),
    );
  }
  hidden() {
    return this.db
      .select<{ hide_values: number }[]>('SELECT hide_values FROM finance_preferences WHERE id=1')
      .then((rows) => Boolean(rows[0]?.hide_values));
  }
  setHidden(hidden: boolean) {
    return this.db.execute('UPDATE finance_preferences SET hide_values=$1 WHERE id=1', [
      Number(hidden),
    ]);
  }

  async previewOfx(accountId: string, hash: string, document: OfxDocument): Promise<ImportPreview> {
    const batch = await this.db.select<{ id: string }[]>(
      'SELECT id FROM finance_import_batches WHERE account_id=$1 AND file_hash=$2',
      [accountId, hash],
    );
    const ids = await this.db.select<{ external_id: string }[]>(
      "SELECT external_id FROM finance_transactions WHERE account_id=$1 AND source='ofx' AND external_id IS NOT NULL",
      [accountId],
    );
    const existingIds = new Set(ids.map((row) => row.external_id));
    const fallback = await this.db.select<
      Pick<Transaction, 'date' | 'amount_cents' | 'normalized_description' | 'transaction_type'>[]
    >(
      "SELECT date,amount_cents,normalized_description,transaction_type FROM finance_transactions WHERE account_id=$1 AND source='ofx' AND external_id IS NULL",
      [accountId],
    );
    const fallbackKeys = new Set(
      fallback.map(
        (row) =>
          `${row.date}|${row.amount_cents}|${row.transaction_type}|${row.normalized_description}`,
      ),
    );
    const rules = await this.rules(),
      categories = await this.categories();
    const kinds = new Map(categories.map((category) => [category.id, category.kind]));
    const activeRules = rules.filter((rule) => rule.active);
    const seenIds = new Set<string>(),
      seenFallback = new Set<string>();
    const rows: PreviewRow[] = [];
    for (const [index, row] of document.rows.entries()) {
      const fallbackKey = `${row.date}|${row.amount_cents}|${row.transaction_type}|${row.normalized_description}`;
      const status: PreviewRow['status'] =
        batch.length ||
        (row.external_id && (seenIds.has(row.external_id) || existingIds.has(row.external_id)))
          ? 'duplicate'
          : !row.external_id && (seenFallback.has(fallbackKey) || fallbackKeys.has(fallbackKey))
            ? 'possible'
            : 'new';
      if (row.external_id) seenIds.add(row.external_id);
      else seenFallback.add(fallbackKey);
      const rule = activeRules.find(
        (rule) =>
          kinds.get(rule.category_id) === row.transaction_type &&
          (rule.match_type === 'exact'
            ? row.normalized_description === rule.pattern
            : row.normalized_description.includes(rule.pattern)),
      );
      rows.push({ ...row, index, status, category_id: rule?.category_id ?? null });
    }
    return {
      rows,
      duplicateFile: batch.length > 0,
      existingBatchId: batch[0]?.id ?? null,
      income_cents: rows
        .filter((row) => row.status === 'new' && row.transaction_type === 'income')
        .reduce((sum, row) => sum + row.amount_cents, 0),
      expense_cents: rows
        .filter((row) => row.status === 'new' && row.transaction_type === 'expense')
        .reduce((sum, row) => sum + row.amount_cents, 0),
      account: document.account,
      currency: document.currency,
    };
  }
  async importOfx(
    accountId: string,
    fileName: string,
    hash: string,
    document: OfxDocument,
    includePossible: number[] = [],
  ): Promise<{ count: number; duplicateFile: boolean }> {
    const preview = await this.previewOfx(accountId, hash, document);
    if (preview.duplicateFile) return { count: 0, duplicateFile: true };
    const selected = preview.rows.filter(
      (row) =>
        row.status === 'new' || (row.status === 'possible' && includePossible.includes(row.index)),
    );
    const payload = selected.map((row) => ({
      id: uuid(),
      date: row.date,
      amount_cents: row.amount_cents,
      transaction_type: row.transaction_type,
      description: row.description,
      normalized_description: row.normalized_description,
      category_id: row.category_id,
      notes: row.notes,
      external_id: row.external_id,
      check_number: row.check_number,
      external_type: row.external_type,
    }));
    await this.db.execute(
      'INSERT INTO finance_import_batches(id,account_id,file_name,file_hash,imported_at,transaction_count,payload_json,source_account_ref,source_currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        uuid(),
        accountId,
        fileName.slice(0, 255),
        hash,
        stamp(),
        payload.length,
        JSON.stringify(payload),
        document.account,
        document.currency,
      ],
    );
    return { count: payload.length, duplicateFile: false };
  }
}
