-- Imports are a single SQLite statement. Triggers consume the validated
-- transient payload, so a failing row rolls back the entire batch.
CREATE TABLE data_import_batches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('finance_csv','body_csv','calendar_ics')),
  file_name TEXT NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255),
  file_hash TEXT NOT NULL CHECK(length(file_hash)=64),
  account_id TEXT REFERENCES finance_accounts(id),
  row_count INTEGER NOT NULL CHECK(row_count BETWEEN 0 AND 10000),
  imported_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(payload_json)),
  CHECK((kind='finance_csv' AND account_id IS NOT NULL) OR
        (kind<>'finance_csv' AND account_id IS NULL))
);
CREATE UNIQUE INDEX data_import_finance_file ON data_import_batches(account_id,file_hash)
  WHERE kind='finance_csv';
CREATE INDEX data_import_history ON data_import_batches(imported_at DESC);
ALTER TABLE finance_transactions ADD COLUMN csv_import_batch_id TEXT REFERENCES data_import_batches(id) ON DELETE SET NULL;
CREATE INDEX finance_transactions_csv_batch ON finance_transactions(csv_import_batch_id);

CREATE TABLE external_calendar_events (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE CHECK(length(uid) BETWEEN 1 AND 512),
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 500),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=4000),
  start_date TEXT NOT NULL CHECK(start_date GLOB '????-??-??'),
  start_time TEXT CHECK(start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_date TEXT CHECK(end_date IS NULL OR end_date GLOB '????-??-??'),
  end_time TEXT CHECK(end_time IS NULL OR end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  import_batch_id TEXT REFERENCES data_import_batches(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(end_date IS NULL OR end_date>=start_date)
);
CREATE INDEX external_calendar_range ON external_calendar_events(start_date,start_time);

CREATE TRIGGER data_import_finance AFTER INSERT ON data_import_batches
WHEN NEW.kind='finance_csv' BEGIN
  INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,
    description,normalized_description,category_id,notes,source,external_id,
    csv_import_batch_id,created_at,updated_at)
  SELECT json_extract(j.value,'$.id'),NEW.account_id,json_extract(j.value,'$.date'),
    json_extract(j.value,'$.amount_cents'),json_extract(j.value,'$.transaction_type'),
    json_extract(j.value,'$.description'),json_extract(j.value,'$.normalized_description'),
    json_extract(j.value,'$.category_id'),COALESCE(json_extract(j.value,'$.notes'),''),
    'manual','csv:'||NEW.file_hash||':'||j.key,NEW.id,NEW.imported_at,NEW.imported_at
  FROM json_each(NEW.payload_json) j;
  UPDATE data_import_batches SET payload_json='[]' WHERE id=NEW.id;
END;

CREATE TRIGGER data_import_body AFTER INSERT ON data_import_batches
WHEN NEW.kind='body_csv' BEGIN
  INSERT INTO body_measurement_records(record_id,measurement_date,notes,pending_values,created_at,updated_at)
  SELECT json_extract(j.value,'$.id'),json_extract(j.value,'$.date'),
    COALESCE(json_extract(j.value,'$.notes'),''),json_extract(j.value,'$.metrics'),
    NEW.imported_at,NEW.imported_at
  FROM json_each(NEW.payload_json) j WHERE 1=1
  ON CONFLICT(measurement_date) DO UPDATE SET
    notes=CASE WHEN excluded.notes<>'' THEN excluded.notes ELSE body_measurement_records.notes END,
    pending_values=excluded.pending_values,updated_at=excluded.updated_at;
  UPDATE data_import_batches SET payload_json='[]' WHERE id=NEW.id;
END;

CREATE TRIGGER data_import_calendar AFTER INSERT ON data_import_batches
WHEN NEW.kind='calendar_ics' BEGIN
  INSERT INTO external_calendar_events(id,uid,summary,description,start_date,start_time,end_date,end_time,
    import_batch_id,created_at,updated_at)
  SELECT json_extract(j.value,'$.id'),json_extract(j.value,'$.uid'),json_extract(j.value,'$.summary'),
    COALESCE(json_extract(j.value,'$.description'),''),json_extract(j.value,'$.start_date'),
    json_extract(j.value,'$.start_time'),json_extract(j.value,'$.end_date'),json_extract(j.value,'$.end_time'),
    NEW.id,NEW.imported_at,NEW.imported_at FROM json_each(NEW.payload_json) j WHERE 1=1
  ON CONFLICT(uid) DO UPDATE SET summary=excluded.summary,description=excluded.description,
    start_date=excluded.start_date,start_time=excluded.start_time,end_date=excluded.end_date,
    end_time=excluded.end_time,import_batch_id=excluded.import_batch_id,updated_at=excluded.updated_at;
  UPDATE data_import_batches SET payload_json='[]' WHERE id=NEW.id;
END;
