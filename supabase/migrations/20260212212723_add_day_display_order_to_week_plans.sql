/*
  # Add day display order to week_plans

  1. Changes
    - Add `day_display_order` column to store the display order of training days
    - This is an integer array that defines the visual order of days in the planner

  2. Notes
    - The array contains day indices in the order they should appear
    - For example: [1, 3, 2, 5] means show Day 1, then Day 3, then Day 2, then Day 5
    - If null or empty, days will be shown in their natural numerical order
    - This allows users to customize the layout to match their training schedule
*/

-- Add day_display_order column to week_plans
ALTER TABLE week_plans
ADD COLUMN IF NOT EXISTS day_display_order integer[] DEFAULT NULL;
