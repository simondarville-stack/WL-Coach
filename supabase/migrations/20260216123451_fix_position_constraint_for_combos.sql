/*
  # Fix position constraint for combo exercises

  1. Changes
    - Drop the unique constraint on planned_exercises (weekplan_id, day_index, position)
    - This constraint prevented combos from creating multiple exercises at the same position
    - Combos need multiple exercises to share the same position since they're executed together
    - Ordering is now managed by application logic using both planned_exercises and planned_combos positions
  
  2. Notes
    - Regular exercises still use position for ordering
    - Combo exercises share positions and are tracked via planned_combo_items
    - The application filters combo exercises from the regular view using comboExerciseIds
*/

-- Drop the unique constraint that prevents combos from working
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'planned_exercises_weekplan_id_day_index_position_key'
  ) THEN
    ALTER TABLE planned_exercises 
    DROP CONSTRAINT planned_exercises_weekplan_id_day_index_position_key;
  END IF;
END $$;
