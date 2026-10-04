-- Monetary values are signed INTEGER cents. Income/expense amounts are positive;
-- a transfer moves a positive amount from account_id to destination_account_id.
CREATE TABLE finance_accounts (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0),
 type TEXT NOT NULL CHECK(type IN('checking','digital','savings','cash','investment','credit_card','other')),
 currency TEXT NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 opening_balance_cents INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE INDEX finance_accounts_active ON finance_accounts(archived_at,name);
CREATE TABLE finance_categories (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0),
 kind TEXT NOT NULL CHECK(kind IN('income','expense')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE INDEX finance_categories_active ON finance_categories(kind,archived_at,name);
CREATE TABLE finance_rules (
 id TEXT PRIMARY KEY, pattern TEXT NOT NULL CHECK(length(trim(pattern))>0),
 match_type TEXT NOT NULL CHECK(match_type IN('contains','exact')),
 category_id TEXT NOT NULL REFERENCES finance_categories(id),
 priority INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX finance_rules_order ON finance_rules(active,priority DESC);
CREATE TABLE finance_import_batches (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES finance_accounts(id),
 file_name TEXT NOT NULL, file_hash TEXT NOT NULL, imported_at TEXT NOT NULL,
 transaction_count INTEGER NOT NULL DEFAULT 0 CHECK(transaction_count>=0),
 -- The normalized import request exists only during the INSERT statement.
 payload_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(payload_json)),
 UNIQUE(account_id,file_hash)
);
CREATE INDEX finance_batches_account ON finance_import_batches(account_id,imported_at DESC);
CREATE TABLE finance_transactions (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES finance_accounts(id),
 destination_account_id TEXT REFERENCES finance_accounts(id),
 date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 transaction_type TEXT NOT NULL CHECK(transaction_type IN('income','expense','transfer')),
 description TEXT NOT NULL CHECK(length(trim(description))>0), normalized_description TEXT NOT NULL,
 category_id TEXT REFERENCES finance_categories(id) ON DELETE SET NULL,
 notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN('manual','ofx','recurring')),
 external_id TEXT, check_number TEXT,
 import_batch_id TEXT REFERENCES finance_import_batches(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((transaction_type='transfer' AND destination_account_id IS NOT NULL
   AND destination_account_id<>account_id AND category_id IS NULL)
   OR (transaction_type<>'transfer' AND destination_account_id IS NULL))
);
CREATE UNIQUE INDEX finance_external_id ON finance_transactions(account_id,source,external_id) WHERE external_id IS NOT NULL;
CREATE INDEX finance_transactions_date ON finance_transactions(date DESC,id);
CREATE INDEX finance_transactions_account ON finance_transactions(account_id,date DESC);
CREATE INDEX finance_transactions_destination ON finance_transactions(destination_account_id,date DESC);
CREATE INDEX finance_transactions_category ON finance_transactions(category_id,date DESC);
CREATE INDEX finance_transactions_batch ON finance_transactions(import_batch_id);
-- One statement imports the batch and its transactions or rolls back both.
-- The trigger removes the transient normalized payload before persistence.
CREATE TRIGGER finance_import_rows AFTER INSERT ON finance_import_batches
BEGIN
 INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,
  description,normalized_description,category_id,notes,source,external_id,check_number,
  import_batch_id,created_at,updated_at)
 SELECT json_extract(j.value,'$.id'),NEW.account_id,json_extract(j.value,'$.date'),
  json_extract(j.value,'$.amount_cents'),json_extract(j.value,'$.transaction_type'),
  json_extract(j.value,'$.description'),json_extract(j.value,'$.normalized_description'),
  json_extract(j.value,'$.category_id'),json_extract(j.value,'$.notes'),'ofx',
  json_extract(j.value,'$.external_id'),json_extract(j.value,'$.check_number'),NEW.id,
  NEW.imported_at,NEW.imported_at FROM json_each(NEW.payload_json) j;
 UPDATE finance_import_batches SET payload_json='[]' WHERE id=NEW.id;
END;
CREATE TABLE finance_month_plans (
 month TEXT PRIMARY KEY CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
 income_cents INTEGER NOT NULL DEFAULT 0 CHECK(income_cents>=0),
 expense_cents INTEGER NOT NULL DEFAULT 0 CHECK(expense_cents>=0),
 goal_cents INTEGER NOT NULL DEFAULT 0 CHECK(goal_cents>=0),
 notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE finance_category_budgets (
 month TEXT NOT NULL REFERENCES finance_month_plans(month) ON DELETE CASCADE,
 category_id TEXT NOT NULL REFERENCES finance_categories(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 PRIMARY KEY(month,category_id)
);
CREATE TABLE finance_recurring (
 id TEXT PRIMARY KEY, description TEXT NOT NULL CHECK(length(trim(description))>0),
 account_id TEXT NOT NULL REFERENCES finance_accounts(id),
 category_id TEXT REFERENCES finance_categories(id) ON DELETE SET NULL,
 transaction_type TEXT NOT NULL CHECK(transaction_type IN('income','expense')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 day_of_month INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
 subscription INTEGER NOT NULL DEFAULT 0 CHECK(subscription IN(0,1)),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX finance_recurring_due ON finance_recurring(active,day_of_month);
CREATE TABLE finance_goals (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0),
 target_amount_cents INTEGER NOT NULL CHECK(target_amount_cents>0),
 initial_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(initial_amount_cents>=0),
 planned_monthly_contribution_cents INTEGER NOT NULL DEFAULT 0 CHECK(planned_monthly_contribution_cents>=0),
 annual_return_rate REAL NOT NULL DEFAULT 0 CHECK(annual_return_rate>=0 AND annual_return_rate<=1000),
 target_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE finance_goal_contributions (
 id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES finance_goals(id) ON DELETE CASCADE,
 date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 transaction_id TEXT REFERENCES finance_transactions(id) ON DELETE SET NULL,
 notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX finance_goal_contributions_date ON finance_goal_contributions(goal_id,date);
CREATE TABLE finance_assets (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0),
 kind TEXT NOT NULL CHECK(kind IN('asset','liability')),
 type TEXT NOT NULL DEFAULT 'other', notes TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE finance_asset_valuations (
 id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES finance_assets(id) ON DELETE CASCADE,
 date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 value_cents INTEGER NOT NULL CHECK(value_cents>=0), created_at TEXT NOT NULL,
 UNIQUE(asset_id,date)
);
CREATE INDEX finance_valuations_history ON finance_asset_valuations(asset_id,date DESC);
CREATE TABLE finance_preferences (
 id INTEGER PRIMARY KEY CHECK(id=1), hide_values INTEGER NOT NULL DEFAULT 0 CHECK(hide_values IN(0,1))
);
INSERT INTO finance_preferences(id) VALUES(1);
INSERT INTO finance_categories(id,name,kind,created_at,updated_at) VALUES
 ('finance-food','Alimentação','expense','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('finance-home','Moradia','expense','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('finance-transport','Transporte','expense','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('finance-health','Saúde','expense','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('finance-education','Educação','expense','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('finance-leisure','Lazer','expense','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('finance-subscriptions','Assinaturas','expense','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('finance-shopping','Compras','expense','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('finance-other','Outros','expense','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('finance-income','Renda','income','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('finance-work','Trabalho','income','2026-09-27T00:00:00Z','2026-09-27T00:00:00Z');
