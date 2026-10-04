CREATE TABLE objective_milestones (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=2000),
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','completed')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order>=0),
  mode TEXT NOT NULL DEFAULT 'manual' CHECK(mode IN('manual','financial_goal')),
  target_value REAL CHECK(target_value IS NULL OR (target_value>0 AND target_value<1000000000)),
  unit TEXT NOT NULL DEFAULT '' CHECK(length(unit)<=40),
  financial_goal_id TEXT REFERENCES finance_goals(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(mode='manual' OR (target_value IS NOT NULL AND unit='BRL')),
  CHECK(target_date IS NULL OR (length(target_date)=10 AND date(target_date)=target_date))
);
CREATE INDEX objective_milestones_order ON objective_milestones(objective_id,sort_order,id);
CREATE INDEX objective_milestones_status ON objective_milestones(status,completed_at);
CREATE INDEX objective_milestones_deadline ON objective_milestones(target_date) WHERE target_date IS NOT NULL;
CREATE INDEX objective_milestones_financial ON objective_milestones(financial_goal_id) WHERE financial_goal_id IS NOT NULL;
CREATE TRIGGER milestone_created_completed AFTER INSERT ON objective_milestones WHEN NEW.mode='manual' AND NEW.status='completed' BEGIN
  INSERT INTO automation_events(id,trigger_type,entity_type,entity_id,created_at,depth)
  VALUES(lower(hex(randomblob(16))),'milestone_completed','milestone',NEW.id,NEW.updated_at,0);
END;
CREATE TRIGGER milestone_completed_event AFTER UPDATE OF status ON objective_milestones WHEN NEW.mode='manual' AND OLD.status!='completed' AND NEW.status='completed' BEGIN
  INSERT INTO automation_events(id,trigger_type,entity_type,entity_id,created_at,depth)
  VALUES(lower(hex(randomblob(16))),'milestone_completed','milestone',NEW.id,NEW.updated_at,0);
END;

CREATE TABLE monthly_review_notes (
  month_start TEXT PRIMARY KEY CHECK(length(month_start)=10 AND date(month_start)=month_start AND substr(month_start,9,2)='01'),
  content TEXT NOT NULL CHECK(length(content)<=8000),
  updated_at TEXT NOT NULL
);

-- Preserve every existing preference while adding one temporal source.
ALTER TABLE calendar_source_preferences RENAME TO calendar_sources_before_milestones;
CREATE TABLE calendar_source_preferences (
  source_type TEXT PRIMARY KEY CHECK(source_type IN('task','project','objective','habit','routine','workout','block','milestone')),
  visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN(0,1))
);
INSERT INTO calendar_source_preferences SELECT * FROM calendar_sources_before_milestones;
INSERT INTO calendar_source_preferences VALUES('milestone',1);
DROP TABLE calendar_sources_before_milestones;
ALTER TABLE calendar_visibility_overrides RENAME TO calendar_overrides_before_milestones;
CREATE TABLE calendar_visibility_overrides (
  entity_type TEXT NOT NULL CHECK(entity_type IN('task','project','objective','habit','routine','workout','block','milestone')),
  entity_id TEXT NOT NULL,
  visible INTEGER NOT NULL CHECK(visible IN(0,1)),
  PRIMARY KEY(entity_type,entity_id)
);
INSERT INTO calendar_visibility_overrides SELECT * FROM calendar_overrides_before_milestones;
DROP TABLE calendar_overrides_before_milestones;
CREATE TRIGGER milestone_visibility_delete AFTER DELETE ON objective_milestones BEGIN
  DELETE FROM calendar_visibility_overrides WHERE entity_type='milestone' AND entity_id=OLD.id;
END;
