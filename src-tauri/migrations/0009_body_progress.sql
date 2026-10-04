-- Body measurements become the shared source for Workouts and Nutrition.
-- The Phase 4 weight table remains intact as a migration audit trail.
CREATE TABLE body_measurement_records (
  record_id TEXT NOT NULL UNIQUE,
  measurement_date TEXT PRIMARY KEY CHECK (measurement_date GLOB '????-??-??'),
  notes TEXT NOT NULL DEFAULT '',
  pending_values TEXT CHECK (pending_values IS NULL OR json_valid(pending_values)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE body_measurement_values (
  record_date TEXT NOT NULL REFERENCES body_measurement_records(measurement_date)
    ON DELETE CASCADE ON UPDATE CASCADE,
  metric_key TEXT NOT NULL CHECK (metric_key IN (
    'weight','body_fat','neck','shoulders','chest','waist','abdomen','hips',
    'left_arm','right_arm','left_forearm','right_forearm',
    'left_thigh','right_thigh','left_calf','right_calf'
  )),
  value REAL NOT NULL CHECK (value > 0 AND value < 1000),
  unit TEXT NOT NULL CHECK (unit IN ('kg','%','cm')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (record_date, metric_key),
  CHECK ((metric_key = 'weight' AND unit = 'kg') OR
         (metric_key = 'body_fat' AND unit = '%' AND value <= 100) OR
         (metric_key NOT IN ('weight','body_fat') AND unit = 'cm'))
);
CREATE INDEX body_measurement_metric_date ON body_measurement_values(metric_key,record_date DESC);

-- The UI sends only changed metrics. A single record UPSERT and these triggers
-- merge them atomically, including explicit nulls for deleted measurements.
CREATE TRIGGER body_measurements_insert AFTER INSERT ON body_measurement_records
WHEN NEW.pending_values IS NOT NULL BEGIN
  INSERT INTO body_measurement_values(record_date,metric_key,value,unit,created_at,updated_at)
  SELECT NEW.measurement_date,j.key,CAST(j.value AS REAL),
    CASE j.key WHEN 'weight' THEN 'kg' WHEN 'body_fat' THEN '%' ELSE 'cm' END,
    NEW.created_at,NEW.updated_at
  FROM json_each(NEW.pending_values) j WHERE j.value IS NOT NULL;
  UPDATE body_measurement_records SET pending_values=NULL WHERE measurement_date=NEW.measurement_date;
END;
CREATE TRIGGER body_measurements_update AFTER UPDATE OF pending_values ON body_measurement_records
WHEN NEW.pending_values IS NOT NULL BEGIN
  DELETE FROM body_measurement_values WHERE record_date=NEW.measurement_date
    AND metric_key IN (SELECT key FROM json_each(NEW.pending_values));
  INSERT INTO body_measurement_values(record_date,metric_key,value,unit,created_at,updated_at)
  SELECT NEW.measurement_date,j.key,CAST(j.value AS REAL),
    CASE j.key WHEN 'weight' THEN 'kg' WHEN 'body_fat' THEN '%' ELSE 'cm' END,
    NEW.created_at,NEW.updated_at
  FROM json_each(NEW.pending_values) j WHERE j.value IS NOT NULL;
  UPDATE body_measurement_records SET pending_values=NULL WHERE measurement_date=NEW.measurement_date;
END;

-- A legacy date may have multiple entries. Keep its latest edited weight as
-- the one daily measurement; all originals remain in body_weight_entries.
INSERT INTO body_measurement_records(record_id,measurement_date,notes,created_at,updated_at)
SELECT id,entry_date,notes,created_at,updated_at FROM (
  SELECT *,ROW_NUMBER() OVER (
    PARTITION BY entry_date ORDER BY updated_at DESC,created_at DESC,id DESC
  ) AS rank_on_day FROM body_weight_entries
) WHERE rank_on_day=1;
INSERT INTO body_measurement_values(record_date,metric_key,value,unit,created_at,updated_at)
SELECT entry_date,'weight',weight_kg,'kg',created_at,updated_at FROM (
  SELECT *,ROW_NUMBER() OVER (
    PARTITION BY entry_date ORDER BY updated_at DESC,created_at DESC,id DESC
  ) AS rank_on_day FROM body_weight_entries
) WHERE rank_on_day=1;
