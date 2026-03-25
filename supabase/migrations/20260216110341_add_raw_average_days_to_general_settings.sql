/*
  # Add RAW average days configuration to general settings

  1. Changes
    - Add `raw_average_days` column to `general_settings` table
      - Stores the number of days to use for calculating RAW average
      - Integer type with default value of 7 days
      - Used in coach dashboard to calculate athlete RAW averages
  
  2. Notes
    - This allows coaches to customize the rolling average window
    - Default value of 7 provides a weekly average
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'general_settings' AND column_name = 'raw_average_days'
  ) THEN
    ALTER TABLE general_settings ADD COLUMN raw_average_days integer DEFAULT 7 NOT NULL;
  END IF;
END $$;