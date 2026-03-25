/*
  # Add "other" unit and counts_towards_totals field

  1. Changes
    - Add "other" as a valid default_unit option in exercises table
    - Add counts_towards_totals boolean field to exercises table (defaults to true)
    - Update existing exercises to have counts_towards_totals = true

  2. Notes
    - The "other" unit type allows for free-text planning
    - counts_towards_totals determines if exercise contributes to weekly summaries
*/

-- Drop the old constraint and add a new one with "other"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_default_unit'
  ) THEN
    ALTER TABLE exercises DROP CONSTRAINT valid_default_unit;
  END IF;
END $$;

ALTER TABLE exercises ADD CONSTRAINT valid_default_unit CHECK (
  default_unit IN ('percentage', 'absolute_kg', 'rpe', 'other')
);

-- Add counts_towards_totals column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'counts_towards_totals'
  ) THEN
    ALTER TABLE exercises ADD COLUMN counts_towards_totals boolean DEFAULT true NOT NULL;
  END IF;
END $$;

-- Ensure all existing exercises have counts_towards_totals set to true
UPDATE exercises SET counts_towards_totals = true WHERE counts_towards_totals IS NULL;
