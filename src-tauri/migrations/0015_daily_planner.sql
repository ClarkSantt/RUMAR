-- Local civil date/time planning stays independent from task deadlines.
CREATE TABLE planner_time_blocks (
 id TEXT PRIMARY KEY,
 block_date TEXT NOT NULL CHECK(length(block_date)=10),
 start_time TEXT NOT NULL CHECK(start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time<'24:00'),
 end_time TEXT NOT NULL CHECK((end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time<'24:00') OR end_time='24:00'),
 entity_type TEXT CHECK(entity_type IN('task','routine','workout','habit')),
 entity_id TEXT,
 occurrence_date TEXT,
 title TEXT NOT NULL DEFAULT '' CHECK(length(title)<=500),
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 remind_minutes_before INTEGER CHECK(remind_minutes_before IN(0,5,15)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(end_time>start_time),
 CHECK((entity_type IS NULL AND entity_id IS NULL AND length(trim(title))>0) OR (entity_type IS NOT NULL AND entity_id IS NOT NULL))
);
CREATE INDEX planner_blocks_date_time ON planner_time_blocks(block_date,start_time);
CREATE INDEX planner_blocks_entity ON planner_time_blocks(entity_type,entity_id);
CREATE TRIGGER planner_link_validate BEFORE INSERT ON planner_time_blocks BEGIN
 SELECT CASE
 WHEN NEW.entity_type='task' AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Task não encontrada')
 WHEN NEW.entity_type='routine' AND NOT EXISTS(SELECT 1 FROM routines WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Routine não encontrada')
 WHEN NEW.entity_type='workout' AND NOT EXISTS(SELECT 1 FROM workout_days WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Treino não encontrado')
 WHEN NEW.entity_type='habit' AND NOT EXISTS(SELECT 1 FROM habits WHERE id=NEW.entity_id) THEN RAISE(ABORT,'Habit não encontrado') END;
END;
-- Preserve the planning note if the source is permanently deleted.
CREATE TRIGGER planner_task_delete BEFORE DELETE ON tasks BEGIN
 UPDATE planner_time_blocks SET title=OLD.title,entity_type=NULL,entity_id=NULL WHERE entity_type='task' AND entity_id=OLD.id;
END;
CREATE TRIGGER planner_routine_delete BEFORE DELETE ON routines BEGIN
 UPDATE planner_time_blocks SET title=OLD.name,entity_type=NULL,entity_id=NULL WHERE entity_type='routine' AND entity_id=OLD.id;
END;
CREATE TRIGGER planner_workout_delete BEFORE DELETE ON workout_days BEGIN
 UPDATE planner_time_blocks SET title=OLD.name,entity_type=NULL,entity_id=NULL WHERE entity_type='workout' AND entity_id=OLD.id;
END;
CREATE TRIGGER planner_habit_delete BEFORE DELETE ON habits BEGIN
 UPDATE planner_time_blocks SET title=OLD.name,entity_type=NULL,entity_id=NULL WHERE entity_type='habit' AND entity_id=OLD.id;
END;
CREATE TABLE focus_sessions (
 id TEXT PRIMARY KEY,
 task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
 time_block_id TEXT REFERENCES planner_time_blocks(id) ON DELETE SET NULL,
 objective_id TEXT REFERENCES objectives(id) ON DELETE SET NULL,
 title TEXT NOT NULL,
 started_at TEXT NOT NULL, ended_at TEXT,
 focused_seconds INTEGER NOT NULL DEFAULT 0 CHECK(focused_seconds>=0),
 status TEXT NOT NULL CHECK(status IN('running','paused','completed')),
 last_checkpoint TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX focus_single_open ON focus_sessions((1)) WHERE status IN('running','paused');
CREATE INDEX focus_started ON focus_sessions(started_at);
CREATE INDEX focus_task ON focus_sessions(task_id);
CREATE INDEX focus_block ON focus_sessions(time_block_id);
CREATE INDEX focus_objective ON focus_sessions(objective_id);
CREATE TABLE planner_preferences (
 id INTEGER PRIMARY KEY CHECK(id=1),
 visual_start INTEGER NOT NULL DEFAULT 7 CHECK(visual_start BETWEEN 0 AND 23),
 visual_end INTEGER NOT NULL DEFAULT 23 CHECK(visual_end BETWEEN 1 AND 24 AND visual_end>visual_start),
 default_minutes INTEGER NOT NULL DEFAULT 30 CHECK(default_minutes IN(15,30,45,60)),
 week_start INTEGER NOT NULL DEFAULT 1 CHECK(week_start IN(0,1))
);
INSERT INTO planner_preferences(id) VALUES(1);
CREATE TABLE planner_task_actions (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, block_date TEXT NOT NULL,
 start_time TEXT NOT NULL, end_time TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER planner_task_create AFTER INSERT ON planner_task_actions BEGIN
 INSERT INTO tasks(id,title,created_at,updated_at) VALUES(NEW.id,NEW.title,NEW.created_at,NEW.created_at);
 INSERT INTO planner_time_blocks(id,block_date,start_time,end_time,entity_type,entity_id,occurrence_date,created_at,updated_at)
 VALUES(lower(hex(randomblob(16))),NEW.block_date,NEW.start_time,NEW.end_time,'task',NEW.id,NEW.block_date,NEW.created_at,NEW.created_at);
 DELETE FROM planner_task_actions WHERE id=NEW.id;
END;
CREATE TABLE calendar_source_preferences_v15 (
 source_type TEXT PRIMARY KEY CHECK(source_type IN('task','project','habit','routine','workout','objective','block')),
 visible INTEGER NOT NULL CHECK(visible IN(0,1))
);
INSERT INTO calendar_source_preferences_v15 SELECT * FROM calendar_source_preferences;
DROP TABLE calendar_source_preferences;
ALTER TABLE calendar_source_preferences_v15 RENAME TO calendar_source_preferences;
CREATE TABLE calendar_visibility_overrides_v15 (
 entity_type TEXT NOT NULL CHECK(entity_type IN('task','project','habit','routine','workout','objective','block')),
 entity_id TEXT NOT NULL,visible INTEGER NOT NULL CHECK(visible IN(0,1)),PRIMARY KEY(entity_type,entity_id)
);
INSERT INTO calendar_visibility_overrides_v15 SELECT * FROM calendar_visibility_overrides;
DROP TABLE calendar_visibility_overrides;
ALTER TABLE calendar_visibility_overrides_v15 RENAME TO calendar_visibility_overrides;
