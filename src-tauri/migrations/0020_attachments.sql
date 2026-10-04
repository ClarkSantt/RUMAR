-- Files live under the managed app data directory. SQLite stores only metadata.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('project','thought','objective','moment','finance_transaction')),
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
CREATE INDEX attachments_entity ON attachments(entity_type,entity_id,created_at);
CREATE TABLE attachment_cleanup (
  relative_path TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL
);
CREATE TRIGGER attachment_validate BEFORE INSERT ON attachments BEGIN
  SELECT CASE
    WHEN NEW.entity_type='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Projeto não encontrado')
    WHEN NEW.entity_type='thought' AND NOT EXISTS(SELECT 1 FROM thoughts WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Pensamento não encontrado')
    WHEN NEW.entity_type='objective' AND NOT EXISTS(SELECT 1 FROM objectives WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Objetivo não encontrado')
    WHEN NEW.entity_type='moment' AND NOT EXISTS(SELECT 1 FROM timeline_notes WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Momento não encontrado')
    WHEN NEW.entity_type='finance_transaction' AND NOT EXISTS(SELECT 1 FROM finance_transactions WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Transação não encontrada')
  END;
END;
CREATE TRIGGER attachment_deleted AFTER DELETE ON attachments BEGIN
  INSERT OR IGNORE INTO attachment_cleanup(relative_path,queued_at)
  VALUES(OLD.relative_path,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER attachment_project_deleted AFTER DELETE ON projects BEGIN
  DELETE FROM attachments WHERE entity_type='project' AND entity_id=OLD.id;
END;
CREATE TRIGGER attachment_thought_deleted AFTER DELETE ON thoughts BEGIN
  DELETE FROM attachments WHERE entity_type='thought' AND entity_id=OLD.id;
END;
CREATE TRIGGER attachment_objective_deleted AFTER DELETE ON objectives BEGIN
  DELETE FROM attachments WHERE entity_type='objective' AND entity_id=OLD.id;
END;
CREATE TRIGGER attachment_moment_deleted AFTER DELETE ON timeline_notes BEGIN
  DELETE FROM attachments WHERE entity_type='moment' AND entity_id=OLD.id;
END;
CREATE TRIGGER attachment_finance_deleted AFTER DELETE ON finance_transactions BEGIN
  DELETE FROM attachments WHERE entity_type='finance_transaction' AND entity_id=OLD.id;
END;
