-- A conflict is never silently overwritten during a new import. Existing
-- batches keep their historical behavior; new batches choose a policy.
ALTER TABLE data_import_batches ADD COLUMN conflict_policy TEXT NOT NULL DEFAULT 'update'
  CHECK(conflict_policy IN ('update','skip'));

DROP TRIGGER data_import_body;
CREATE TRIGGER data_import_body AFTER INSERT ON data_import_batches
WHEN NEW.kind='body_csv' BEGIN
  INSERT INTO body_measurement_records(record_id,measurement_date,notes,pending_values,created_at,updated_at)
  SELECT json_extract(j.value,'$.id'),json_extract(j.value,'$.date'),
    COALESCE(json_extract(j.value,'$.notes'),''),json_extract(j.value,'$.metrics'),
    NEW.imported_at,NEW.imported_at
  FROM json_each(NEW.payload_json) j WHERE 1=1
  ON CONFLICT(measurement_date) DO UPDATE SET
    notes=CASE WHEN excluded.notes<>'' THEN excluded.notes ELSE body_measurement_records.notes END,
    pending_values=excluded.pending_values,updated_at=excluded.updated_at
  WHERE NEW.conflict_policy='update';
  UPDATE data_import_batches SET payload_json='[]' WHERE id=NEW.id;
END;

DROP TRIGGER data_import_calendar;
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
    end_time=excluded.end_time,import_batch_id=excluded.import_batch_id,updated_at=excluded.updated_at
  WHERE NEW.conflict_policy='update';
  UPDATE data_import_batches SET payload_json='[]' WHERE id=NEW.id;
END;
