-- Provider-neutral, read-only connection metadata. Tokens and raw bank payloads are excluded.
CREATE TABLE financial_connections (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL CHECK(length(trim(provider))>0),
 external_connection_id TEXT NOT NULL CHECK(length(trim(external_connection_id))>0),
 institution_name TEXT NOT NULL CHECK(length(trim(institution_name))>0),
 status TEXT NOT NULL CHECK(status IN('connected','syncing','reconnect_required','consent_expired','error','disconnected')),
 consent_expires_at TEXT,
 sync_cursor TEXT,
 last_synced_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(provider,external_connection_id)
);
CREATE INDEX financial_connections_status ON financial_connections(status,last_synced_at);

CREATE TABLE financial_external_accounts (
 id TEXT PRIMARY KEY,
 connection_id TEXT NOT NULL REFERENCES financial_connections(id) ON DELETE CASCADE,
 external_account_id TEXT NOT NULL CHECK(length(trim(external_account_id))>0),
 institution_name TEXT NOT NULL,
 account_name TEXT NOT NULL,
 account_type TEXT NOT NULL,
 currency TEXT NOT NULL,
 last_four TEXT,
 linked_finance_account_id TEXT REFERENCES finance_accounts(id) ON DELETE SET NULL,
 reported_balance_cents INTEGER,
 reported_balance_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(connection_id,external_account_id)
);
CREATE INDEX financial_external_accounts_link ON financial_external_accounts(linked_finance_account_id);

-- Effective origin is open_finance when this row exists. This avoids rebuilding the
-- older finance_transactions table and its already-applied CHECK constraint.
CREATE TABLE financial_external_transaction_links (
 connection_id TEXT NOT NULL REFERENCES financial_connections(id) ON DELETE CASCADE,
 external_account_id TEXT NOT NULL,
 external_transaction_id TEXT NOT NULL,
 transaction_id TEXT NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN('pending','posted')),
 posted_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(connection_id,external_account_id,external_transaction_id),
 UNIQUE(transaction_id),
 FOREIGN KEY(connection_id,external_account_id)
   REFERENCES financial_external_accounts(connection_id,external_account_id) ON DELETE CASCADE
);
CREATE INDEX financial_transaction_links_account ON financial_external_transaction_links(connection_id,external_account_id);

CREATE TABLE financial_sync_runs (
 id TEXT PRIMARY KEY,
 connection_id TEXT NOT NULL REFERENCES financial_connections(id) ON DELETE CASCADE,
 started_at TEXT NOT NULL,
 finished_at TEXT,
 status TEXT NOT NULL CHECK(status IN('running','completed','error')),
 new_count INTEGER NOT NULL DEFAULT 0 CHECK(new_count>=0),
 updated_count INTEGER NOT NULL DEFAULT 0 CHECK(updated_count>=0),
 skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count>=0),
 error_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX financial_sync_runs_connection ON financial_sync_runs(connection_id,started_at DESC);
