CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO settings VALUES ('name', 'Gustavo', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO settings VALUES ('theme', 'system', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL CHECK(length(trim(content)) > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  due_date TEXT,
  due_time TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
  recurrence TEXT CHECK(recurrence IS NULL OR json_valid(recurrence)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  archived_at TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  source_inbox_id TEXT UNIQUE REFERENCES inbox_items(id),
  CHECK(recurrence IS NULL OR (due_date IS NOT NULL AND status = 'pending'))
);
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE task_completions (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY(task_id, occurrence_date)
);
CREATE TABLE subtask_completions (
  subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY(subtask_id, occurrence_date)
);
CREATE INDEX tasks_due_status ON tasks(due_date, status) WHERE archived_at IS NULL;
CREATE INDEX tasks_status ON tasks(status) WHERE archived_at IS NULL;
CREATE INDEX tasks_recurring ON tasks(due_date) WHERE recurrence IS NOT NULL AND archived_at IS NULL;
CREATE INDEX subtasks_task ON subtasks(task_id, sort_order);
CREATE INDEX inbox_status ON inbox_items(status, created_at);
CREATE INDEX completions_date ON task_completions(occurrence_date);

-- One INSERT creates the task and processes its source atomically, including on crashes.
CREATE TRIGGER process_inbox_after_task AFTER INSERT ON tasks
WHEN NEW.source_inbox_id IS NOT NULL
BEGIN
  UPDATE inbox_items SET status = 'processed', processed_at = NEW.created_at,
    updated_at = NEW.created_at WHERE id = NEW.source_inbox_id;
END;
