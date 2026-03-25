/*
  # Create general_settings table

  1. New Tables
    - `general_settings`
      - `id` (uuid, primary key)
      - `raw_enabled` (boolean, default true) - Toggle for RAW scoring feature
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS on `general_settings` table
    - Allow anyone to read settings (needed for app functionality)
    - Only allow authenticated users to update settings
  
  3. Notes
    - This is a single-row table for global application settings
    - Default RAW scoring to enabled (true)
*/

CREATE TABLE IF NOT EXISTS general_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_enabled boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE general_settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read settings
CREATE POLICY "Anyone can read general settings"
  ON general_settings
  FOR SELECT
  USING (true);

-- Allow authenticated users to update settings
CREATE POLICY "Authenticated users can update general settings"
  ON general_settings
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to insert settings (for initial setup)
CREATE POLICY "Authenticated users can insert general settings"
  ON general_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Insert default settings row if none exists
INSERT INTO general_settings (raw_enabled)
SELECT true
WHERE NOT EXISTS (SELECT 1 FROM general_settings);
