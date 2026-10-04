-- Preserve the task occurrence even if its planning block is later moved/deleted.
ALTER TABLE focus_sessions ADD COLUMN occurrence_date TEXT CHECK(occurrence_date IS NULL OR length(occurrence_date)=10);
UPDATE focus_sessions SET occurrence_date=coalesce((SELECT coalesce(b.occurrence_date,b.block_date) FROM planner_time_blocks b WHERE b.id=focus_sessions.time_block_id),date(started_at,'localtime')) WHERE task_id IS NOT NULL;
