/*
  # Add Link Field to Exercises Table

  1. Changes
    - Add `link` column to `exercises` table
      - Type: text (nullable)
      - Purpose: Store URL links to demonstration videos (YouTube, etc.)

  2. Notes
    - Link is optional (nullable) to maintain backward compatibility
    - Can store any valid URL pointing to exercise demonstrations
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'link'
  ) THEN
    ALTER TABLE exercises ADD COLUMN link text;
  END IF;
END $$;
