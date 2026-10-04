CREATE TABLE templates (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('task','project','routine','workout','meal')),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 description TEXT NOT NULL DEFAULT '',
 payload_version INTEGER NOT NULL DEFAULT 1 CHECK(payload_version=1),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND json_type(payload_json)='object'),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX templates_kind_name ON templates(kind,name);

-- A single insert applies a validated template in one SQLite statement. Trigger failure
-- rolls back the parent and all children, including on abrupt window closure.
CREATE TABLE template_applications (
 id TEXT PRIMARY KEY,
 template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
 applied_at TEXT NOT NULL
);
CREATE TRIGGER apply_template AFTER INSERT ON template_applications BEGIN
 INSERT INTO tasks(id,title,description,priority,due_date,due_time,recurrence,created_at,updated_at)
 SELECT NEW.id,json_extract(t.payload_json,'$.title'),COALESCE(json_extract(t.payload_json,'$.description'),''),
 COALESCE(json_extract(t.payload_json,'$.priority'),'normal'),NULL,NULL,
 json_extract(t.payload_json,'$.recurrence'),NEW.applied_at,NEW.applied_at
 FROM templates t WHERE t.id=NEW.template_id AND t.kind='task';
 INSERT INTO subtasks(id,task_id,title,sort_order,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.id,json_extract(s.value,'$.title'),CAST(s.key AS INTEGER),NEW.applied_at,NEW.applied_at
 FROM templates t,json_each(t.payload_json,'$.subtasks') s WHERE t.id=NEW.template_id AND t.kind='task';

 INSERT INTO projects(id,name,description,status,created_at,updated_at)
 SELECT NEW.id,json_extract(t.payload_json,'$.name'),COALESCE(json_extract(t.payload_json,'$.description'),''),'active',NEW.applied_at,NEW.applied_at
 FROM templates t WHERE t.id=NEW.template_id AND t.kind='project';
 INSERT INTO project_sections(id,project_id,name,sort_order,created_at,updated_at)
 SELECT NEW.id||':section:'||s.key,NEW.id,json_extract(s.value,'$.name'),CAST(s.key AS INTEGER),NEW.applied_at,NEW.applied_at
 FROM templates t,json_each(t.payload_json,'$.sections') s WHERE t.id=NEW.template_id AND t.kind='project';
 INSERT INTO tasks(id,title,description,priority,project_id,project_section_id,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),json_extract(x.value,'$.title'),COALESCE(json_extract(x.value,'$.description'),''),'normal',NEW.id,
 CASE WHEN json_type(x.value,'$.sectionIndex')='integer' THEN NEW.id||':section:'||json_extract(x.value,'$.sectionIndex') ELSE NULL END,
 NEW.applied_at,NEW.applied_at
 FROM templates t,json_each(t.payload_json,'$.tasks') x WHERE t.id=NEW.template_id AND t.kind='project';

 INSERT INTO routines(id,name,description,frequency,weekdays,time_of_day,created_at,updated_at)
 SELECT NEW.id,json_extract(t.payload_json,'$.name'),COALESCE(json_extract(t.payload_json,'$.description'),''),
 COALESCE(json_extract(t.payload_json,'$.frequency'),'daily'),COALESCE(json_extract(t.payload_json,'$.weekdays'),'[]'),
 json_extract(t.payload_json,'$.time_of_day'),NEW.applied_at,NEW.applied_at
 FROM templates t WHERE t.id=NEW.template_id AND t.kind='routine';
 INSERT INTO routine_items(id,routine_id,title,sort_order,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.id,json_extract(i.value,'$.title'),CAST(i.key AS INTEGER),NEW.applied_at,NEW.applied_at
 FROM templates t,json_each(t.payload_json,'$.items') i WHERE t.id=NEW.template_id AND t.kind='routine';

 INSERT INTO workout_plans(id,name,description,active,created_at,updated_at)
 SELECT NEW.id,json_extract(t.payload_json,'$.name'),COALESCE(json_extract(t.payload_json,'$.description'),''),0,NEW.applied_at,NEW.applied_at
 FROM templates t WHERE t.id=NEW.template_id AND t.kind='workout';
 INSERT INTO workout_days(id,workout_plan_id,name,weekday,sort_order,notes,created_at,updated_at,pending_weekdays)
 SELECT NEW.id||':day:'||d.key,NEW.id,json_extract(d.value,'$.name'),NULL,CAST(d.key AS INTEGER),
 COALESCE(json_extract(d.value,'$.notes'),''),NEW.applied_at,NEW.applied_at,
 COALESCE(json_extract(d.value,'$.weekdays'),'[]')
 FROM templates t,json_each(t.payload_json,'$.days') d WHERE t.id=NEW.template_id AND t.kind='workout';
 INSERT INTO workout_day_exercises(id,workout_day_id,exercise_id,target_sets,min_reps,max_reps,rest_seconds,notes,sort_order,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.id||':day:'||d.key,json_extract(e.value,'$.exercise_id'),
 json_extract(e.value,'$.target_sets'),json_extract(e.value,'$.min_reps'),json_extract(e.value,'$.max_reps'),
 json_extract(e.value,'$.rest_seconds'),COALESCE(json_extract(e.value,'$.notes'),''),CAST(e.key AS INTEGER),NEW.applied_at,NEW.applied_at
 FROM templates t,json_each(t.payload_json,'$.days') d,json_each(d.value,'$.exercises') e
 WHERE t.id=NEW.template_id AND t.kind='workout';

 INSERT INTO meals(id,name,notes,created_at,updated_at)
 SELECT NEW.id,json_extract(t.payload_json,'$.name'),COALESCE(json_extract(t.payload_json,'$.notes'),''),NEW.applied_at,NEW.applied_at
 FROM templates t WHERE t.id=NEW.template_id AND t.kind='meal';
 INSERT INTO meal_items(id,meal_id,food_id,quantity,unit,grams_equivalent,notes,sort_order,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.id,json_extract(i.value,'$.food_id'),json_extract(i.value,'$.quantity'),
 json_extract(i.value,'$.unit'),json_extract(i.value,'$.grams_equivalent'),COALESCE(json_extract(i.value,'$.notes'),''),
 CAST(i.key AS INTEGER),NEW.applied_at,NEW.applied_at
 FROM templates t,json_each(t.payload_json,'$.items') i WHERE t.id=NEW.template_id AND t.kind='meal';
END;

CREATE TABLE template_diary_applications (
 id TEXT PRIMARY KEY,
 template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
 entry_date TEXT NOT NULL CHECK(entry_date GLOB '????-??-??'),
 applied_at TEXT NOT NULL
);
CREATE TRIGGER apply_meal_template_to_diary AFTER INSERT ON template_diary_applications BEGIN
 SELECT RAISE(ABORT,'Template não é refeição') WHERE NOT EXISTS(
   SELECT 1 FROM templates WHERE id=NEW.template_id AND kind='meal');
 SELECT RAISE(ABORT,'Alimento do template indisponível') WHERE EXISTS(
   SELECT 1 FROM templates t,json_each(t.payload_json,'$.items') i
   WHERE t.id=NEW.template_id AND t.kind='meal'
   AND NOT EXISTS(SELECT 1 FROM foods f WHERE f.id=json_extract(i.value,'$.food_id') AND f.archived_at IS NULL));
 INSERT INTO food_diary_entries(id,entry_date,meal_label,food_id,food_name,quantity,unit,
 grams_equivalent,nutrients_json,notes,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.entry_date,json_extract(t.payload_json,'$.name'),f.id,f.name,
 json_extract(i.value,'$.quantity'),json_extract(i.value,'$.unit'),json_extract(i.value,'$.grams_equivalent'),
 COALESCE((SELECT json_group_object(fn.nutrient_key,fn.amount*json_extract(i.value,'$.grams_equivalent')/f.base_grams_equivalent)
   FROM food_nutrients fn WHERE fn.food_id=f.id AND fn.amount IS NOT NULL),'{}'),
 COALESCE(json_extract(i.value,'$.notes'),''),NEW.applied_at,NEW.applied_at
 FROM templates t,json_each(t.payload_json,'$.items') i JOIN foods f ON f.id=json_extract(i.value,'$.food_id')
 WHERE t.id=NEW.template_id AND t.kind='meal';
END;

CREATE TABLE notification_preferences (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE notification_deliveries (
 delivery_key TEXT PRIMARY KEY,
 category TEXT NOT NULL,
 scheduled_for TEXT NOT NULL,
 delivered_at TEXT NOT NULL
);
CREATE INDEX notification_deliveries_time ON notification_deliveries(delivered_at);

CREATE TABLE weekly_review_notes (
 week_start TEXT PRIMARY KEY CHECK(week_start GLOB '????-??-??'),
 content TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL
);

ALTER TABLE tasks ADD COLUMN remind_minutes_before INTEGER
 CHECK(remind_minutes_before IN (0,5,15,30,60));
