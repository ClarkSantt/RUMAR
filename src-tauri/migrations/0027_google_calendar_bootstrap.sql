-- Connecting OAuth alone never starts a bulk mirror. The user initiates the first sync.
ALTER TABLE google_calendar_settings ADD COLUMN sync_started INTEGER NOT NULL DEFAULT 0 CHECK(sync_started IN(0,1));
