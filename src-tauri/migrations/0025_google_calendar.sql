-- Google Calendar is an optional, one-way mirror. No OAuth secret or token belongs in SQLite.
CREATE TABLE google_calendar_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 integration_id TEXT NOT NULL UNIQUE,
 client_id TEXT NOT NULL DEFAULT '',
 calendar_id TEXT,
 calendar_name TEXT NOT NULL DEFAULT 'RUMO',
 state TEXT NOT NULL DEFAULT 'disconnected' CHECK(state IN('disconnected','connected','reconnect')),
 automatic INTEGER NOT NULL DEFAULT 1 CHECK(automatic IN(0,1)),
 sync_routines INTEGER NOT NULL DEFAULT 1 CHECK(sync_routines IN(0,1)),
 sync_time_blocks INTEGER NOT NULL DEFAULT 1 CHECK(sync_time_blocks IN(0,1)),
 sync_workouts INTEGER NOT NULL DEFAULT 0 CHECK(sync_workouts IN(0,1)),
 sync_tasks INTEGER NOT NULL DEFAULT 0 CHECK(sync_tasks IN(0,1)),
 sync_objectives INTEGER NOT NULL DEFAULT 0 CHECK(sync_objectives IN(0,1)),
 sync_milestones INTEGER NOT NULL DEFAULT 0 CHECK(sync_milestones IN(0,1)),
 untimed_mode TEXT NOT NULL DEFAULT 'skip' CHECK(untimed_mode IN('skip','all_day')),
 routine_minutes INTEGER NOT NULL DEFAULT 30 CHECK(routine_minutes BETWEEN 5 AND 240),
 delete_remote INTEGER NOT NULL DEFAULT 1 CHECK(delete_remote IN(0,1)),
 first_sync_from TEXT CHECK(first_sync_from IS NULL OR length(first_sync_from)=10),
 last_sync_at TEXT,
 updated_at TEXT NOT NULL
);
INSERT INTO google_calendar_settings(id,integration_id,updated_at)
VALUES(1,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE google_calendar_item_preferences (
 entity_type TEXT NOT NULL CHECK(entity_type IN('routine','block','block_series','workout','task','objective','milestone')),
 entity_id TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
 PRIMARY KEY(entity_type,entity_id)
);

CREATE TABLE google_calendar_event_links (
 entity_type TEXT NOT NULL CHECK(entity_type IN('routine','block','block_series','block_exception','workout','task','objective','milestone')),
 entity_id TEXT NOT NULL,
 occurrence_key TEXT NOT NULL DEFAULT '',
 google_calendar_id TEXT NOT NULL,
 google_event_id TEXT NOT NULL,
 last_synced_hash TEXT NOT NULL,
 last_synced_at TEXT NOT NULL,
 PRIMARY KEY(entity_type,entity_id,occurrence_key),
 UNIQUE(google_calendar_id,google_event_id)
);
CREATE INDEX google_links_source ON google_calendar_event_links(entity_type,entity_id);

CREATE TABLE google_calendar_sync_queue (
 entity_type TEXT NOT NULL CHECK(entity_type IN('routine','block','block_series','block_exception','workout','task','objective','milestone')),
 entity_id TEXT NOT NULL,
 occurrence_key TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','retry','error')),
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 20),
 next_attempt_at TEXT NOT NULL DEFAULT '',
 last_error_code TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(entity_type,entity_id,occurrence_key)
);
CREATE INDEX google_queue_due ON google_calendar_sync_queue(status,next_attempt_at);
CREATE TABLE google_calendar_sync_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 entity_type TEXT NOT NULL,
 entity_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN('create','update','delete','skip','error')),
 result TEXT NOT NULL CHECK(result IN('ok','retry','error')),
 error_code TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL
);
CREATE TRIGGER google_log_retention AFTER INSERT ON google_calendar_sync_log BEGIN
 DELETE FROM google_calendar_sync_log WHERE id NOT IN
 (SELECT id FROM google_calendar_sync_log ORDER BY id DESC LIMIT 500);
END;

-- Claims are coalesced per entity. The worker reads current local state after commit.
CREATE TRIGGER google_routine_insert AFTER INSERT ON routines WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at)
 VALUES('routine',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_routine_update AFTER UPDATE ON routines WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at)
 VALUES('routine',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_routine_delete AFTER DELETE ON routines WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at)
 VALUES('routine',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;

CREATE TRIGGER google_block_insert AFTER INSERT ON planner_time_blocks WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('block',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_block_update AFTER UPDATE ON planner_time_blocks WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('block',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_block_delete AFTER DELETE ON planner_time_blocks WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('block',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;

CREATE TRIGGER google_series_insert AFTER INSERT ON planner_time_block_series WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('block_series',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_series_update AFTER UPDATE ON planner_time_block_series WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('block_series',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_series_delete AFTER DELETE ON planner_time_block_series WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('block_series',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_exception_insert AFTER INSERT ON planner_time_block_exceptions WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,occurrence_key,created_at,updated_at)
 VALUES('block_exception',NEW.series_id,NEW.occurrence_date,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_exception_update AFTER UPDATE ON planner_time_block_exceptions WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,occurrence_key,created_at,updated_at)
 VALUES('block_exception',NEW.series_id,NEW.occurrence_date,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_exception_delete AFTER DELETE ON planner_time_block_exceptions WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,occurrence_key,created_at,updated_at)
 VALUES('block_exception',OLD.series_id,OLD.occurrence_date,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
