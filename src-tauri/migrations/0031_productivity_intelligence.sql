-- Phase 3 extends existing local-first domains. Published migrations 1-30 stay immutable.
ALTER TABLE inbox_items ADD COLUMN notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=4000);
ALTER TABLE inbox_items ADD COLUMN capture_type TEXT NOT NULL DEFAULT 'unclassified'
  CHECK(capture_type IN('unclassified','task','planning','thought','project','event','habit'));

CREATE TABLE inbox_conversions (
 inbox_id TEXT PRIMARY KEY REFERENCES inbox_items(id) ON DELETE CASCADE,
 target_type TEXT NOT NULL CHECK(target_type IN('task','planning','thought','project','event','habit')),
 target_id TEXT NOT NULL,
 converted_at TEXT NOT NULL,
 UNIQUE(target_type,target_id)
);
INSERT OR IGNORE INTO inbox_conversions
 SELECT source_inbox_id,'task',id,created_at FROM tasks WHERE source_inbox_id IS NOT NULL;
INSERT OR IGNORE INTO inbox_conversions
 SELECT source_inbox_id,'project',id,created_at FROM projects WHERE source_inbox_id IS NOT NULL;
INSERT OR IGNORE INTO inbox_conversions
 SELECT source_inbox_id,'thought',id,created_at FROM thoughts WHERE source_inbox_id IS NOT NULL;
UPDATE inbox_items SET capture_type=coalesce(
 (SELECT target_type FROM inbox_conversions WHERE inbox_id=inbox_items.id),'unclassified');

ALTER TABLE habits ADD COLUMN source_inbox_id TEXT REFERENCES inbox_items(id);
CREATE UNIQUE INDEX habits_source_inbox ON habits(source_inbox_id) WHERE source_inbox_id IS NOT NULL;
ALTER TABLE planner_time_blocks ADD COLUMN source_inbox_id TEXT REFERENCES inbox_items(id);
CREATE UNIQUE INDEX planning_source_inbox ON planner_time_blocks(source_inbox_id) WHERE source_inbox_id IS NOT NULL;

CREATE TRIGGER inbox_task_single BEFORE INSERT ON tasks
WHEN NEW.source_inbox_id IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM inbox_items WHERE id=NEW.source_inbox_id AND status='pending')
  OR EXISTS(SELECT 1 FROM inbox_conversions WHERE inbox_id=NEW.source_inbox_id))
BEGIN SELECT RAISE(ABORT,'Captura já processada'); END;
CREATE TRIGGER inbox_project_single BEFORE INSERT ON projects
WHEN NEW.source_inbox_id IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM inbox_items WHERE id=NEW.source_inbox_id AND status='pending')
  OR EXISTS(SELECT 1 FROM inbox_conversions WHERE inbox_id=NEW.source_inbox_id))
BEGIN SELECT RAISE(ABORT,'Captura já processada'); END;
CREATE TRIGGER inbox_thought_single BEFORE INSERT ON thoughts
WHEN NEW.source_inbox_id IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM inbox_items WHERE id=NEW.source_inbox_id AND status='pending')
  OR EXISTS(SELECT 1 FROM inbox_conversions WHERE inbox_id=NEW.source_inbox_id))
BEGIN SELECT RAISE(ABORT,'Captura já processada'); END;
CREATE TRIGGER inbox_habit_single BEFORE INSERT ON habits
WHEN NEW.source_inbox_id IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM inbox_items WHERE id=NEW.source_inbox_id AND status='pending')
  OR EXISTS(SELECT 1 FROM inbox_conversions WHERE inbox_id=NEW.source_inbox_id))
BEGIN SELECT RAISE(ABORT,'Captura já processada'); END;
CREATE TRIGGER inbox_planning_single BEFORE INSERT ON planner_time_blocks
WHEN NEW.source_inbox_id IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM inbox_items WHERE id=NEW.source_inbox_id AND status='pending')
  OR EXISTS(SELECT 1 FROM inbox_conversions WHERE inbox_id=NEW.source_inbox_id))
BEGIN SELECT RAISE(ABORT,'Captura já processada'); END;

CREATE TRIGGER inbox_task_conversion AFTER INSERT ON tasks WHEN NEW.source_inbox_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO inbox_conversions VALUES(NEW.source_inbox_id,'task',NEW.id,NEW.created_at);
END;
CREATE TRIGGER inbox_project_conversion AFTER INSERT ON projects WHEN NEW.source_inbox_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO inbox_conversions VALUES(NEW.source_inbox_id,'project',NEW.id,NEW.created_at);
END;
CREATE TRIGGER inbox_thought_conversion AFTER INSERT ON thoughts WHEN NEW.source_inbox_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO inbox_conversions VALUES(NEW.source_inbox_id,'thought',NEW.id,NEW.created_at);
END;
CREATE TRIGGER inbox_habit_conversion AFTER INSERT ON habits WHEN NEW.source_inbox_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO inbox_conversions VALUES(NEW.source_inbox_id,'habit',NEW.id,NEW.created_at);
 UPDATE inbox_items SET status='processed',capture_type='habit',processed_at=NEW.created_at,updated_at=NEW.created_at
 WHERE id=NEW.source_inbox_id AND status='pending';
END;
CREATE TRIGGER inbox_planning_conversion AFTER INSERT ON planner_time_blocks WHEN NEW.source_inbox_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO inbox_conversions VALUES(NEW.source_inbox_id,
  CASE WHEN (SELECT capture_type FROM inbox_items WHERE id=NEW.source_inbox_id)='event' THEN 'event' ELSE 'planning' END,
  NEW.id,NEW.created_at);
 UPDATE inbox_items SET status='processed',
  capture_type=CASE WHEN capture_type='event' THEN 'event' ELSE 'planning' END,
  processed_at=NEW.created_at,updated_at=NEW.created_at
 WHERE id=NEW.source_inbox_id AND status='pending';
END;

ALTER TABLE focus_sessions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX focus_project ON focus_sessions(project_id);
DROP TRIGGER activity_focus_completed;
CREATE TRIGGER activity_focus_completed AFTER UPDATE OF status ON focus_sessions
WHEN NEW.status='completed' AND OLD.status<>'completed' BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'focus.completed:'||NEW.id,'focus.completed',NEW.ended_at,
  date(NEW.ended_at,'localtime'),'focus',NEW.id,
  CASE WHEN NEW.time_block_id IS NOT NULL THEN 'planning'
       WHEN NEW.task_id IS NOT NULL THEN 'task'
       WHEN NEW.project_id IS NOT NULL THEN 'project' ELSE NULL END,
  coalesce(NEW.time_block_id,NEW.task_id,NEW.project_id),'Sessão de foco concluída',NEW.title,
  json_object('duration_seconds',NEW.focused_seconds),NEW.ended_at
 );
END;

ALTER TABLE meals ADD COLUMN kind TEXT NOT NULL DEFAULT 'meal'
  CHECK(kind IN('meal','recipe','favorite'));
ALTER TABLE meals ADD COLUMN servings REAL NOT NULL DEFAULT 1 CHECK(servings>0 AND servings<=1000);
CREATE INDEX meals_kind ON meals(kind,archived_at,name);

CREATE TABLE body_progress_photos (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 photo_date TEXT NOT NULL CHECK(photo_date GLOB '????-??-??'),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=1000),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX body_progress_photos_date ON body_progress_photos(photo_date DESC,created_at DESC);

-- Add the private photo entity to the existing managed attachment store and backup path.
DROP TRIGGER attachment_validate;
DROP TRIGGER attachment_deleted;
DROP TRIGGER attachment_project_deleted;
DROP TRIGGER attachment_thought_deleted;
DROP TRIGGER attachment_objective_deleted;
DROP TRIGGER attachment_moment_deleted;
DROP TRIGGER attachment_finance_deleted;
ALTER TABLE attachments RENAME TO attachments_v30;
CREATE TABLE attachments (
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('project','thought','objective','moment','finance_transaction','body_progress_photo')),
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
INSERT INTO attachments SELECT * FROM attachments_v30;
DROP TABLE attachments_v30;
CREATE INDEX attachments_entity ON attachments(entity_type,entity_id,created_at);
CREATE UNIQUE INDEX body_progress_photo_file ON attachments(entity_id) WHERE entity_type='body_progress_photo';
CREATE TRIGGER attachment_validate BEFORE INSERT ON attachments BEGIN
  SELECT CASE
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

CREATE TRIGGER activity_workout_personal_record AFTER UPDATE OF completed ON workout_sets
WHEN NEW.completed=1 AND OLD.completed=0 AND NEW.set_type<>'warmup' AND NEW.reps IS NOT NULL
 AND EXISTS(
  SELECT 1 FROM workout_sets p JOIN workout_sessions ps ON ps.id=p.workout_session_id
  WHERE p.exercise_id=NEW.exercise_id AND p.id<>NEW.id AND p.completed=1
   AND p.set_type<>'warmup' AND ps.status='completed'
 )
 AND (
  (NEW.load_value IS NOT NULL AND NEW.load_value>
   (SELECT max(coalesce(p.load_value,0)) FROM workout_sets p JOIN workout_sessions ps ON ps.id=p.workout_session_id
    WHERE p.exercise_id=NEW.exercise_id AND p.id<>NEW.id AND p.completed=1 AND p.set_type<>'warmup' AND ps.status='completed'))
  OR NEW.reps>
   coalesce((SELECT max(p.reps) FROM workout_sets p JOIN workout_sessions ps ON ps.id=p.workout_session_id
    WHERE p.exercise_id=NEW.exercise_id AND p.id<>NEW.id AND p.completed=1 AND p.set_type<>'warmup'
     AND ps.status='completed' AND coalesce(p.load_value,0)=coalesce(NEW.load_value,0)),0)
 ) BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'workout.personal_record:'||NEW.id,'workout.personal_record',NEW.updated_at,
  (SELECT session_date FROM workout_sessions WHERE id=NEW.workout_session_id),
  'workout',NEW.workout_session_id,'exercise',NEW.exercise_id,
  'Novo recorde de treino',coalesce((SELECT name FROM exercises WHERE id=NEW.exercise_id),'Exercício'),
  json_object('set_id',NEW.id,'reps',NEW.reps,'load',NEW.load_value,'estimate',NEW.load_value*(1.0+NEW.reps/30.0)),
  NEW.updated_at
 );
END;
