-- Existing visibility choices are copied unchanged. Imported events default to visible.
CREATE TABLE calendar_source_preferences_v22 (
  source_type TEXT PRIMARY KEY CHECK(source_type IN('task','project','objective','habit','routine','workout','block','milestone','external')),
  visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN(0,1))
);
INSERT INTO calendar_source_preferences_v22 SELECT * FROM calendar_source_preferences;
DROP TABLE calendar_source_preferences;
ALTER TABLE calendar_source_preferences_v22 RENAME TO calendar_source_preferences;
INSERT INTO calendar_source_preferences(source_type,visible) VALUES('external',1);

DROP TRIGGER milestone_visibility_delete;
CREATE TABLE calendar_visibility_overrides_v22 (
  entity_type TEXT NOT NULL CHECK(entity_type IN('task','project','objective','habit','routine','workout','block','milestone','external')),
  entity_id TEXT NOT NULL,
  visible INTEGER NOT NULL CHECK(visible IN(0,1)),
  PRIMARY KEY(entity_type,entity_id)
);
INSERT INTO calendar_visibility_overrides_v22 SELECT * FROM calendar_visibility_overrides;
DROP TABLE calendar_visibility_overrides;
ALTER TABLE calendar_visibility_overrides_v22 RENAME TO calendar_visibility_overrides;
CREATE TRIGGER milestone_visibility_delete AFTER DELETE ON objective_milestones BEGIN
  DELETE FROM calendar_visibility_overrides WHERE entity_type='milestone' AND entity_id=OLD.id;
END;
CREATE TRIGGER external_calendar_visibility_delete AFTER DELETE ON external_calendar_events BEGIN
  DELETE FROM calendar_visibility_overrides WHERE entity_type='external' AND entity_id=OLD.id;
END;
