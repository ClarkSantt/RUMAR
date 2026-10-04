-- A finance CSV row may select an existing account; the batch account remains
-- an explicit fallback. The foreign keys validate every mapped value atomically.
DROP TRIGGER data_import_finance;
CREATE TRIGGER data_import_finance AFTER INSERT ON data_import_batches
WHEN NEW.kind='finance_csv' BEGIN
  INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,
    description,normalized_description,category_id,notes,source,external_id,
    csv_import_batch_id,created_at,updated_at)
  SELECT json_extract(j.value,'$.id'),
    COALESCE(json_extract(j.value,'$.account_id'),NEW.account_id),
    json_extract(j.value,'$.date'),json_extract(j.value,'$.amount_cents'),
    json_extract(j.value,'$.transaction_type'),json_extract(j.value,'$.description'),
    json_extract(j.value,'$.normalized_description'),json_extract(j.value,'$.category_id'),
    COALESCE(json_extract(j.value,'$.notes'),''),
    'manual','csv:'||NEW.file_hash||':'||j.key,NEW.id,NEW.imported_at,NEW.imported_at
  FROM json_each(NEW.payload_json) j;
  UPDATE data_import_batches SET payload_json='[]' WHERE id=NEW.id;
END;
