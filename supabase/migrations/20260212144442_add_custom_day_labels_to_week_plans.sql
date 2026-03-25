/*
  # Add custom day labels to week plans

  1. Changes
    - Add `day_labels` JSONB column to `week_plans` table
      - Stores custom labels for each day index (1-7)
      - Format: {"1": "Monday", "2": "Tuesday", ...} or {"1": "Session 1", "2": "Session 2", ...}
      - Nullable to allow default behavior
    
  2. Notes
    - This allows users to customize day names beyond traditional weekdays
    - Supports use cases like:
      - Session numbers: "Session 1", "Session 2", etc.
      - Multiple sessions per day: "Monday AM", "Monday PM"
      - Custom naming schemes
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'week_plans' AND column_name = 'day_labels'
  ) THEN
    ALTER TABLE week_plans ADD COLUMN day_labels JSONB;
  END IF;
END $$;