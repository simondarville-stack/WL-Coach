/*
  # Add Video and Image Slash Command Exercises + Storage Bucket

  1. Changes
    - Creates "Video" sentinel exercise (code: VIDEO) in "— System" category
    - Creates "Image" sentinel exercise (code: IMAGE) in "— System" category
    - Creates planner-media storage bucket for uploaded images

  2. Purpose
    - Support /video and /image slash commands in the weekly planner
    - Media URLs stored in the planned_exercise notes field
    - Uploaded images stored in Supabase Storage planner-media bucket
*/

DO $$
DECLARE
  v_video_exercise_id uuid;
  v_image_exercise_id uuid;
BEGIN
  -- Ensure System category exists
  INSERT INTO categories (name)
  VALUES ('— System')
  ON CONFLICT (name) DO NOTHING;

  -- Create Video exercise if it doesn't exist
  SELECT id INTO v_video_exercise_id
  FROM exercises
  WHERE exercise_code = 'VIDEO' AND category = '— System';

  IF v_video_exercise_id IS NULL THEN
    INSERT INTO exercises (
      name, category, default_unit, color, exercise_code,
      use_stacked_notation, counts_towards_totals
    ) VALUES (
      'Video',
      '— System',
      'other',
      '#6366F1',
      'VIDEO',
      false,
      false
    );
  END IF;

  -- Create Image exercise if it doesn't exist
  SELECT id INTO v_image_exercise_id
  FROM exercises
  WHERE exercise_code = 'IMAGE' AND category = '— System';

  IF v_image_exercise_id IS NULL THEN
    INSERT INTO exercises (
      name, category, default_unit, color, exercise_code,
      use_stacked_notation, counts_towards_totals
    ) VALUES (
      'Image',
      '— System',
      'other',
      '#EC4899',
      'IMAGE',
      false,
      false
    );
  END IF;
END $$;

-- Create storage bucket for planner media uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('planner-media', 'planner-media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY IF NOT EXISTS "Public read access for planner-media"
ON storage.objects FOR SELECT
USING (bucket_id = 'planner-media');

-- Allow uploads (anon for now, matching existing RLS pattern)
CREATE POLICY IF NOT EXISTS "Allow uploads to planner-media"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'planner-media');

-- Allow deletes
CREATE POLICY IF NOT EXISTS "Allow deletes from planner-media"
ON storage.objects FOR DELETE
USING (bucket_id = 'planner-media');
