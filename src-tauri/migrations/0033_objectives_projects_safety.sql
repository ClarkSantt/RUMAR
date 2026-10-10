-- Phase 5 extends objectives and adds reversible deletion without changing published history.

ALTER TABLE objectives ADD COLUMN objective_kind TEXT NOT NULL DEFAULT 'objective'
  CHECK(objective_kind IN('objective','wish'));
ALTER TABLE objectives ADD COLUMN horizon TEXT NOT NULL DEFAULT 'none'
  CHECK(horizon IN('long_term','year','quarter','month','week','none'));
ALTER TABLE objectives ADD COLUMN horizon_label TEXT NOT NULL DEFAULT '' CHECK(length(horizon_label)<=80);
ALTER TABLE objectives ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK(lifecycle_status IN('active','completed','paused','cancelled','archived'));
ALTER TABLE objectives ADD COLUMN progress_strategy TEXT NOT NULL DEFAULT 'none'
  CHECK(progress_strategy IN('none','manual','tasks','projects','habits','numeric','financial_goal'));
ALTER TABLE objectives ADD COLUMN progress_direction TEXT NOT NULL DEFAULT 'increase'
  CHECK(progress_direction IN('increase','decrease'));
ALTER TABLE objectives ADD COLUMN numeric_start REAL;
ALTER TABLE objectives ADD COLUMN numeric_current REAL;
ALTER TABLE objectives ADD COLUMN numeric_target REAL;
ALTER TABLE objectives ADD COLUMN numeric_unit TEXT NOT NULL DEFAULT '' CHECK(length(numeric_unit)<=40);
ALTER TABLE objectives ADD COLUMN next_step TEXT NOT NULL DEFAULT '' CHECK(length(next_step)<=500);
ALTER TABLE objectives ADD COLUMN deleted_at TEXT;

UPDATE objectives SET lifecycle_status=status;
UPDATE objectives SET progress_strategy=CASE progress_mode
  WHEN 'manual' THEN 'manual'
  WHEN 'project' THEN 'projects'
  WHEN 'financial_goal' THEN 'financial_goal'
  WHEN 'body_metric' THEN 'numeric'
  ELSE 'none' END;
UPDATE objectives SET numeric_start=body_baseline,numeric_target=body_target,
  numeric_unit=CASE WHEN progress_mode='body_metric' THEN progress_ref ELSE '' END,
  progress_direction=CASE WHEN body_target<body_baseline THEN 'decrease' ELSE 'increase' END
WHERE progress_mode='body_metric';
CREATE INDEX objectives_kind_status ON objectives(objective_kind,lifecycle_status,updated_at DESC);
CREATE INDEX objectives_deleted ON objectives(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE objective_wishes (
  objective_id TEXT PRIMARY KEY REFERENCES objectives(id) ON DELETE CASCADE,
  product_url TEXT NOT NULL DEFAULT '' CHECK(length(product_url)<=2048),
  current_price_cents INTEGER CHECK(current_price_cents IS NULL OR current_price_cents>=0),
  target_price_cents INTEGER NOT NULL CHECK(target_price_cents>0),
  original_price_cents INTEGER CHECK(original_price_cents IS NULL OR original_price_cents>=0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK(length(currency)=3),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN('low','normal','high')),
  desired_date TEXT,
  category TEXT NOT NULL DEFAULT '' CHECK(length(category)<=80),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
  status TEXT NOT NULL DEFAULT 'wanted' CHECK(status IN('wanted','saving','purchased','abandoned','archived')),
  finance_goal_id TEXT REFERENCES finance_goals(id) ON DELETE SET NULL,
  purchase_transaction_id TEXT REFERENCES finance_transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(desired_date IS NULL OR (length(desired_date)=10 AND date(desired_date)=desired_date))
);
CREATE INDEX objective_wishes_status ON objective_wishes(status,priority,desired_date);
CREATE INDEX objective_wishes_finance ON objective_wishes(finance_goal_id) WHERE finance_goal_id IS NOT NULL;

ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
ALTER TABLE projects ADD COLUMN deleted_at TEXT;
ALTER TABLE projects ADD COLUMN trash_tasks INTEGER NOT NULL DEFAULT 0 CHECK(trash_tasks IN(0,1));
ALTER TABLE thoughts ADD COLUMN deleted_at TEXT;
CREATE INDEX tasks_deleted ON tasks(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX projects_deleted ON projects(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX thoughts_deleted ON thoughts(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER project_soft_delete_tasks AFTER UPDATE OF deleted_at ON projects
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NEW.trash_tasks=1 BEGIN
 UPDATE tasks SET deleted_at=NEW.deleted_at,updated_at=NEW.deleted_at
 WHERE project_id=NEW.id AND deleted_at IS NULL;
 UPDATE projects SET trash_tasks=0 WHERE id=NEW.id;
END;
CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  predecessor_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id,predecessor_id),
  CHECK(task_id<>predecessor_id)
);
CREATE INDEX task_dependencies_predecessor ON task_dependencies(predecessor_id,task_id);

CREATE TABLE project_dependencies (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessor_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,predecessor_id),
  CHECK(project_id<>predecessor_id)
);
CREATE INDEX project_dependencies_predecessor ON project_dependencies(predecessor_id,project_id);

CREATE TABLE project_blockers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX project_blockers_project ON project_blockers(project_id,resolved_at,created_at DESC);

CREATE TABLE entity_versions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN('thought','project','objective')),
  entity_id TEXT NOT NULL,
  changed_fields TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  created_at TEXT NOT NULL
);
CREATE INDEX entity_versions_entity ON entity_versions(entity_type,entity_id,created_at DESC,id DESC);

CREATE TRIGGER version_thought BEFORE UPDATE OF title,content ON thoughts
WHEN (NEW.title<>OLD.title OR NEW.content<>OLD.content)
 AND NOT EXISTS(SELECT 1 FROM entity_versions v WHERE v.entity_type='thought' AND v.entity_id=OLD.id
  AND julianday(v.created_at)>=julianday(NEW.updated_at)-(5.0/1440.0)) BEGIN
 INSERT INTO entity_versions VALUES(lower(hex(randomblob(16))),'thought',OLD.id,
  trim(CASE WHEN NEW.title<>OLD.title THEN 'title ' ELSE '' END||CASE WHEN NEW.content<>OLD.content THEN 'content' ELSE '' END),
  json_object('title',OLD.title,'content',OLD.content),NEW.updated_at);
END;

CREATE TRIGGER version_project BEFORE UPDATE OF name,description,start_date,target_date ON projects
WHEN NEW.name<>OLD.name OR NEW.description<>OLD.description OR NEW.start_date IS NOT OLD.start_date OR NEW.target_date IS NOT OLD.target_date BEGIN
 INSERT INTO entity_versions VALUES(lower(hex(randomblob(16))),'project',OLD.id,
  trim(CASE WHEN NEW.name<>OLD.name THEN 'name ' ELSE '' END||
   CASE WHEN NEW.description<>OLD.description THEN 'description ' ELSE '' END||
   CASE WHEN NEW.start_date IS NOT OLD.start_date THEN 'start_date ' ELSE '' END||
   CASE WHEN NEW.target_date IS NOT OLD.target_date THEN 'target_date' ELSE '' END),
  json_object('name',OLD.name,'description',OLD.description,'start_date',OLD.start_date,'target_date',OLD.target_date),NEW.updated_at);
END;

CREATE TRIGGER version_objective BEFORE UPDATE OF name,description,horizon,horizon_label,target_date,progress_strategy,progress_direction,numeric_start,numeric_current,numeric_target,numeric_unit ON objectives
WHEN NEW.name<>OLD.name OR NEW.description<>OLD.description OR NEW.horizon<>OLD.horizon OR NEW.horizon_label<>OLD.horizon_label OR NEW.target_date IS NOT OLD.target_date OR NEW.progress_strategy<>OLD.progress_strategy OR NEW.progress_direction<>OLD.progress_direction OR NEW.numeric_start IS NOT OLD.numeric_start OR NEW.numeric_current IS NOT OLD.numeric_current OR NEW.numeric_target IS NOT OLD.numeric_target OR NEW.numeric_unit<>OLD.numeric_unit BEGIN
 INSERT INTO entity_versions VALUES(lower(hex(randomblob(16))),'objective',OLD.id,
  trim(CASE WHEN NEW.name<>OLD.name THEN 'name ' ELSE '' END||
   CASE WHEN NEW.description<>OLD.description THEN 'description ' ELSE '' END||
   CASE WHEN NEW.horizon<>OLD.horizon OR NEW.horizon_label<>OLD.horizon_label THEN 'horizon ' ELSE '' END||
   CASE WHEN NEW.target_date IS NOT OLD.target_date THEN 'target_date ' ELSE '' END||
   CASE WHEN NEW.progress_strategy<>OLD.progress_strategy OR NEW.progress_direction<>OLD.progress_direction OR
    NEW.numeric_start IS NOT OLD.numeric_start OR NEW.numeric_current IS NOT OLD.numeric_current OR
    NEW.numeric_target IS NOT OLD.numeric_target OR NEW.numeric_unit<>OLD.numeric_unit THEN 'progress' ELSE '' END),
  json_object('name',OLD.name,'description',OLD.description,'horizon',OLD.horizon,'horizon_label',OLD.horizon_label,'target_date',OLD.target_date,'progress_strategy',OLD.progress_strategy,'progress_direction',OLD.progress_direction,'numeric_start',OLD.numeric_start,'numeric_current',OLD.numeric_current,'numeric_target',OLD.numeric_target,'numeric_unit',OLD.numeric_unit),NEW.updated_at);
END;

CREATE TRIGGER activity_wish_purchased AFTER UPDATE OF status ON objective_wishes
WHEN NEW.status='purchased' AND OLD.status<>'purchased' BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(lower(hex(randomblob(16))),
  'wish.purchased:'||NEW.objective_id,'wish.purchased',NEW.updated_at,date(NEW.updated_at,'localtime'),
  'objective',NEW.objective_id,NULL,NULL,'Desejo comprado',
  coalesce((SELECT name FROM objectives WHERE id=NEW.objective_id),''),'{}',NEW.updated_at);
END;

CREATE TRIGGER activity_wish_ready AFTER INSERT ON finance_goal_contributions
WHEN EXISTS(
 SELECT 1 FROM objective_wishes w JOIN finance_goals g ON g.id=w.finance_goal_id
 WHERE g.id=NEW.goal_id AND w.status IN('wanted','saving')
  AND g.initial_amount_cents+(SELECT COALESCE(SUM(c.amount_cents),0)
    FROM finance_goal_contributions c WHERE c.goal_id=g.id)>=w.target_price_cents
) BEGIN
 INSERT OR IGNORE INTO activity_events
 SELECT lower(hex(randomblob(16))),'wish.ready:'||w.objective_id,'wish.ready',NEW.created_at,NEW.date,
  'objective',w.objective_id,NULL,NULL,'Desejo pronto para comprar',o.name,'{}',NEW.created_at
 FROM objective_wishes w JOIN objectives o ON o.id=w.objective_id JOIN finance_goals g ON g.id=w.finance_goal_id
 WHERE g.id=NEW.goal_id AND w.status IN('wanted','saving')
  AND g.initial_amount_cents+(SELECT COALESCE(SUM(c.amount_cents),0) FROM finance_goal_contributions c WHERE c.goal_id=g.id)>=w.target_price_cents;
END;

