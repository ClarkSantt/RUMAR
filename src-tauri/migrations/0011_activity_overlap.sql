-- Keep total steps visible while excluding steps already represented by structured workouts.
ALTER TABLE daily_activity_entries ADD COLUMN workout_steps INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(workout_steps)='integer' AND workout_steps>=0 AND workout_steps<=steps);
