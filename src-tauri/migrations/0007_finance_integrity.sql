-- Additive follow-up: 0006 was already exercised against validation databases.
ALTER TABLE finance_import_batches ADD COLUMN source_account_ref TEXT;
ALTER TABLE finance_import_batches ADD COLUMN source_currency TEXT;
ALTER TABLE finance_transactions ADD COLUMN external_type TEXT;
ALTER TABLE finance_transactions ADD COLUMN recurring_id TEXT REFERENCES finance_recurring(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX finance_recurring_realized ON finance_transactions(recurring_id,date) WHERE recurring_id IS NOT NULL;
CREATE TRIGGER finance_transaction_category_insert BEFORE INSERT ON finance_transactions
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance_categories WHERE id=NEW.category_id AND kind=NEW.transaction_type)
BEGIN SELECT RAISE(ABORT,'Categoria incompatível com transação'); END;
CREATE TRIGGER finance_transaction_category_update BEFORE UPDATE OF category_id,transaction_type ON finance_transactions
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance_categories WHERE id=NEW.category_id AND kind=NEW.transaction_type)
BEGIN SELECT RAISE(ABORT,'Categoria incompatível com transação'); END;
CREATE TRIGGER finance_category_kind_update BEFORE UPDATE OF kind ON finance_categories
WHEN NEW.kind<>OLD.kind AND (EXISTS(SELECT 1 FROM finance_transactions WHERE category_id=OLD.id)
 OR EXISTS(SELECT 1 FROM finance_rules WHERE category_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'Categoria em uso não pode mudar de tipo'); END;
DROP TRIGGER finance_import_rows;
CREATE TRIGGER finance_import_rows AFTER INSERT ON finance_import_batches
BEGIN
 INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,
  description,normalized_description,category_id,notes,source,external_id,check_number,
  external_type,import_batch_id,created_at,updated_at)
 SELECT json_extract(j.value,'$.id'),NEW.account_id,json_extract(j.value,'$.date'),
  json_extract(j.value,'$.amount_cents'),json_extract(j.value,'$.transaction_type'),
  json_extract(j.value,'$.description'),json_extract(j.value,'$.normalized_description'),
  json_extract(j.value,'$.category_id'),json_extract(j.value,'$.notes'),'ofx',
  json_extract(j.value,'$.external_id'),json_extract(j.value,'$.check_number'),
  json_extract(j.value,'$.external_type'),NEW.id,NEW.imported_at,NEW.imported_at
 FROM json_each(NEW.payload_json) j;
 UPDATE finance_import_batches SET payload_json='[]' WHERE id=NEW.id;
END;
