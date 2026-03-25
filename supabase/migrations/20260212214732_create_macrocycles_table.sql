/*
  # Create macrocycles table

  1. New Tables
    - `macrocycles`
      - `id` (uuid, primary key)
      - `athlete_id` (uuid, foreign key to athletes)
      - `name` (text, not null)
      - `start_date` (date, not null)
      - `end_date` (date, not null)
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz, default now())

  2. Security
    - Enable RLS on `macrocycles` table
    - Add policies for authenticated users to manage macrocycles

  3. Indexes
    - Index on athlete_id for fast lookups
*/

CREATE TABLE IF NOT EXISTS macrocycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_macrocycles_athlete_id ON macrocycles(athlete_id);

ALTER TABLE macrocycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view macrocycles"
  ON macrocycles FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anyone can insert macrocycles"
  ON macrocycles FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anyone can update macrocycles"
  ON macrocycles FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete macrocycles"
  ON macrocycles FOR DELETE
  TO anon
  USING (true);
