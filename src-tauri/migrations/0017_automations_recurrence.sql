-- Rules are expanded only for a requested civil date interval. No future rows are seeded.
CREATE TABLE planner_time_block_series (
 id TEXT PRIMARY KEY, start_date TEXT NOT NULL CHECK(length(start_date)=10),
 start_time TEXT NOT NULL CHECK(start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time<'24:00'), end_time TEXT NOT NULL CHECK(((end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time<'24:00') OR end_time='24:00') AND end_time>start_time),
 entity_type TEXT CHECK(entity_type IN('task','routine','workout','habit')), entity_id TEXT,
 title TEXT NOT NULL DEFAULT '' CHECK(length(title)<=500), notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 remind_minutes_before INTEGER CHECK(remind_minutes_before IN(0,5,15)),
 recurrence_json TEXT NOT NULL CHECK(json_valid(recurrence_json)),
 archived_from TEXT CHECK(archived_from IS NULL OR length(archived_from)=10),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((entity_type IS NULL AND entity_id IS NULL AND length(trim(title))>0) OR (entity_type IS NOT NULL AND entity_id IS NOT NULL))
);
CREATE INDEX planner_series_period ON planner_time_block_series(start_date,archived_from);
CREATE INDEX planner_series_source ON planner_time_block_series(entity_type,entity_id);
CREATE TABLE planner_time_block_exceptions (
 series_id TEXT NOT NULL REFERENCES planner_time_block_series(id) ON DELETE CASCADE,
 occurrence_date TEXT NOT NULL CHECK(length(occurrence_date)=10),
 cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN(0,1)),
 block_date TEXT NOT NULL CHECK(length(block_date)=10), start_time TEXT NOT NULL CHECK(start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time<'24:00'), end_time TEXT NOT NULL CHECK(((end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time<'24:00') OR end_time='24:00') AND end_time>start_time),
 title TEXT NOT NULL CHECK(length(title)<=500), notes TEXT NOT NULL CHECK(length(notes)<=4000), remind_minutes_before INTEGER CHECK(remind_minutes_before IN(0,5,15)),
 updated_at TEXT NOT NULL, PRIMARY KEY(series_id,occurrence_date)
);
CREATE INDEX planner_exceptions_date ON planner_time_block_exceptions(block_date);
ALTER TABLE focus_sessions ADD COLUMN time_block_series_id TEXT REFERENCES planner_time_block_series(id) ON DELETE SET NULL;
ALTER TABLE focus_sessions ADD COLUMN time_block_series_date TEXT;
CREATE INDEX focus_series ON focus_sessions(time_block_series_id,time_block_series_date);
CREATE TRIGGER planner_series_link_validate BEFORE INSERT ON planner_time_block_series BEGIN
 SELECT CASE
 WHEN NEW.entity_type='task' AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Task não encontrada')
 WHEN NEW.entity_type='routine' AND NOT EXISTS(SELECT 1 FROM routines WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Routine não encontrada')
 WHEN NEW.entity_type='workout' AND NOT EXISTS(SELECT 1 FROM workout_days WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Treino não encontrado')
 WHEN NEW.entity_type='habit' AND NOT EXISTS(SELECT 1 FROM habits WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Habit não encontrado') END;
END;
CREATE TRIGGER planner_series_task_delete BEFORE DELETE ON tasks BEGIN
 UPDATE planner_time_block_series SET title=OLD.title,entity_type=NULL,entity_id=NULL WHERE entity_type='task' AND entity_id=OLD.id;
END;
CREATE TRIGGER planner_series_routine_delete BEFORE DELETE ON routines BEGIN
 UPDATE planner_time_block_series SET title=OLD.name,entity_type=NULL,entity_id=NULL WHERE entity_type='routine' AND entity_id=OLD.id;
END;
CREATE TRIGGER planner_series_workout_delete BEFORE DELETE ON workout_days BEGIN
 UPDATE planner_time_block_series SET title=OLD.name,entity_type=NULL,entity_id=NULL WHERE entity_type='workout' AND entity_id=OLD.id;
END;
CREATE TRIGGER planner_series_habit_delete BEFORE DELETE ON habits BEGIN
 UPDATE planner_time_block_series SET title=OLD.name,entity_type=NULL,entity_id=NULL WHERE entity_type='habit' AND entity_id=OLD.id;
END;

-- Rules are allow-listed internal actions, never executable scripts.
CREATE TABLE automation_rules (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 trigger_type TEXT NOT NULL CHECK(trigger_type IN('schedule','task_created','task_completed','task_due','task_overdue','objective_created','objective_completed','milestone_completed','objective_due','finance_due','goal_contribution','workout_completed','weight_recorded','measurement_recorded','focus_completed')),
 trigger_config TEXT NOT NULL CHECK(json_valid(trigger_config)),
 conditions TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(conditions)),
 action_type TEXT NOT NULL CHECK(action_type IN('task','notification','moment','link')),
 action_config TEXT NOT NULL CHECK(json_valid(action_config)),
 missed_policy TEXT NOT NULL DEFAULT 'ignore' CHECK(missed_policy IN('ignore','latest')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX automation_rules_enabled_trigger ON automation_rules(enabled,trigger_type);
CREATE TABLE automation_events (
 id TEXT PRIMARY KEY, trigger_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 project_id TEXT, created_at TEXT NOT NULL, depth INTEGER NOT NULL DEFAULT 0 CHECK(depth BETWEEN 0 AND 3)
);
CREATE INDEX automation_events_time_trigger ON automation_events(created_at,trigger_type);
CREATE TABLE automation_executions (
 id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
 occurrence_key TEXT NOT NULL, scheduled_for TEXT NOT NULL, executed_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('done','ignored','failed')), reason TEXT NOT NULL DEFAULT '',
 action_type TEXT NOT NULL CHECK(action_type IN('task','notification','moment','link')),
 action_config TEXT NOT NULL CHECK(json_valid(action_config)),
 entity_type TEXT, entity_id TEXT, depth INTEGER NOT NULL DEFAULT 0 CHECK(depth BETWEEN 0 AND 3),
 UNIQUE(automation_id,occurrence_key)
);
CREATE INDEX automation_executions_rule_time ON automation_executions(automation_id,executed_at DESC);
CREATE INDEX automation_executions_scheduled ON automation_executions(scheduled_for,status);
CREATE TABLE automation_origins (
 entity_id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE, depth INTEGER NOT NULL CHECK(depth BETWEEN 1 AND 3)
);
CREATE TABLE automation_notification_queue (
 execution_id TEXT PRIMARY KEY REFERENCES automation_executions(id) ON DELETE CASCADE,
 title TEXT NOT NULL, created_at TEXT NOT NULL
);
-- Claim plus effect is a single SQLite statement, safe with the plugin pool.
CREATE TRIGGER automation_apply AFTER INSERT ON automation_executions WHEN NEW.status='done' BEGIN
 SELECT CASE WHEN NEW.depth>=3 THEN RAISE(ABORT,'Limite de encadeamento') END;
 INSERT INTO automation_origins(entity_id,execution_id,depth) SELECT NEW.id,NEW.id,NEW.depth+1 WHERE NEW.action_type='task';
 INSERT INTO tasks(id,title,description,created_at,updated_at)
 SELECT NEW.id,json_extract(NEW.action_config,'$.title'),coalesce(json_extract(NEW.action_config,'$.description'),''),NEW.executed_at,NEW.executed_at WHERE NEW.action_type='task';
 INSERT INTO timeline_notes(id,event_date,title,content,objective_id,created_at,updated_at)
 SELECT NEW.id,date(NEW.executed_at,'localtime'),json_extract(NEW.action_config,'$.title'),'',json_extract(NEW.action_config,'$.objective_id'),NEW.executed_at,NEW.executed_at WHERE NEW.action_type='moment';
 INSERT INTO objective_links(id,objective_id,entity_type,entity_id,created_at)
 SELECT NEW.id,json_extract(NEW.action_config,'$.objective_id'),NEW.entity_type,NEW.entity_id,NEW.executed_at WHERE NEW.action_type='link'
 ON CONFLICT(objective_id,entity_type,entity_id) DO NOTHING;
 INSERT INTO automation_notification_queue(execution_id,title,created_at)
 SELECT NEW.id,json_extract(NEW.action_config,'$.title'),NEW.executed_at WHERE NEW.action_type='notification';
END;
CREATE TRIGGER automation_task_created AFTER INSERT ON tasks BEGIN
 INSERT INTO automation_events VALUES(lower(hex(randomblob(16))),'task_created','task',NEW.id,NEW.project_id,NEW.created_at,coalesce((SELECT depth FROM automation_origins WHERE entity_id=NEW.id),0));
END;
CREATE TRIGGER automation_task_completed AFTER UPDATE OF status ON tasks WHEN NEW.status='completed' AND OLD.status<>'completed' BEGIN
 INSERT INTO automation_events VALUES(lower(hex(randomblob(16))),'task_completed','task',NEW.id,NEW.project_id,coalesce(NEW.completed_at,NEW.updated_at),0);
END;
CREATE TRIGGER automation_task_occurrence AFTER INSERT ON task_completions BEGIN
 INSERT INTO automation_events VALUES(lower(hex(randomblob(16))),'task_completed','task',NEW.task_id,(SELECT project_id FROM tasks WHERE id=NEW.task_id),NEW.completed_at,0);
END;
CREATE TRIGGER automation_objective_created AFTER INSERT ON objectives BEGIN
 INSERT INTO automation_events VALUES(lower(hex(randomblob(16))),'objective_created','objective',NEW.id,NULL,NEW.created_at,0);
END;
CREATE TRIGGER automation_objective_completed AFTER UPDATE OF status ON objectives WHEN NEW.status='completed' AND OLD.status<>'completed' BEGIN
 INSERT INTO automation_events VALUES(lower(hex(randomblob(16))),'objective_completed','objective',NEW.id,NULL,NEW.updated_at,0);
END;
CREATE TRIGGER automation_workout_completed AFTER UPDATE OF status ON workout_sessions WHEN NEW.status='completed' AND OLD.status<>'completed' BEGIN
 INSERT INTO automation_events VALUES(lower(hex(randomblob(16))),'workout_completed','workout_plan',coalesce(NEW.workout_plan_id,NEW.id),NULL,coalesce(NEW.finished_at,NEW.started_at),0);
END;
CREATE TRIGGER automation_focus_completed AFTER UPDATE OF status ON focus_sessions WHEN NEW.status='completed' AND OLD.status<>'completed' BEGIN
 INSERT INTO automation_events VALUES(lower(hex(randomblob(16))),'focus_completed','focus',NEW.id,NULL,NEW.ended_at,0);
END;
CREATE TRIGGER automation_goal_contribution AFTER INSERT ON finance_goal_contributions BEGIN
 INSERT INTO automation_events VALUES(lower(hex(randomblob(16))),'goal_contribution','financial_goal',NEW.goal_id,NULL,NEW.created_at,0);
END;
CREATE TRIGGER automation_body_recorded AFTER INSERT ON body_measurement_values BEGIN
 INSERT INTO automation_events VALUES(lower(hex(randomblob(16))),CASE WHEN NEW.metric_key='weight' THEN 'weight_recorded' ELSE 'measurement_recorded' END,'body_metric',NEW.metric_key,NULL,NEW.created_at,0);
END;
