CREATE TABLE backup_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  frequency TEXT NOT NULL DEFAULT 'off' CHECK (frequency IN ('off', 'daily', 'weekly')),
  keep_count INTEGER NOT NULL DEFAULT 10 CHECK (keep_count BETWEEN 1 AND 50),
  last_auto_at TEXT
);
INSERT INTO backup_preferences(id) VALUES (1);
