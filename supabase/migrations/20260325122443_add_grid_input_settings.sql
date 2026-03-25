/*
  # Add Grid Input Mode Settings

  1. Changes
    - Add `grid_load_increment` column to general_settings (default: 5)
    - Add `grid_click_increment` column to general_settings (default: 1)
  
  2. Purpose
    - Support new grid-based prescription input mode
    - `grid_load_increment`: Auto-increment for new column load when adding columns
    - `grid_click_increment`: Value change per click on load/reps/sets cells
*/

-- Add grid input settings
ALTER TABLE general_settings 
  ADD COLUMN IF NOT EXISTS grid_load_increment numeric DEFAULT 5,
  ADD COLUMN IF NOT EXISTS grid_click_increment numeric DEFAULT 1;

-- Update existing row if one exists
UPDATE general_settings 
SET 
  grid_load_increment = COALESCE(grid_load_increment, 5),
  grid_click_increment = COALESCE(grid_click_increment, 1);