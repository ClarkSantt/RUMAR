-- Objectives connect existing entities; timeline events remain derived from their source tables.
CREATE TABLE objectives (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other' CHECK(category IN('personal','health','learning','finance','professional','other')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','paused','completed','archived')),
  start_date TEXT NOT NULL,
  target_date TEXT,
  progress_mode TEXT NOT NULL DEFAULT 'none' CHECK(progress_mode IN('none','manual','project','financial_goal','body_metric')),
  progress_ref TEXT,
  manual_current REAL,
  manual_target REAL,
  manual_unit TEXT NOT NULL DEFAULT '',
  body_baseline REAL,
  body_target REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  archived_at TEXT,
  CHECK(target_date IS NULL OR target_date>=start_date),
  CHECK(manual_current IS NULL OR (manual_current>=0 AND manual_current<1000000000)),
  CHECK(manual_target IS NULL OR (manual_target>0 AND manual_target<1000000000)),
  CHECK(body_baseline IS NULL OR (body_baseline>0 AND body_baseline<1000)),
  CHECK(body_target IS NULL OR (body_target>0 AND body_target<1000))
);
CREATE INDEX objectives_status_name ON objectives(status,name);
CREATE INDEX objectives_target_date ON objectives(target_date) WHERE archived_at IS NULL;

CREATE TABLE objective_links (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN('task','project','habit','routine','workout_plan','financial_goal','thought','body_metric','activity','nutrition')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(objective_id,entity_type,entity_id)
);
CREATE INDEX objective_links_entity ON objective_links(entity_type,entity_id);
CREATE INDEX objective_links_objective ON objective_links(objective_id,entity_type);
CREATE TRIGGER objective_link_validate BEFORE INSERT ON objective_links BEGIN
  SELECT CASE
    WHEN NEW.entity_type='task' AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Task não encontrada')
    WHEN NEW.entity_type='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Project não encontrado')
    WHEN NEW.entity_type='habit' AND NOT EXISTS(SELECT 1 FROM habits WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Habit não encontrado')
    WHEN NEW.entity_type='routine' AND NOT EXISTS(SELECT 1 FROM routines WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Routine não encontrada')
    WHEN NEW.entity_type='workout_plan' AND NOT EXISTS(SELECT 1 FROM workout_plans WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Plano não encontrado')
    WHEN NEW.entity_type='financial_goal' AND NOT EXISTS(SELECT 1 FROM finance_goals WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Meta financeira não encontrada')
    WHEN NEW.entity_type='thought' AND NOT EXISTS(SELECT 1 FROM thoughts WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Thought não encontrado')
    WHEN NEW.entity_type='body_metric' AND NEW.entity_id NOT IN('weight','body_fat','neck','shoulders','chest','waist','abdomen','hips','left_arm','right_arm','left_forearm','right_forearm','left_thigh','right_thigh','left_calf','right_calf') THEN RAISE(ABORT,'Métrica corporal inválida')
    WHEN NEW.entity_type='activity' AND NEW.entity_id<>'steps' THEN RAISE(ABORT,'Atividade inválida')
    WHEN NEW.entity_type='nutrition' AND NEW.entity_id<>'diary' THEN RAISE(ABORT,'Fonte nutricional inválida')
  END;
END;
CREATE TRIGGER objective_link_task_delete AFTER DELETE ON tasks BEGIN DELETE FROM objective_links WHERE entity_type='task' AND entity_id=OLD.id; END;
CREATE TRIGGER objective_link_project_delete AFTER DELETE ON projects BEGIN DELETE FROM objective_links WHERE entity_type='project' AND entity_id=OLD.id; END;
CREATE TRIGGER objective_link_habit_delete AFTER DELETE ON habits BEGIN DELETE FROM objective_links WHERE entity_type='habit' AND entity_id=OLD.id; END;
CREATE TRIGGER objective_link_routine_delete AFTER DELETE ON routines BEGIN DELETE FROM objective_links WHERE entity_type='routine' AND entity_id=OLD.id; END;
CREATE TRIGGER objective_link_workout_delete AFTER DELETE ON workout_plans BEGIN DELETE FROM objective_links WHERE entity_type='workout_plan' AND entity_id=OLD.id; END;
CREATE TRIGGER objective_link_financial_delete AFTER DELETE ON finance_goals BEGIN DELETE FROM objective_links WHERE entity_type='financial_goal' AND entity_id=OLD.id; END;
CREATE TRIGGER objective_link_thought_delete AFTER DELETE ON thoughts BEGIN DELETE FROM objective_links WHERE entity_type='thought' AND entity_id=OLD.id; END;

CREATE TABLE objective_updates (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX objective_updates_recent ON objective_updates(objective_id,created_at DESC);

CREATE TABLE timeline_notes (
  id TEXT PRIMARY KEY,
  event_date TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  content TEXT NOT NULL DEFAULT '',
  objective_id TEXT REFERENCES objectives(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX timeline_notes_date ON timeline_notes(event_date DESC,created_at DESC);
CREATE INDEX timeline_notes_objective ON timeline_notes(objective_id,event_date DESC);

-- The desktop SQL plugin uses a pool: a single INSERT and trigger keeps creation
-- and linking atomic without relying on BEGIN/COMMIT on separate connections.
CREATE TABLE objective_create_actions (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN('task','project','habit')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  created_at TEXT NOT NULL
);
CREATE TRIGGER objective_create_entity AFTER INSERT ON objective_create_actions BEGIN
  INSERT INTO tasks(id,title,created_at,updated_at)
    SELECT NEW.id,NEW.title,NEW.created_at,NEW.created_at WHERE NEW.entity_type='task';
  INSERT INTO projects(id,name,created_at,updated_at)
    SELECT NEW.id,NEW.title,NEW.created_at,NEW.created_at WHERE NEW.entity_type='project';
  INSERT INTO habits(id,name,frequency,kind,start_date,created_at,updated_at)
    SELECT NEW.id,NEW.title,'daily','boolean',substr(NEW.created_at,1,10),NEW.created_at,NEW.created_at WHERE NEW.entity_type='habit';
  INSERT INTO objective_links(id,objective_id,entity_type,entity_id,created_at)
    VALUES(lower(hex(randomblob(16))),NEW.objective_id,NEW.entity_type,NEW.id,NEW.created_at);
  DELETE FROM objective_create_actions WHERE id=NEW.id;
END;

-- Calendar source tables predate Objectives and have closed CHECK lists. Rebuild them
-- in this new migration, retaining every existing source and visibility override.
CREATE TABLE calendar_source_preferences_v14 (
  source_type TEXT PRIMARY KEY CHECK(source_type IN('task','project','habit','routine','workout','objective')),
  visible INTEGER NOT NULL CHECK(visible IN(0,1))
);
INSERT INTO calendar_source_preferences_v14 SELECT source_type,visible FROM calendar_source_preferences;
DROP TABLE calendar_source_preferences;
ALTER TABLE calendar_source_preferences_v14 RENAME TO calendar_source_preferences;
CREATE TABLE calendar_visibility_overrides_v14 (
  entity_type TEXT NOT NULL CHECK(entity_type IN('task','project','habit','routine','workout','objective')),
  entity_id TEXT NOT NULL,
  visible INTEGER NOT NULL CHECK(visible IN(0,1)),
  PRIMARY KEY(entity_type,entity_id)
);
INSERT INTO calendar_visibility_overrides_v14 SELECT entity_type,entity_id,visible FROM calendar_visibility_overrides;
DROP TABLE calendar_visibility_overrides;
ALTER TABLE calendar_visibility_overrides_v14 RENAME TO calendar_visibility_overrides;

INSERT INTO settings(key,value,updated_at) VALUES('timeline_private','0',datetime('now')) ON CONFLICT(key) DO NOTHING;
