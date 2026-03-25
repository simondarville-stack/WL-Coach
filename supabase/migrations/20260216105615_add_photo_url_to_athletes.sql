/*
  # Add photo URL to athletes table

  1. Changes
    - Add `photo_url` column to `athletes` table
      - Stores URL to athlete's photo/headshot
      - Optional field (can be null)
      - Text type to store image URLs
  
  2. Notes
    - Photos can be hosted externally (e.g., Pexels, Unsplash) or uploaded elsewhere
    - No size limit on URL length, but practical URLs should be reasonable
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'athletes' AND column_name = 'photo_url'
  ) THEN
    ALTER TABLE athletes ADD COLUMN photo_url text;
  END IF;
END $$;