CREATE TABLE projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0), description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','paused','completed','archived')),
 start_date TEXT, target_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 completed_at TEXT, archived_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
 delete_tasks INTEGER NOT NULL DEFAULT 0 CHECK(delete_tasks IN(0,1)),
 source_inbox_id TEXT UNIQUE REFERENCES inbox_items(id), source_thought_id TEXT UNIQUE REFERENCES thoughts(id),
 CHECK(start_date IS NULL OR target_date IS NULL OR target_date>=start_date)
);
CREATE TABLE project_sections (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(trim(name))>0), sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE thoughts (
 id TEXT PRIMARY KEY,title TEXT NOT NULL DEFAULT '',content TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,
 source_inbox_id TEXT UNIQUE REFERENCES inbox_items(id)
);
ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN project_section_id TEXT REFERENCES project_sections(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN source_thought_id TEXT REFERENCES thoughts(id);
ALTER TABLE inbox_items ADD COLUMN source_thought_id TEXT REFERENCES thoughts(id);
CREATE UNIQUE INDEX tasks_thought_source ON tasks(source_thought_id);
CREATE UNIQUE INDEX inbox_thought_source ON inbox_items(source_thought_id);
CREATE INDEX tasks_project_order ON tasks(project_id,project_section_id,sort_order);
CREATE INDEX projects_status_order ON projects(status,sort_order);
CREATE INDEX projects_target_date ON projects(target_date) WHERE archived_at IS NULL;
CREATE INDEX sections_project_order ON project_sections(project_id,sort_order);
CREATE INDEX thoughts_updated ON thoughts(updated_at DESC) WHERE archived_at IS NULL;
CREATE TRIGGER task_section_insert BEFORE INSERT ON tasks
WHEN NEW.project_section_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_sections WHERE id=NEW.project_section_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'A seção não pertence ao projeto'); END;
CREATE TRIGGER task_section_update BEFORE UPDATE OF project_id,project_section_id ON tasks
WHEN NEW.project_section_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_sections WHERE id=NEW.project_section_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'A seção não pertence ao projeto'); END;
CREATE TRIGGER project_delete_tasks BEFORE DELETE ON projects
BEGIN
 DELETE FROM tasks WHERE project_id=OLD.id AND OLD.delete_tasks=1;
 UPDATE tasks SET project_section_id=NULL,project_id=NULL WHERE project_id=OLD.id;
END;
CREATE TRIGGER project_delete_requested AFTER UPDATE OF delete_tasks ON projects WHEN NEW.delete_tasks=1
BEGIN DELETE FROM projects WHERE id=NEW.id; END;
CREATE TRIGGER process_inbox_after_project AFTER INSERT ON projects WHEN NEW.source_inbox_id IS NOT NULL
BEGIN UPDATE inbox_items SET status='processed',processed_at=NEW.created_at,updated_at=NEW.created_at WHERE id=NEW.source_inbox_id; END;
CREATE TRIGGER process_inbox_after_thought AFTER INSERT ON thoughts WHEN NEW.source_inbox_id IS NOT NULL
BEGIN UPDATE inbox_items SET status='processed',processed_at=NEW.created_at,updated_at=NEW.created_at WHERE id=NEW.source_inbox_id; END;
CREATE TABLE habits (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0), description TEXT NOT NULL DEFAULT '',
 frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekdays','weekly_target')), weekdays TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(weekdays)),
 weekly_target INTEGER NOT NULL DEFAULT 1 CHECK(weekly_target BETWEEN 1 AND 7),
 kind TEXT NOT NULL CHECK(kind IN ('boolean','quantity')), target_value REAL NOT NULL DEFAULT 1 CHECK(target_value>0), unit TEXT NOT NULL DEFAULT '',
 start_date TEXT NOT NULL, end_date TEXT, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), archived_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK(end_date IS NULL OR end_date>=start_date)
);
CREATE TABLE habit_entries (
 habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE, entry_date TEXT NOT NULL, value REAL NOT NULL CHECK(value>=0), updated_at TEXT NOT NULL,
 PRIMARY KEY(habit_id,entry_date)
);
CREATE INDEX habits_active_order ON habits(active,sort_order) WHERE archived_at IS NULL;
CREATE INDEX habits_project ON habits(project_id);
CREATE INDEX habit_entries_date ON habit_entries(entry_date);

CREATE TABLE routines (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0), description TEXT NOT NULL DEFAULT '',
 frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekdays')), weekdays TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(weekdays)),
 time_of_day TEXT, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), archived_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE routine_items (
 id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, title TEXT NOT NULL CHECK(length(trim(title))>0),
 sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE routine_occurrences (
 id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, occurrence_date TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
 UNIQUE(routine_id,occurrence_date), UNIQUE(id,routine_id)
);
CREATE TABLE routine_item_completions (
 occurrence_id TEXT NOT NULL REFERENCES routine_occurrences(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES routine_items(id) ON DELETE CASCADE,
 completed_at TEXT NOT NULL, PRIMARY KEY(occurrence_id,item_id)
);
CREATE TRIGGER routine_completion_integrity BEFORE INSERT ON routine_item_completions
WHEN NOT EXISTS(SELECT 1 FROM routine_occurrences o JOIN routine_items i ON i.routine_id=o.routine_id WHERE o.id=NEW.occurrence_id AND i.id=NEW.item_id)
BEGIN SELECT RAISE(ABORT,'Item não pertence à rotina'); END;
CREATE INDEX routines_active_order ON routines(active,sort_order) WHERE archived_at IS NULL;
CREATE INDEX routine_items_order ON routine_items(routine_id,sort_order);
CREATE INDEX routine_occurrences_date ON routine_occurrences(occurrence_date);

