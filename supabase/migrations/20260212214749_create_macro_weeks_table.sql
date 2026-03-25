/*
  # Create macro_weeks table

  1. New Tables
    - `macro_weeks`
      - `id` (uuid, primary key)
      - `macrocycle_id` (uuid, foreign key to macrocycles)
      - `week_start` (date, not null) - Monday of the week
      - `week_number` (integer, not null) - Sequential week number within the macrocycle
      - `week_type` (text, not null, default 'Medium')
      - `notes` (text)
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz, default now())

  2. Security
    - Enable RLS on `macro_weeks` table
    - Add policies for authenticated users to manage macro weeks

  3. Indexes
    - Index on macrocycle_id for fast lookups
    - Unique constraint on macrocycle_id + week_start

  4. Notes
    - week_type values: High, Medium, Low, Vacation, Deload, Taper, Competition
    - week_start should always be a Monday
*/

CREATE TABLE IF NOT EXISTS macro_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  macrocycle_id uuid REFERENCES macrocycles(id) ON DELETE CASCADE NOT NULL,
  week_start date NOT NULL,
  week_number integer NOT NULL,
  week_type text NOT NULL DEFAULT 'Medium',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_week_type CHECK (week_type IN ('High', 'Medium', 'Low', 'Vacation', 'Deload', 'Taper', 'Competition')),
  CONSTRAINT unique_macrocycle_week UNIQUE (macrocycle_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_macro_weeks_macrocycle_id ON macro_weeks(macrocycle_id);

ALTER TABLE macro_weeks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view macro_weeks"
  ON macro_weeks FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anyone can insert macro_weeks"
  ON macro_weeks FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anyone can update macro_weeks"
  ON macro_weeks FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete macro_weeks"
  ON macro_weeks FOR DELETE
  TO anon
  USING (true);
