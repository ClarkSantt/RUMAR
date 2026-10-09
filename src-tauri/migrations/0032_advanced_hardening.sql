-- Phase 4 extends the existing attachment and backup foundations.
-- Published migrations 1-31 stay immutable.

ALTER TABLE backup_preferences ADD COLUMN automatic_directory TEXT NOT NULL DEFAULT '';
ALTER TABLE backup_preferences ADD COLUMN daily_keep INTEGER NOT NULL DEFAULT 7
  CHECK(daily_keep BETWEEN 1 AND 31);
ALTER TABLE backup_preferences ADD COLUMN weekly_keep INTEGER NOT NULL DEFAULT 4
  CHECK(weekly_keep BETWEEN 1 AND 12);
ALTER TABLE backup_preferences ADD COLUMN monthly_keep INTEGER NOT NULL DEFAULT 6
  CHECK(monthly_keep BETWEEN 1 AND 24);
ALTER TABLE backup_preferences ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE backup_preferences ADD COLUMN last_backup_path TEXT NOT NULL DEFAULT '';

DROP TRIGGER attachment_validate;
DROP TRIGGER attachment_deleted;
DROP TRIGGER attachment_project_deleted;
DROP TRIGGER attachment_thought_deleted;
DROP TRIGGER attachment_objective_deleted;
DROP TRIGGER attachment_moment_deleted;
DROP TRIGGER attachment_finance_deleted;
DROP TRIGGER attachment_body_photo_deleted;
DROP TRIGGER activity_body_photo_added;

ALTER TABLE attachments RENAME TO attachments_v31;
CREATE TABLE attachments (
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'task','project','thought','objective','moment','finance_transaction','body_progress_photo'
  )),
  entity_id TEXT NOT NULL,
  original_name TEXT NOT NULL CHECK(length(original_name) BETWEEN 1 AND 255),
  stored_name TEXT NOT NULL CHECK(length(stored_name) BETWEEN 1 AND 80),
  relative_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK(file_size BETWEEN 1 AND 104857600),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(relative_path='attachments/'||id||'/'||stored_name)
);
INSERT INTO attachments SELECT * FROM attachments_v31;
DROP TABLE attachments_v31;

CREATE INDEX attachments_entity ON attachments(entity_type,entity_id,created_at);
CREATE UNIQUE INDEX body_progress_photo_file ON attachments(entity_id)
  WHERE entity_type='body_progress_photo';

CREATE TRIGGER attachment_validate BEFORE INSERT ON attachments BEGIN
  SELECT CASE
    WHEN NEW.entity_type='task' AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Tarefa não encontrada')
    WHEN NEW.entity_type='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Projeto não encontrado')
    WHEN NEW.entity_type='thought' AND NOT EXISTS(SELECT 1 FROM thoughts WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Pensamento não encontrado')
    WHEN NEW.entity_type='objective' AND NOT EXISTS(SELECT 1 FROM objectives WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Objetivo não encontrado')
    WHEN NEW.entity_type='moment' AND NOT EXISTS(SELECT 1 FROM timeline_notes WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Momento não encontrado')
    WHEN NEW.entity_type='finance_transaction' AND NOT EXISTS(SELECT 1 FROM finance_transactions WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Transação não encontrada')
    WHEN NEW.entity_type='body_progress_photo' AND NOT EXISTS(SELECT 1 FROM body_progress_photos WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Foto de progresso não encontrada')
  END;
END;
CREATE TRIGGER attachment_deleted AFTER DELETE ON attachments BEGIN
  INSERT OR IGNORE INTO attachment_cleanup(relative_path,queued_at)
  VALUES(OLD.relative_path,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER attachment_task_deleted AFTER DELETE ON tasks BEGIN DELETE FROM attachments WHERE entity_type='task' AND entity_id=OLD.id; END;
CREATE TRIGGER attachment_project_deleted AFTER DELETE ON projects BEGIN DELETE FROM attachments WHERE entity_type='project' AND entity_id=OLD.id; END;
CREATE TRIGGER attachment_thought_deleted AFTER DELETE ON thoughts BEGIN DELETE FROM attachments WHERE entity_type='thought' AND entity_id=OLD.id; END;
CREATE TRIGGER attachment_objective_deleted AFTER DELETE ON objectives BEGIN DELETE FROM attachments WHERE entity_type='objective' AND entity_id=OLD.id; END;
CREATE TRIGGER attachment_moment_deleted AFTER DELETE ON timeline_notes BEGIN DELETE FROM attachments WHERE entity_type='moment' AND entity_id=OLD.id; END;
CREATE TRIGGER attachment_finance_deleted AFTER DELETE ON finance_transactions BEGIN DELETE FROM attachments WHERE entity_type='finance_transaction' AND entity_id=OLD.id; END;
CREATE TRIGGER attachment_body_photo_deleted AFTER DELETE ON body_progress_photos BEGIN DELETE FROM attachments WHERE entity_type='body_progress_photo' AND entity_id=OLD.id; END;

CREATE TRIGGER activity_body_photo_added AFTER INSERT ON attachments
WHEN NEW.entity_type='body_progress_photo' BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'body.photo_added:'||NEW.entity_id,'body.photo_added',NEW.created_at,
  coalesce((SELECT photo_date FROM body_progress_photos WHERE id=NEW.entity_id),date(NEW.created_at,'localtime')),
  'body',NEW.entity_id,NULL,NULL,'Foto de progresso adicionada','', '{}',NEW.created_at
 );
END;
