-- Keep the sync window explicit and enqueue all additional temporal sources.
ALTER TABLE google_calendar_settings ADD COLUMN sync_horizon_days INTEGER NOT NULL DEFAULT 90 CHECK(sync_horizon_days IN(30,90,-1));

CREATE TRIGGER google_task_insert AFTER INSERT ON tasks WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('task',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_task_update AFTER UPDATE ON tasks WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('task',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_task_delete AFTER DELETE ON tasks WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('task',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_workout_insert AFTER INSERT ON workout_days WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('workout',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_workout_update AFTER UPDATE ON workout_days WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('workout',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_workout_delete AFTER DELETE ON workout_days WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('workout',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_workout_weekday_add AFTER INSERT ON workout_day_weekdays WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('workout',NEW.workout_day_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_workout_weekday_remove AFTER DELETE ON workout_day_weekdays WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('workout',OLD.workout_day_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_plan_update AFTER UPDATE OF active,archived_at ON workout_plans WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at)
 SELECT 'workout',id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM workout_days WHERE workout_plan_id=NEW.id AND 1=1
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;

CREATE TRIGGER google_objective_insert AFTER INSERT ON objectives WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('objective',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_objective_update AFTER UPDATE ON objectives WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('objective',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_objective_delete AFTER DELETE ON objectives WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('objective',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_milestone_insert AFTER INSERT ON objective_milestones WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('milestone',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_milestone_update AFTER UPDATE ON objective_milestones WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('milestone',NEW.id,NEW.updated_at,NEW.updated_at)
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
CREATE TRIGGER google_milestone_delete AFTER DELETE ON objective_milestones WHEN (SELECT state FROM google_calendar_settings WHERE id=1)='connected' BEGIN
 INSERT INTO google_calendar_sync_queue(entity_type,entity_id,created_at,updated_at) VALUES('milestone',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at;
END;
