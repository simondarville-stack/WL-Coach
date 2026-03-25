/*
  # Add Free Text Exercise

  1. Purpose
    - Creates a system exercise for free text / note entries in the weekly planner
    - Allows coaches to add arbitrary text notes between exercises using "/text"
  
  2. Changes
    - Creates "— System" category if needed
    - Inserts a "Free Text / Notes" exercise with a special category
    - Uses a light gray color to visually distinguish from regular exercises
*/

DO $$
DECLARE
  v_text_exercise_id uuid;
BEGIN
  -- Create System category if it doesn't exist
  INSERT INTO categories (name)
  VALUES ('— System')
  ON CONFLICT (name) DO NOTHING;

  -- Check if Free Text exercise already exists
  SELECT id INTO v_text_exercise_id
  FROM exercises
  WHERE name = 'Free Text / Notes' AND category = '— System';

  -- Create it if it doesn't exist
  IF v_text_exercise_id IS NULL THEN
    INSERT INTO exercises (
      name,
      category,
      default_unit,
      color,
      exercise_code,
      use_stacked_notation
    ) VALUES (
      'Free Text / Notes',
      '— System',
      'other',
      '#9CA3AF',
      'TEXT',
      false
    );
  END IF;
END $$;
