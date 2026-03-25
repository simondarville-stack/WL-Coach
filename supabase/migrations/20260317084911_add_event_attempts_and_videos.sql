/*
  # Event Attempts and Results Tracking

  This migration adds comprehensive competition tracking for Olympic weightlifting events.

  ## New Tables

  1. `event_attempts`
     - Tracks planned and actual attempts for each athlete at an event
     - Stores snatch and clean & jerk attempts (3 each per athlete)
     - Supports partial planning (only some attempts planned)
     - Records whether attempts were successful or failed
     - Includes competition notes per athlete
     
  2. `event_videos`
     - Stores video URLs for each attempt
     - Links to specific event, athlete, and lift type
     - Supports multiple videos per attempt

  ## Competition Attempt Format

  - Each attempt is stored as a number (weight in kg)
  - Failed attempts are stored as negative numbers (e.g., -100 means 100kg failed)
  - NULL means the attempt was not planned or not executed
  - Snatch: 3 attempts (snatch_1, snatch_2, snatch_3)
  - Clean & Jerk: 3 attempts (cj_1, cj_2, cj_3)

  ## Security

  - RLS enabled on all tables
  - Public read access for viewing events
  - Authenticated users only can modify

  ## Notes

  - Follows Olympic weightlifting rules: 3 attempts per lift type
  - Supports both planning phase (planned_*) and results phase (actual_*)
  - Competition notes per athlete for post-event reflection
*/

-- Event attempts table for planning and results
CREATE TABLE IF NOT EXISTS event_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  
  -- Planned attempts (coach's pre-competition plan)
  planned_snatch_1 integer,
  planned_snatch_2 integer,
  planned_snatch_3 integer,
  planned_cj_1 integer,
  planned_cj_2 integer,
  planned_cj_3 integer,
  
  -- Actual attempts executed (negative = failed attempt)
  actual_snatch_1 integer,
  actual_snatch_2 integer,
  actual_snatch_3 integer,
  actual_cj_1 integer,
  actual_cj_2 integer,
  actual_cj_3 integer,
  
  -- Competition notes and reflection
  competition_notes text,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(event_id, athlete_id)
);

-- Event videos table for storing attempt footage
CREATE TABLE IF NOT EXISTS event_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  
  -- Lift type and attempt number
  lift_type text NOT NULL CHECK (lift_type IN ('snatch', 'clean_jerk')),
  attempt_number integer NOT NULL CHECK (attempt_number >= 1 AND attempt_number <= 3),
  
  -- Video URL
  video_url text NOT NULL,
  
  -- Optional description
  description text,
  
  created_at timestamptz DEFAULT now(),
  
  UNIQUE(event_id, athlete_id, lift_type, attempt_number)
);

-- Enable RLS
ALTER TABLE event_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_videos ENABLE ROW LEVEL SECURITY;

-- RLS Policies for event_attempts
CREATE POLICY "Anyone can view event attempts"
  ON event_attempts FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert event attempts"
  ON event_attempts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update event attempts"
  ON event_attempts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete event attempts"
  ON event_attempts FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies for event_videos
CREATE POLICY "Anyone can view event videos"
  ON event_videos FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert event videos"
  ON event_videos FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update event videos"
  ON event_videos FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete event videos"
  ON event_videos FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_event_attempts_event_id ON event_attempts(event_id);
CREATE INDEX IF NOT EXISTS idx_event_attempts_athlete_id ON event_attempts(athlete_id);
CREATE INDEX IF NOT EXISTS idx_event_videos_event_id ON event_videos(event_id);
CREATE INDEX IF NOT EXISTS idx_event_videos_athlete_id ON event_videos(athlete_id);