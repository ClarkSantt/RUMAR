export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'digital' | 'savings' | 'cash' | 'investment' | 'credit_card' | 'other';
  currency: 'BRL';
  opening_balance_cents: number;
  balance_cents?: number;
  archived_at: string | null;
}
export interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  archived_at: string | null;
}
export interface Rule {
  id: string;
  pattern: string;
  match_type: 'contains' | 'exact';
  category_id: string;
  priority: number;
  active: number;
}
export interface Transaction {
  id: string;
  account_id: string;
  destination_account_id: string | null;
  date: string;
  amount_cents: number;
  transaction_type: 'income' | 'expense' | 'transfer';
  description: string;
  normalized_description: string;
  category_id: string | null;
  notes: string;
  source: 'manual' | 'ofx' | 'recurring';
  external_id: string | null;
  check_number: string | null;
  import_batch_id: string | null;
  external_type: string | null;
  recurring_id: string | null;
}
export interface Plan {
  month: string;
  income_cents: number;
  expense_cents: number;
  goal_cents: number;
  notes: string;
}
export interface Budget {
  month: string;
  category_id: string;
  amount_cents: number;
  realized_cents?: number;
}
export interface Recurring {
  id: string;
  description: string;
  account_id: string;
  category_id: string | null;
  transaction_type: 'income' | 'expense';
  amount_cents: number;
  day_of_month: number;
  subscription: number;
  active: number;
}
export interface Goal {
  id: string;
  name: string;
  target_amount_cents: number;
  initial_amount_cents: number;
  planned_monthly_contribution_cents: number;
  annual_return_rate: number;
  target_date: string | null;
  archived_at: string | null;
  contributed_cents?: number;
}
export interface Contribution {
  id: string;
  goal_id: string;
  date: string;
  amount_cents: number;
  transaction_id: string | null;
  notes: string;
}
export interface Asset {
  id: string;
  name: string;
  kind: 'asset' | 'liability';
  type: string;
  notes: string;
  archived_at: string | null;
  value_cents?: number;
}
export interface Valuation {
  id: string;
  asset_id: string;
  date: string;
  value_cents: number;
}
export interface MonthSummary {
  income_cents: number;
  expense_cents: number;
  reserved_cents: number;
  balance_cents: number;
  available_cents: number;
  planned_available_cents: number;
  planned_income_cents: number;
  planned_expense_cents: number;
  planned_goal_cents: number;
}
