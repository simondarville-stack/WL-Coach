/*
  # Create categories table for customizable exercise categories

  1. New Tables
    - `categories`
      - `id` (uuid, primary key)
      - `name` (text, unique, not null) - Category name
      - `display_order` (integer, default 0) - Order for sorting categories
      - `created_at` (timestamptz, default now())

  2. Security
    - Enable RLS on `categories` table
    - Add policy for authenticated users to read categories
    - Add policy for authenticated users to insert categories
    - Add policy for authenticated users to update categories
    - Add policy for authenticated users to delete categories

  3. Data
    - Seed with existing categories from the app

  4. Notes
    - Categories are globally available to all users
    - Uses display_order for custom sorting
    - Future: Could add user_id if categories should be per-user
*/

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Policies for categories (globally readable and editable by authenticated users)
CREATE POLICY "Anyone can read categories"
  ON categories
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert categories"
  ON categories
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update categories"
  ON categories
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete categories"
  ON categories
  FOR DELETE
  TO authenticated
  USING (true);

-- Seed with existing categories
INSERT INTO categories (name, display_order) VALUES
  ('Snatch', 1),
  ('Clean & Jerk', 2),
  ('Squat', 3),
  ('Pull', 4),
  ('Press', 5),
  ('Accessory', 6)
ON CONFLICT (name) DO NOTHING;
