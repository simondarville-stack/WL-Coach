/*
  # Create athletes table

  1. New Tables
    - `athletes`
      - `id` (uuid, primary key)
      - `name` (text, required) - Athlete's full name
      - `birthdate` (date, optional) - Date of birth
      - `bodyweight` (numeric, optional) - Current bodyweight in kg
      - `weight_class` (text, optional) - Competition weight class
      - `club` (text, optional) - Club/team affiliation
      - `notes` (text, optional) - Additional notes
      - `is_active` (boolean, default true) - Whether athlete is currently active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `athletes` table
    - Add policy for public access (temporary - to be refined in auth slice)

  3. Indexes
    - Index on name for faster searching
    - Index on is_active for filtering
*/

CREATE TABLE IF NOT EXISTS athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  birthdate date,
  bodyweight numeric(5,2),
  weight_class text,
  club text,
  notes text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create index for faster searches
CREATE INDEX IF NOT EXISTS idx_athletes_name ON athletes(name);
CREATE INDEX IF NOT EXISTS idx_athletes_is_active ON athletes(is_active);

-- Enable RLS
ALTER TABLE athletes ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (to be refined with auth)
CREATE POLICY "Allow all access to athletes"
  ON athletes
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_athletes_updated_at'
  ) THEN
    CREATE TRIGGER update_athletes_updated_at
      BEFORE UPDATE ON athletes
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
