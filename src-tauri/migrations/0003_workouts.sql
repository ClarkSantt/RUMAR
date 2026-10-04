CREATE TABLE exercises (
 id TEXT PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name))>0),muscle_group TEXT NOT NULL,equipment TEXT NOT NULL,
 load_type TEXT NOT NULL CHECK(load_type IN('total','per_side','per_dumbbell','bodyweight','none')),notes TEXT NOT NULL DEFAULT '',
 is_custom INTEGER NOT NULL DEFAULT 1 CHECK(is_custom IN(0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT
);
CREATE INDEX exercises_library ON exercises(archived_at,muscle_group,equipment,name);
CREATE TABLE workout_plans (
 id TEXT PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name))>0),description TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),
 habit_id TEXT REFERENCES habits(id) ON DELETE SET NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT
);
CREATE UNIQUE INDEX workout_active_plan ON workout_plans(active) WHERE active=1;
CREATE TRIGGER workout_activate BEFORE UPDATE OF active ON workout_plans WHEN NEW.active=1
BEGIN UPDATE workout_plans SET active=0 WHERE id<>NEW.id AND active=1; END;
CREATE TRIGGER workout_habit_insert BEFORE INSERT ON workout_plans WHEN NEW.habit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM habits WHERE id=NEW.habit_id AND kind='boolean' AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Vincule um hábito de marcação simples'); END;
CREATE TRIGGER workout_habit_update BEFORE UPDATE OF habit_id ON workout_plans WHEN NEW.habit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM habits WHERE id=NEW.habit_id AND kind='boolean' AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Vincule um hábito de marcação simples'); END;
CREATE TABLE workout_days (
 id TEXT PRIMARY KEY,workout_plan_id TEXT NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,name TEXT NOT NULL CHECK(length(trim(name))>0),
 weekday INTEGER CHECK(weekday BETWEEN 0 AND 6),sort_order INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX workout_days_plan ON workout_days(workout_plan_id,sort_order);
CREATE TABLE workout_day_exercises (
 id TEXT PRIMARY KEY,workout_day_id TEXT NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,exercise_id TEXT NOT NULL REFERENCES exercises(id),
 target_sets INTEGER NOT NULL CHECK(target_sets BETWEEN 1 AND 50),min_reps INTEGER NOT NULL CHECK(min_reps BETWEEN 0 AND 1000),max_reps INTEGER NOT NULL CHECK(max_reps>=min_reps AND max_reps<=1000),
 rest_seconds INTEGER CHECK(rest_seconds BETWEEN 0 AND 3600),notes TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX workout_day_exercises_order ON workout_day_exercises(workout_day_id,sort_order);
CREATE TABLE workout_sessions (
 id TEXT PRIMARY KEY,workout_plan_id TEXT REFERENCES workout_plans(id) ON DELETE SET NULL,workout_day_id TEXT REFERENCES workout_days(id) ON DELETE SET NULL,
 plan_name TEXT NOT NULL,day_name TEXT NOT NULL,session_date TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,
 notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN('in_progress','completed','discarded')),
 habit_id TEXT REFERENCES habits(id) ON DELETE SET NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK((status='in_progress' AND finished_at IS NULL) OR (status<>'in_progress' AND finished_at IS NOT NULL)),CHECK(finished_at IS NULL OR finished_at>=started_at)
);
CREATE UNIQUE INDEX workout_one_in_progress ON workout_sessions(status) WHERE status='in_progress';
CREATE INDEX workout_sessions_history ON workout_sessions(status,started_at DESC);
CREATE INDEX workout_sessions_schedule ON workout_sessions(session_date,workout_day_id);
CREATE TABLE workout_session_exercises (
 id TEXT PRIMARY KEY,workout_session_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,exercise_id TEXT NOT NULL REFERENCES exercises(id),
 exercise_name TEXT NOT NULL,load_type TEXT NOT NULL CHECK(load_type IN('total','per_side','per_dumbbell','bodyweight','none')),
 target_sets INTEGER NOT NULL,min_reps INTEGER NOT NULL,max_reps INTEGER NOT NULL,rest_seconds INTEGER,notes TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL,
 UNIQUE(id,workout_session_id,exercise_id)
);
CREATE INDEX workout_session_exercise_order ON workout_session_exercises(workout_session_id,sort_order);
CREATE TABLE workout_sets (
 id TEXT PRIMARY KEY,workout_session_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,session_exercise_id TEXT NOT NULL,exercise_id TEXT NOT NULL,
 set_number INTEGER NOT NULL CHECK(set_number>0),set_type TEXT NOT NULL DEFAULT 'normal' CHECK(set_type IN('normal','warmup','drop')),
 load_value REAL CHECK(load_value>=0 AND load_value<=100000),load_type TEXT NOT NULL CHECK(load_type IN('total','per_side','per_dumbbell','bodyweight','none')),
 reps INTEGER CHECK(reps BETWEEN 0 AND 1000),completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(session_exercise_id,workout_session_id,exercise_id) REFERENCES workout_session_exercises(id,workout_session_id,exercise_id) ON DELETE CASCADE,
 UNIQUE(session_exercise_id,set_number),CHECK(completed=0 OR (reps IS NOT NULL AND (load_value IS NOT NULL OR load_type IN('bodyweight','none')))),CHECK(load_type<>'none' OR load_value IS NULL OR load_value=0)
);
CREATE INDEX workout_sets_exercise ON workout_sets(exercise_id,workout_session_id);
CREATE TRIGGER workout_snapshot AFTER INSERT ON workout_sessions
BEGIN
 INSERT INTO workout_session_exercises(id,workout_session_id,exercise_id,exercise_name,load_type,target_sets,min_reps,max_reps,rest_seconds,notes,sort_order)
 SELECT NEW.id||':'||d.id,NEW.id,d.exercise_id,e.name,e.load_type,d.target_sets,d.min_reps,d.max_reps,d.rest_seconds,d.notes,d.sort_order
 FROM workout_day_exercises d JOIN exercises e ON e.id=d.exercise_id WHERE d.workout_day_id=NEW.workout_day_id AND e.archived_at IS NULL;
 INSERT INTO workout_sets(id,workout_session_id,session_exercise_id,exercise_id,set_number,load_type,created_at,updated_at)
 SELECT se.id||':'||numbers.n,NEW.id,se.id,se.exercise_id,numbers.n,se.load_type,NEW.created_at,NEW.created_at FROM workout_session_exercises se
 JOIN (WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<50) SELECT n FROM nums) numbers ON numbers.n<=se.target_sets WHERE se.workout_session_id=NEW.id;
END;
ALTER TABLE habit_entries ADD COLUMN source_workout_session_id TEXT REFERENCES workout_sessions(id) ON DELETE SET NULL;
CREATE TRIGGER workout_complete_habit AFTER UPDATE OF status ON workout_sessions WHEN NEW.status='completed' AND OLD.status<>'completed' AND NEW.habit_id IS NOT NULL
BEGIN
 INSERT INTO habit_entries(habit_id,entry_date,value,updated_at,source_workout_session_id)
 SELECT h.id,NEW.session_date,1,NEW.updated_at,NEW.id FROM habits h WHERE h.id=NEW.habit_id AND h.kind='boolean' AND h.active=1 AND h.archived_at IS NULL
 AND NEW.session_date>=h.start_date AND (h.end_date IS NULL OR NEW.session_date<=h.end_date)
 AND (h.frequency<>'weekdays' OR EXISTS(SELECT 1 FROM json_each(h.weekdays) WHERE value=CAST(strftime('%w',NEW.session_date) AS INTEGER)))
 ON CONFLICT(habit_id,entry_date) DO UPDATE SET value=1,updated_at=excluded.updated_at,source_workout_session_id=excluded.source_workout_session_id WHERE habit_entries.value<1;
END;
INSERT INTO exercises(id,name,muscle_group,equipment,load_type,is_custom,created_at,updated_at) VALUES
 ('builtin-bench','Supino reto','Peito','Barra','per_side',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-incline','Supino inclinado','Peito','Halteres','per_dumbbell',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-row','Remada baixa','Costas','Cabo','total',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-pulldown','Puxada alta','Costas','Cabo','total',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-squat','Agachamento','Quadríceps','Barra','per_side',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-legpress','Leg press','Quadríceps','Máquina','total',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-extension','Cadeira extensora','Quadríceps','Máquina','total',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-curl','Mesa flexora','Posteriores','Máquina','total',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-press','Desenvolvimento','Ombros','Halteres','per_dumbbell',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-lateral','Elevação lateral','Ombros','Halteres','per_dumbbell',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-biceps','Rosca direta','Bíceps','Barra','total',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-triceps','Tríceps pulley','Tríceps','Cabo','total',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-calf','Panturrilha','Panturrilhas','Máquina','total',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z'),
 ('builtin-abs','Abdominal','Abdômen','Peso corporal','none',0,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z');
