/*
  # Remove day index constraint

  1. Changes
    - Remove the CHECK constraint that limits day_index to 1-7
    - Add a new CHECK constraint that allows any positive day_index
    
  2. Reason
    - Users need to be able to create custom training days beyond the standard 7 days
    - Day indices 8, 9, 10, etc. should be allowed for custom training days
    
  3. Security
    - Maintain RLS policies (no changes)
    - Only ensure day_index is positive to prevent invalid negative values
*/

-- Drop the old constraint that limits to 1-7
ALTER TABLE planned_exercises 
  DROP CONSTRAINT IF EXISTS valid_day_index;

-- Add a new constraint that allows any positive integer
ALTER TABLE planned_exercises 
  ADD CONSTRAINT valid_day_index CHECK (day_index >= 1);
