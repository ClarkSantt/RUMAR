-- Additive upgrade from schema 9. Existing schedules remain visible.
CREATE TRIGGER workout_activate_insert BEFORE INSERT ON workout_plans WHEN NEW.active=1
BEGIN UPDATE workout_plans SET active=0 WHERE active=1; END;
ALTER TABLE workout_days ADD COLUMN pending_weekdays TEXT CHECK(pending_weekdays IS NULL OR json_valid(pending_weekdays));
CREATE TABLE workout_day_weekdays (
 workout_day_id TEXT NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
 weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 PRIMARY KEY(workout_day_id,weekday)
);
INSERT INTO workout_day_weekdays SELECT id,weekday FROM workout_days WHERE weekday IS NOT NULL;
CREATE TRIGGER workout_weekdays_insert AFTER INSERT ON workout_days BEGIN
 INSERT INTO workout_day_weekdays SELECT NEW.id,NEW.weekday WHERE NEW.weekday IS NOT NULL AND NEW.pending_weekdays IS NULL;
 INSERT INTO workout_day_weekdays SELECT NEW.id,value FROM json_each(NEW.pending_weekdays);
 UPDATE workout_days SET pending_weekdays=NULL WHERE id=NEW.id;
END;
CREATE TRIGGER workout_weekdays_replace AFTER UPDATE OF pending_weekdays ON workout_days
WHEN NEW.pending_weekdays IS NOT NULL BEGIN
 DELETE FROM workout_day_weekdays WHERE workout_day_id=NEW.id;
 INSERT INTO workout_day_weekdays SELECT NEW.id,value FROM json_each(NEW.pending_weekdays);
 UPDATE workout_days SET pending_weekdays=NULL WHERE id=NEW.id;
END;
CREATE TRIGGER workout_weekday_legacy AFTER UPDATE OF weekday ON workout_days
WHEN NEW.pending_weekdays IS NULL AND NEW.weekday IS NOT OLD.weekday BEGIN
 DELETE FROM workout_day_weekdays WHERE workout_day_id=NEW.id;
 INSERT INTO workout_day_weekdays SELECT NEW.id,NEW.weekday WHERE NEW.weekday IS NOT NULL;
END;
CREATE TABLE daily_activity_entries (
 entry_date TEXT PRIMARY KEY CHECK(entry_date GLOB '????-??-??'),
 steps INTEGER NOT NULL CHECK(typeof(steps)='integer' AND steps BETWEEN 0 AND 200000),
 notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE energy_profile (
 id INTEGER PRIMARY KEY CHECK(id=1), settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),updated_at TEXT NOT NULL
);
CREATE TABLE workout_day_energy (
 workout_day_id TEXT PRIMARY KEY REFERENCES workout_days(id) ON DELETE CASCADE,
 method TEXT NOT NULL CHECK(method IN('off','manual','estimated')),
 minutes REAL CHECK(minutes>0 AND minutes<=1440),met REAL CHECK(met IN(3.5,6)),
 calories REAL CHECK(calories>=0 AND calories<=20000),
 CHECK(method='off' OR (method='manual' AND calories IS NOT NULL) OR (method='estimated' AND minutes IS NOT NULL AND met IS NOT NULL))
);
CREATE TABLE workout_session_energy (
 session_id TEXT PRIMARY KEY REFERENCES workout_sessions(id) ON DELETE CASCADE,
 method TEXT NOT NULL CHECK(method IN('off','manual','estimated')),
 minutes REAL CHECK(minutes>0 AND minutes<=1440),met REAL CHECK(met IN(3.5,6)),
 calories REAL CHECK(calories>=0 AND calories<=20000),
 CHECK(method='off' OR (method='manual' AND calories IS NOT NULL) OR (method='estimated' AND met IS NOT NULL))
);
-- Snapshot energy configuration when starting a session; later plan edits do not rewrite history.
CREATE TRIGGER workout_energy_snapshot AFTER INSERT ON workout_sessions BEGIN
 INSERT INTO workout_session_energy(session_id,method,minutes,met,calories)
 SELECT NEW.id,method,NULL,met,calories FROM workout_day_energy WHERE workout_day_id=NEW.workout_day_id;
END;
CREATE TABLE calendar_source_preferences (
 source_type TEXT PRIMARY KEY CHECK(source_type IN('task','project','habit','routine','workout')),
 visible INTEGER NOT NULL CHECK(visible IN(0,1))
);
CREATE TABLE calendar_visibility_overrides (
 entity_type TEXT NOT NULL CHECK(entity_type IN('task','project','habit','routine','workout')),
 entity_id TEXT NOT NULL,visible INTEGER NOT NULL CHECK(visible IN(0,1)),
 PRIMARY KEY(entity_type,entity_id)
);
