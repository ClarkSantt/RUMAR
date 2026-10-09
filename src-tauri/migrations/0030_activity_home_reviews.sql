-- Persist significant local activity without duplicating source-of-truth domain rows.
CREATE TABLE activity_events (
 id TEXT PRIMARY KEY,
 idempotency_key TEXT NOT NULL UNIQUE,
 event_type TEXT NOT NULL CHECK(length(trim(event_type))>0),
 occurred_at TEXT NOT NULL,
 event_date TEXT NOT NULL CHECK(event_date GLOB '????-??-??'),
 source_type TEXT NOT NULL CHECK(length(trim(source_type))>0),
 source_id TEXT NOT NULL,
 related_type TEXT,
 related_id TEXT,
 title TEXT NOT NULL CHECK(length(trim(title))>0),
 summary TEXT NOT NULL DEFAULT '',
 metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json) AND json_type(metadata_json)='object'),
 created_at TEXT NOT NULL
);
CREATE INDEX activity_events_time ON activity_events(occurred_at DESC,id DESC);
CREATE INDEX activity_events_date ON activity_events(event_date,occurred_at DESC);
CREATE INDEX activity_events_type ON activity_events(event_type,occurred_at DESC);
CREATE INDEX activity_events_source ON activity_events(source_type,source_id,occurred_at DESC);

CREATE TABLE weekly_review_snapshots (
 week_start TEXT PRIMARY KEY CHECK(week_start GLOB '????-??-??'),
 week_end TEXT NOT NULL CHECK(week_end GLOB '????-??-??'),
 snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='object'),
 worked_well TEXT NOT NULL DEFAULT '',
 did_not_work TEXT NOT NULL DEFAULT '',
 change_next TEXT NOT NULL DEFAULT '',
 priorities_next TEXT NOT NULL DEFAULT '',
 finalized_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);

-- A completed workout resolves one and only one matching planned occurrence.
CREATE TRIGGER activity_workout_planning AFTER UPDATE OF status ON workout_sessions
WHEN NEW.status='completed' AND OLD.status<>'completed'
 AND NEW.workout_day_id IS NOT NULL
 AND (SELECT COUNT(*) FROM planner_time_blocks
      WHERE source_type='workout' AND source_id=NEW.workout_day_id
       AND block_date=NEW.session_date AND status='planned')=1
BEGIN
 UPDATE planner_time_blocks
 SET status='completed',completed_at=NEW.finished_at,updated_at=NEW.updated_at
 WHERE source_type='workout' AND source_id=NEW.workout_day_id
  AND block_date=NEW.session_date AND status='planned';
END;

CREATE TRIGGER activity_planning_history_insert AFTER INSERT ON planning_history
WHEN NEW.event_type IN('completed','skipped') BEGIN
 INSERT OR IGNORE INTO activity_events(
  id,idempotency_key,event_type,occurred_at,event_date,source_type,source_id,
  related_type,related_id,title,summary,metadata_json,created_at
 ) VALUES(
  lower(hex(randomblob(16))),
  'planning.'||NEW.event_type||':'||NEW.planning_id||':'||NEW.id,
  'planning.'||NEW.event_type,NEW.occurred_at,NEW.plan_date,'planning',NEW.planning_id,
  CASE WHEN NEW.source_type='standalone' THEN NULL ELSE NEW.source_type END,NEW.source_id,
  CASE NEW.event_type WHEN 'completed' THEN 'Planejamento concluído' ELSE 'Planejamento pulado' END,
  NEW.title_snapshot,json_object('plan_date',NEW.plan_date),NEW.occurred_at
 );
END;

CREATE TRIGGER activity_task_completed AFTER UPDATE OF status ON tasks
WHEN NEW.status='completed' AND OLD.status<>'completed' AND NEW.recurrence IS NULL BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'task.completed:'||NEW.id||':'||NEW.completed_at,
  'task.completed',NEW.completed_at,date(NEW.completed_at,'localtime'),'task',NEW.id,
  CASE WHEN NEW.project_id IS NULL THEN NULL ELSE 'project' END,NEW.project_id,
  'Tarefa concluída',NEW.title,'{}',NEW.completed_at
 );
END;
CREATE TRIGGER activity_task_occurrence_completed AFTER INSERT ON task_completions BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'task.completed:'||NEW.task_id||':'||NEW.occurrence_date,
  'task.completed',NEW.completed_at,NEW.occurrence_date,'task',NEW.task_id,
  CASE WHEN (SELECT project_id FROM tasks WHERE id=NEW.task_id) IS NULL THEN NULL ELSE 'project' END,
  (SELECT project_id FROM tasks WHERE id=NEW.task_id),'Tarefa concluída',
  coalesce((SELECT title FROM tasks WHERE id=NEW.task_id),'Tarefa'),'{}',NEW.completed_at
 );
END;

CREATE TRIGGER activity_project_completed AFTER UPDATE OF status ON projects
WHEN NEW.status='completed' AND OLD.status<>'completed' BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'project.completed:'||NEW.id||':'||NEW.completed_at,
  'project.completed',NEW.completed_at,date(NEW.completed_at,'localtime'),'project',NEW.id,
  NULL,NULL,'Projeto concluído',NEW.name,'{}',NEW.completed_at
 );
END;

CREATE TRIGGER activity_habit_progress_insert AFTER INSERT ON habit_entries
WHEN NEW.value>0 AND NOT EXISTS(
 SELECT 1 FROM activity_events WHERE idempotency_key=
  'habit:'||NEW.habit_id||':'||NEW.entry_date||':'||
   CASE WHEN NEW.value>=(SELECT target_value FROM habits WHERE id=NEW.habit_id)
        THEN 'completed' ELSE 'progress:'||printf('%g',NEW.value) END
) BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),
  'habit:'||NEW.habit_id||':'||NEW.entry_date||':'||
   CASE WHEN NEW.value>=(SELECT target_value FROM habits WHERE id=NEW.habit_id)
        THEN 'completed' ELSE 'progress:'||printf('%g',NEW.value) END,
  CASE WHEN NEW.value>=(SELECT target_value FROM habits WHERE id=NEW.habit_id)
       THEN 'habit.completed' ELSE 'habit.progress' END,
  NEW.updated_at,NEW.entry_date,'habit',NEW.habit_id,NULL,NULL,
  CASE WHEN NEW.value>=(SELECT target_value FROM habits WHERE id=NEW.habit_id)
       THEN 'Hábito concluído' ELSE 'Progresso de hábito' END,
  coalesce((SELECT name FROM habits WHERE id=NEW.habit_id),'Hábito'),
  json_object('value',NEW.value,'target',(SELECT target_value FROM habits WHERE id=NEW.habit_id),
              'unit',coalesce((SELECT unit FROM habits WHERE id=NEW.habit_id),'')),NEW.updated_at
 );
END;
CREATE TRIGGER activity_habit_progress_update AFTER UPDATE OF value ON habit_entries
WHEN NEW.value>0 AND NEW.value<>OLD.value AND NOT EXISTS(
 SELECT 1 FROM activity_events WHERE idempotency_key=
  'habit:'||NEW.habit_id||':'||NEW.entry_date||':'||
   CASE WHEN NEW.value>=(SELECT target_value FROM habits WHERE id=NEW.habit_id)
        THEN 'completed' ELSE 'progress:'||printf('%g',NEW.value) END
) BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),
  'habit:'||NEW.habit_id||':'||NEW.entry_date||':'||
   CASE WHEN NEW.value>=(SELECT target_value FROM habits WHERE id=NEW.habit_id)
        THEN 'completed' ELSE 'progress:'||printf('%g',NEW.value) END,
  CASE WHEN NEW.value>=(SELECT target_value FROM habits WHERE id=NEW.habit_id)
       THEN 'habit.completed' ELSE 'habit.progress' END,
  NEW.updated_at,NEW.entry_date,'habit',NEW.habit_id,NULL,NULL,
  CASE WHEN NEW.value>=(SELECT target_value FROM habits WHERE id=NEW.habit_id)
       THEN 'Hábito concluído' ELSE 'Progresso de hábito' END,
  coalesce((SELECT name FROM habits WHERE id=NEW.habit_id),'Hábito'),
  json_object('value',NEW.value,'target',(SELECT target_value FROM habits WHERE id=NEW.habit_id),
              'unit',coalesce((SELECT unit FROM habits WHERE id=NEW.habit_id),'')),NEW.updated_at
 );
END;

CREATE TRIGGER activity_workout_completed AFTER UPDATE OF status ON workout_sessions
WHEN NEW.status='completed' AND OLD.status<>'completed' BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'workout.completed:'||NEW.id,'workout.completed',
  NEW.finished_at,NEW.session_date,'workout',NEW.id,
  CASE WHEN NEW.workout_day_id IS NULL THEN NULL ELSE 'workout_day' END,NEW.workout_day_id,
  'Treino '||NEW.day_name||' concluído',NEW.plan_name,
  json_object('duration_seconds',max(0,CAST((julianday(NEW.finished_at)-julianday(NEW.started_at))*86400 AS INTEGER))),
  NEW.finished_at
 );
END;

CREATE TRIGGER activity_nutrition_logged AFTER INSERT ON food_diary_entries BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'nutrition.meal_logged:'||NEW.entry_date||':'||lower(trim(NEW.meal_label)),
  'nutrition.meal_logged',NEW.created_at,NEW.entry_date,'nutrition',NEW.entry_date||':'||NEW.meal_label,
  NULL,NULL,'Refeição registrada',NEW.meal_label,'{}',NEW.created_at
 );
END;

CREATE TRIGGER activity_body_value_insert AFTER INSERT ON body_measurement_values
WHEN NOT EXISTS(
 SELECT 1 FROM activity_events WHERE idempotency_key=
  (CASE WHEN NEW.metric_key='weight' THEN 'body.weight_logged:' ELSE 'body.measurement_logged:' END||NEW.record_date)
) BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),
  CASE WHEN NEW.metric_key='weight' THEN 'body.weight_logged:' ELSE 'body.measurement_logged:' END||NEW.record_date,
  CASE WHEN NEW.metric_key='weight' THEN 'body.weight_logged' ELSE 'body.measurement_logged' END,
  NEW.created_at,NEW.record_date,'body',NEW.record_date,NULL,NULL,
  CASE WHEN NEW.metric_key='weight' THEN 'Peso registrado' ELSE 'Medidas corporais registradas' END,
  'Registro corporal atualizado','{}',NEW.created_at
 );
END;
CREATE TRIGGER activity_body_value_update AFTER UPDATE OF value ON body_measurement_values
WHEN NEW.value<>OLD.value AND NOT EXISTS(
 SELECT 1 FROM activity_events WHERE idempotency_key=
  (CASE WHEN NEW.metric_key='weight' THEN 'body.weight_logged:' ELSE 'body.measurement_logged:' END||NEW.record_date)
) BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),
  CASE WHEN NEW.metric_key='weight' THEN 'body.weight_logged:' ELSE 'body.measurement_logged:' END||NEW.record_date,
  CASE WHEN NEW.metric_key='weight' THEN 'body.weight_logged' ELSE 'body.measurement_logged' END,
  NEW.updated_at,NEW.record_date,'body',NEW.record_date,NULL,NULL,
  CASE WHEN NEW.metric_key='weight' THEN 'Peso registrado' ELSE 'Medidas corporais registradas' END,
  'Registro corporal atualizado','{}',NEW.updated_at
 );
END;

CREATE TRIGGER activity_finance_transaction AFTER INSERT ON finance_transactions BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'finance.transaction_created:'||NEW.id,'finance.transaction_created',
  NEW.created_at,NEW.date,'finance',NEW.id,NULL,NULL,
  'Transação financeira registrada',NEW.description,
  json_object('transaction_type',NEW.transaction_type),NEW.created_at
 );
END;

CREATE TRIGGER activity_thought_created AFTER INSERT ON thoughts BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'thought.created:'||NEW.id,'thought.created',NEW.created_at,
  date(NEW.created_at,'localtime'),'thought',NEW.id,NULL,NULL,
  'Pensamento registrado','','{}',NEW.created_at
 );
END;

CREATE TRIGGER activity_focus_completed AFTER UPDATE OF status ON focus_sessions
WHEN NEW.status='completed' AND OLD.status<>'completed' BEGIN
 INSERT OR IGNORE INTO activity_events VALUES(
  lower(hex(randomblob(16))),'focus.completed:'||NEW.id,'focus.completed',NEW.ended_at,
  date(NEW.ended_at,'localtime'),'focus',NEW.id,
  CASE WHEN NEW.time_block_id IS NOT NULL THEN 'planning' WHEN NEW.task_id IS NOT NULL THEN 'task' ELSE NULL END,
  coalesce(NEW.time_block_id,NEW.task_id),'Sessão de foco concluída',NEW.title,
  json_object('duration_seconds',NEW.focused_seconds),NEW.ended_at
 );
END;

-- Backfill the universal history once. INSERT OR IGNORE keeps upgrades retry-safe.
INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),'planning.'||CASE WHEN status='completed' THEN 'completed' ELSE 'skipped' END||':'||id||':current',
 'planning.'||CASE WHEN status='completed' THEN 'completed' ELSE 'skipped' END,
 coalesce(completed_at,updated_at),block_date,'planning',id,
 CASE WHEN source_type='standalone' THEN NULL ELSE source_type END,source_id,
 CASE WHEN status='completed' THEN 'Planejamento concluído' ELSE 'Planejamento pulado' END,
 coalesce(nullif(title_snapshot,''),nullif(title,''),'Planejamento'),json_object('plan_date',block_date),coalesce(completed_at,updated_at)
FROM planner_time_blocks WHERE status IN('completed','skipped');

INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),'task.completed:'||id||':'||completed_at,'task.completed',completed_at,
 date(completed_at,'localtime'),'task',id,CASE WHEN project_id IS NULL THEN NULL ELSE 'project' END,project_id,
 'Tarefa concluída',title,'{}',completed_at
FROM tasks WHERE recurrence IS NULL AND status='completed' AND completed_at IS NOT NULL;
INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),'task.completed:'||c.task_id||':'||c.occurrence_date,'task.completed',c.completed_at,
 c.occurrence_date,'task',c.task_id,CASE WHEN t.project_id IS NULL THEN NULL ELSE 'project' END,t.project_id,
 'Tarefa concluída',t.title,'{}',c.completed_at
FROM task_completions c JOIN tasks t ON t.id=c.task_id;
INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),'project.completed:'||id||':'||completed_at,'project.completed',completed_at,
 date(completed_at,'localtime'),'project',id,NULL,NULL,'Projeto concluído',name,'{}',completed_at
FROM projects WHERE status='completed' AND completed_at IS NOT NULL;
INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),'habit:'||e.habit_id||':'||e.entry_date||':'||
 CASE WHEN e.value>=h.target_value THEN 'completed' ELSE 'progress:'||printf('%g',e.value) END,
 CASE WHEN e.value>=h.target_value THEN 'habit.completed' ELSE 'habit.progress' END,
 e.updated_at,e.entry_date,'habit',e.habit_id,NULL,NULL,
 CASE WHEN e.value>=h.target_value THEN 'Hábito concluído' ELSE 'Progresso de hábito' END,
 h.name,json_object('value',e.value,'target',h.target_value,'unit',h.unit),e.updated_at
FROM habit_entries e JOIN habits h ON h.id=e.habit_id WHERE e.value>0;
INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),'workout.completed:'||id,'workout.completed',finished_at,session_date,
 'workout',id,CASE WHEN workout_day_id IS NULL THEN NULL ELSE 'workout_day' END,workout_day_id,
 'Treino '||day_name||' concluído',plan_name,
 json_object('duration_seconds',max(0,CAST((julianday(finished_at)-julianday(started_at))*86400 AS INTEGER))),finished_at
FROM workout_sessions WHERE status='completed';
INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),'nutrition.meal_logged:'||entry_date||':'||lower(trim(meal_label)),
 'nutrition.meal_logged',min(created_at),entry_date,'nutrition',entry_date||':'||meal_label,NULL,NULL,
 'Refeição registrada',meal_label,'{}',min(created_at)
FROM food_diary_entries GROUP BY entry_date,lower(trim(meal_label));
INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),CASE WHEN metric_key='weight' THEN 'body.weight_logged:' ELSE 'body.measurement_logged:' END||record_date,
 CASE WHEN metric_key='weight' THEN 'body.weight_logged' ELSE 'body.measurement_logged' END,
 min(created_at),record_date,'body',record_date,NULL,NULL,
 CASE WHEN metric_key='weight' THEN 'Peso registrado' ELSE 'Medidas corporais registradas' END,
 'Registro corporal atualizado','{}',min(created_at)
FROM body_measurement_values GROUP BY record_date,metric_key='weight';
INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),'finance.transaction_created:'||id,'finance.transaction_created',created_at,date,
 'finance',id,NULL,NULL,'Transação financeira registrada',description,
 json_object('transaction_type',transaction_type),created_at FROM finance_transactions;
INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),'thought.created:'||id,'thought.created',created_at,date(created_at,'localtime'),
 'thought',id,NULL,NULL,'Pensamento registrado','','{}',created_at FROM thoughts;
INSERT OR IGNORE INTO activity_events
SELECT lower(hex(randomblob(16))),'focus.completed:'||id,'focus.completed',ended_at,date(ended_at,'localtime'),
 'focus',id,CASE WHEN time_block_id IS NOT NULL THEN 'planning' WHEN task_id IS NOT NULL THEN 'task' ELSE NULL END,
 coalesce(time_block_id,task_id),'Sessão de foco concluída',title,
 json_object('duration_seconds',focused_seconds),ended_at FROM focus_sessions WHERE status='completed';
