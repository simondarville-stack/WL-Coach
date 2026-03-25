/*
  # Migrate existing combos to use set lines

  1. Changes
    - Create set lines for all existing planned_combos
    - Each combo gets one set line based on its current shared_load_value, sets, and reps_tuple_text
    - This ensures backward compatibility with combos created before the set lines feature
  
  2. Notes
    - Only processes combos that don't already have set lines
    - Uses position 1 for all migrated set lines
*/

-- Create set lines for existing combos that don't have any
INSERT INTO planned_combo_set_lines (planned_combo_id, position, load_value, sets, reps_tuple_text)
SELECT 
  pc.id,
  1,
  pc.shared_load_value,
  pc.sets,
  pc.reps_tuple_text
FROM planned_combos pc
WHERE NOT EXISTS (
  SELECT 1 
  FROM planned_combo_set_lines pcsl 
  WHERE pcsl.planned_combo_id = pc.id
);
