/*
  # Fix RLS policies for events tables to allow anonymous access

  1. Changes
    - Drop existing restrictive policies on events and event_athletes tables
    - Add new policies that allow anonymous users to perform all operations
    - This matches the pattern used in other tables (exercises, athletes, etc.)
    
  2. Security
    - This is acceptable because the app is a single-user coach dashboard
    - All operations are performed using the anon key without authentication
*/

DROP POLICY IF EXISTS "Allow anonymous read access to events" ON events;
DROP POLICY IF EXISTS "Allow authenticated full access to events" ON events;
DROP POLICY IF EXISTS "Allow anonymous read access to event_athletes" ON event_athletes;
DROP POLICY IF EXISTS "Allow authenticated full access to event_athletes" ON event_athletes;

CREATE POLICY "Anyone can view events"
  ON events
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert events"
  ON events
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update events"
  ON events
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete events"
  ON events
  FOR DELETE
  USING (true);

CREATE POLICY "Anyone can view event_athletes"
  ON event_athletes
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert event_athletes"
  ON event_athletes
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update event_athletes"
  ON event_athletes
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete event_athletes"
  ON event_athletes
  FOR DELETE
  USING (true);
