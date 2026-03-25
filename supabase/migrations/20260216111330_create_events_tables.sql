/*
  # Create events management tables

  1. New Tables
    - `events`
      - `id` (uuid, primary key)
      - `name` (text) - Event name
      - `event_date` (date) - When the event occurs
      - `description` (text, nullable) - Optional event details
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `event_athletes`
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key to events)
      - `athlete_id` (uuid, foreign key to athletes)
      - `created_at` (timestamptz)
  
  2. Security
    - Enable RLS on both tables
    - Allow anonymous access for read operations (coach dashboard needs this)
    - Allow authenticated access for all operations

  3. Notes
    - Events can have multiple participating athletes
    - Events will be displayed in the coach dashboard with days/weeks until the event
*/

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  event_date date NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(event_id, athlete_id)
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_athletes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read access to events"
  ON events FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow authenticated full access to events"
  ON events FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anonymous read access to event_athletes"
  ON event_athletes FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow authenticated full access to event_athletes"
  ON event_athletes FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);