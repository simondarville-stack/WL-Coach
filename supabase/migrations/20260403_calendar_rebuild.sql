-- Calendar rebuild: add new fields to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type text DEFAULT 'competition';
ALTER TABLE events ADD COLUMN IF NOT EXISTS location text DEFAULT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS end_date date DEFAULT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS color text DEFAULT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS notes text DEFAULT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_all_day boolean DEFAULT true;
ALTER TABLE events ADD COLUMN IF NOT EXISTS start_time time DEFAULT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time time DEFAULT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS external_url text DEFAULT NULL;

-- Valid event_type values: 'competition', 'training_camp', 'seminar',
-- 'testing_day', 'team_meeting', 'other'
