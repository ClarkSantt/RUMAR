-- Planning occurrences extend the existing calendar blocks without duplicating temporal data.
ALTER TABLE planner_time_blocks ADD COLUMN schedule_kind TEXT NOT NULL DEFAULT 'fixed'
  CHECK(schedule_kind IN('fixed','period','flexible'));
ALTER TABLE planner_time_blocks ADD COLUMN day_period TEXT
  CHECK(day_period IS NULL OR day_period IN('morning','afternoon','evening'));
ALTER TABLE planner_time_blocks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planner_time_blocks ADD COLUMN status TEXT NOT NULL DEFAULT 'planned'
  CHECK(status IN('planned','completed','skipped','cancelled'));
ALTER TABLE planner_time_blocks ADD COLUMN completed_at TEXT;
ALTER TABLE planner_time_blocks ADD COLUMN title_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE planner_time_blocks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'standalone'
  CHECK(source_type IN('standalone','task','project','habit','workout','event','template'));
ALTER TABLE planner_time_blocks ADD COLUMN source_id TEXT;

CREATE TABLE planning_templates (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name))>0 AND length(name)<=500),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 default_mode TEXT NOT NULL DEFAULT 'single' CHECK(default_mode IN('single','expanded')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 legacy_routine_id TEXT UNIQUE REFERENCES routines(id) ON DELETE SET NULL,
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 archived_at TEXT
);
CREATE TABLE planning_template_items (
 id TEXT PRIMARY KEY,
 template_id TEXT NOT NULL REFERENCES planning_templates(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(trim(title))>0 AND length(title)<=500),
 relative_minutes INTEGER CHECK(relative_minutes IS NULL OR relative_minutes BETWEEN 0 AND 1439),
 duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK(duration_minutes BETWEEN 5 AND 720),
 position INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX planning_templates_active_order ON planning_templates(active,sort_order,created_at)
  WHERE archived_at IS NULL;
CREATE INDEX planning_template_items_order ON planning_template_items(template_id,position,created_at);

INSERT INTO planning_templates(
 id,name,description,default_mode,active,legacy_routine_id,sort_order,created_at,updated_at,archived_at
)
SELECT id,name,description,'single',active,id,sort_order,created_at,updated_at,archived_at FROM routines;
INSERT INTO planning_template_items(
 id,template_id,title,position,created_at,updated_at
)
SELECT id,routine_id,title,sort_order,created_at,updated_at FROM routine_items;

UPDATE planner_time_blocks SET
 source_type=CASE entity_type
   WHEN 'task' THEN 'task'
   WHEN 'habit' THEN 'habit'
   WHEN 'workout' THEN 'workout'
   WHEN 'routine' THEN 'template'
   ELSE 'standalone' END,
 source_id=entity_id,
 title_snapshot=coalesce(nullif(title,''),
   CASE entity_type
     WHEN 'task' THEN (SELECT title FROM tasks WHERE id=entity_id)
     WHEN 'habit' THEN (SELECT name FROM habits WHERE id=entity_id)
     WHEN 'workout' THEN (SELECT name FROM workout_days WHERE id=entity_id)
     WHEN 'routine' THEN (SELECT name FROM routines WHERE id=entity_id)
   END,'');

UPDATE planner_time_blocks SET status='completed',completed_at=updated_at
WHERE entity_type='task' AND EXISTS(
 SELECT 1 FROM tasks t WHERE t.id=entity_id AND (
  (t.recurrence IS NULL AND t.status='completed') OR
  EXISTS(SELECT 1 FROM task_completions c WHERE c.task_id=t.id AND c.occurrence_date=coalesce(planner_time_blocks.occurrence_date,planner_time_blocks.block_date))
 )
);
UPDATE planner_time_blocks SET status='completed',completed_at=updated_at
WHERE entity_type='routine' AND EXISTS(
 SELECT 1 FROM routine_occurrences o WHERE o.routine_id=entity_id
 AND o.occurrence_date=coalesce(planner_time_blocks.occurrence_date,planner_time_blocks.block_date)
 AND o.completed_at IS NOT NULL
);
UPDATE planner_time_blocks SET status='completed',completed_at=updated_at
WHERE entity_type='workout' AND EXISTS(
 SELECT 1 FROM workout_sessions s WHERE s.workout_day_id=entity_id
 AND s.session_date=coalesce(planner_time_blocks.occurrence_date,planner_time_blocks.block_date)
 AND s.status='completed'
);

CREATE TABLE planning_item_checklist (
 id TEXT PRIMARY KEY,
 planning_id TEXT NOT NULL REFERENCES planner_time_blocks(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(trim(title))>0 AND length(title)<=500),
 position INTEGER NOT NULL DEFAULT 0,
 completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX planning_checklist_order ON planning_item_checklist(planning_id,position,created_at);

CREATE TABLE planning_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 planning_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN('completed','skipped','cancelled','reopened')),
 occurred_at TEXT NOT NULL,
 source_type TEXT NOT NULL,
 source_id TEXT,
 title_snapshot TEXT NOT NULL,
 plan_date TEXT NOT NULL
);
CREATE INDEX planning_history_date ON planning_history(plan_date,occurred_at);
CREATE INDEX planning_history_source ON planning_history(source_type,source_id,occurred_at);

CREATE TRIGGER planning_schedule_insert BEFORE INSERT ON planner_time_blocks BEGIN
 SELECT CASE
  WHEN NEW.schedule_kind='period' AND NEW.day_period IS NULL THEN RAISE(ABORT,'Período obrigatório')
  WHEN NEW.schedule_kind!='period' AND NEW.day_period IS NOT NULL THEN RAISE(ABORT,'Período inválido')
  WHEN NEW.source_type='standalone' AND NEW.source_id IS NOT NULL THEN RAISE(ABORT,'Origem inválida')
  WHEN NEW.source_type!='standalone' AND NEW.source_id IS NULL THEN RAISE(ABORT,'Origem obrigatória') END;
END;
CREATE TRIGGER planning_schedule_update BEFORE UPDATE OF schedule_kind,day_period,source_type,source_id ON planner_time_blocks BEGIN
 SELECT CASE
  WHEN NEW.schedule_kind='period' AND NEW.day_period IS NULL THEN RAISE(ABORT,'Período obrigatório')
  WHEN NEW.schedule_kind!='period' AND NEW.day_period IS NOT NULL THEN RAISE(ABORT,'Período inválido')
  WHEN NEW.source_type='standalone' AND NEW.source_id IS NOT NULL THEN RAISE(ABORT,'Origem inválida')
  WHEN NEW.source_type!='standalone' AND NEW.source_id IS NULL THEN RAISE(ABORT,'Origem obrigatória') END;
END;

CREATE TRIGGER planning_source_insert BEFORE INSERT ON planner_time_blocks BEGIN
 SELECT CASE
  WHEN NEW.source_type='task' AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.source_id) THEN RAISE(ABORT,'Task não encontrada')
  WHEN NEW.source_type='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.source_id) THEN RAISE(ABORT,'Project não encontrado')
  WHEN NEW.source_type='habit' AND NOT EXISTS(SELECT 1 FROM habits WHERE id=NEW.source_id) THEN RAISE(ABORT,'Habit não encontrado')
  WHEN NEW.source_type='workout' AND NOT EXISTS(SELECT 1 FROM workout_days WHERE id=NEW.source_id) THEN RAISE(ABORT,'Treino não encontrado')
  WHEN NEW.source_type='template' AND NOT EXISTS(SELECT 1 FROM planning_templates WHERE id=NEW.source_id) THEN RAISE(ABORT,'Modelo não encontrado') END;
END;
CREATE TRIGGER planning_source_update BEFORE UPDATE OF source_type,source_id ON planner_time_blocks BEGIN
 SELECT CASE
  WHEN NEW.source_type='task' AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.source_id) THEN RAISE(ABORT,'Task não encontrada')
  WHEN NEW.source_type='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.source_id) THEN RAISE(ABORT,'Project não encontrado')
  WHEN NEW.source_type='habit' AND NOT EXISTS(SELECT 1 FROM habits WHERE id=NEW.source_id) THEN RAISE(ABORT,'Habit não encontrado')
  WHEN NEW.source_type='workout' AND NOT EXISTS(SELECT 1 FROM workout_days WHERE id=NEW.source_id) THEN RAISE(ABORT,'Treino não encontrado')
  WHEN NEW.source_type='template' AND NOT EXISTS(SELECT 1 FROM planning_templates WHERE id=NEW.source_id) THEN RAISE(ABORT,'Modelo não encontrado') END;
END;

CREATE TRIGGER planning_status_history AFTER UPDATE OF status ON planner_time_blocks
WHEN NEW.status<>OLD.status BEGIN
 INSERT INTO planning_history(planning_id,event_type,occurred_at,source_type,source_id,title_snapshot,plan_date)
 VALUES(NEW.id,CASE WHEN NEW.status='planned' THEN 'reopened' ELSE NEW.status END,
   coalesce(NEW.completed_at,NEW.updated_at),NEW.source_type,NEW.source_id,
   coalesce(nullif(NEW.title_snapshot,''),nullif(NEW.title,''),'Planejamento'),NEW.block_date);
END;

CREATE TRIGGER planning_task_source_delete AFTER DELETE ON tasks BEGIN
 UPDATE planner_time_blocks SET source_type='standalone',source_id=NULL,title_snapshot=coalesce(nullif(title_snapshot,''),OLD.title)
 WHERE source_type='task' AND source_id=OLD.id;
END;
CREATE TRIGGER planning_project_source_delete AFTER DELETE ON projects BEGIN
 UPDATE planner_time_blocks SET source_type='standalone',source_id=NULL,title_snapshot=coalesce(nullif(title_snapshot,''),OLD.name)
 WHERE source_type='project' AND source_id=OLD.id;
END;
CREATE TRIGGER planning_habit_source_delete AFTER DELETE ON habits BEGIN
 UPDATE planner_time_blocks SET source_type='standalone',source_id=NULL,title_snapshot=coalesce(nullif(title_snapshot,''),OLD.name)
 WHERE source_type='habit' AND source_id=OLD.id;
END;
CREATE TRIGGER planning_workout_source_delete AFTER DELETE ON workout_days BEGIN
 UPDATE planner_time_blocks SET source_type='standalone',source_id=NULL,title_snapshot=coalesce(nullif(title_snapshot,''),OLD.name)
 WHERE source_type='workout' AND source_id=OLD.id;
END;
CREATE TRIGGER planning_template_source_delete BEFORE DELETE ON planning_templates BEGIN
 UPDATE planner_time_blocks SET source_type='standalone',source_id=NULL,title_snapshot=coalesce(nullif(title_snapshot,''),OLD.name)
 WHERE source_type='template' AND source_id=OLD.id;
END;

ALTER TABLE habits ADD COLUMN tracking_type TEXT NOT NULL DEFAULT 'check'
  CHECK(tracking_type IN('check','quantity','duration','frequency'));
UPDATE habits SET tracking_type=CASE
 WHEN frequency='weekly_target' THEN 'frequency'
 WHEN kind='quantity' AND lower(unit) IN('min','minuto','minutos','h','hora','horas') THEN 'duration'
 WHEN kind='quantity' THEN 'quantity'
 ELSE 'check' END;

CREATE TRIGGER planning_habit_progress_insert AFTER INSERT ON habit_entries
WHEN NEW.value>=(SELECT target_value FROM habits WHERE id=NEW.habit_id)
AND (SELECT COUNT(*) FROM planner_time_blocks WHERE source_type='habit' AND source_id=NEW.habit_id AND block_date=NEW.entry_date AND status='planned')=1
BEGIN
 UPDATE planner_time_blocks SET status='completed',completed_at=NEW.updated_at,updated_at=NEW.updated_at
 WHERE source_type='habit' AND source_id=NEW.habit_id AND block_date=NEW.entry_date AND status='planned';
END;
CREATE TRIGGER planning_habit_progress_update AFTER UPDATE OF value ON habit_entries
WHEN NEW.value>=(SELECT target_value FROM habits WHERE id=NEW.habit_id)
AND (SELECT COUNT(*) FROM planner_time_blocks WHERE source_type='habit' AND source_id=NEW.habit_id AND block_date=NEW.entry_date AND status='planned')=1
BEGIN
 UPDATE planner_time_blocks SET status='completed',completed_at=NEW.updated_at,updated_at=NEW.updated_at
 WHERE source_type='habit' AND source_id=NEW.habit_id AND block_date=NEW.entry_date AND status='planned';
END;

CREATE INDEX planning_items_date_position ON planner_time_blocks(block_date,schedule_kind,day_period,position,start_time);
CREATE INDEX planning_items_source ON planner_time_blocks(source_type,source_id,block_date);
CREATE INDEX planning_items_status ON planner_time_blocks(status,block_date);
