-- Add color column to categories
ALTER TABLE categories ADD COLUMN IF NOT EXISTS color text DEFAULT '#888780';

-- Set default colors for existing categories based on display_order
UPDATE categories SET color = CASE
  WHEN display_order = 0 THEN '#E24B4A'
  WHEN display_order = 1 THEN '#7F77DD'
  WHEN display_order = 2 THEN '#D85A30'
  WHEN display_order = 3 THEN '#1D9E75'
  WHEN display_order = 4 THEN '#EF9F27'
  WHEN display_order = 5 THEN '#D4537E'
  ELSE '#888780'
END
WHERE color IS NULL OR color = '#888780';
