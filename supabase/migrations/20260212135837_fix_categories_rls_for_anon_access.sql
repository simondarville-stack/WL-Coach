/*
  # Fix categories RLS policies for anonymous access

  1. Changes
    - Drop existing restrictive policies that require authentication
    - Add new policies that allow anonymous users to access categories
    - This is needed because the app doesn't have authentication yet

  2. Security
    - Categories are globally accessible to all users (anonymous and authenticated)
    - Anyone can read, insert, update, and delete categories
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can read categories" ON categories;
DROP POLICY IF EXISTS "Authenticated users can insert categories" ON categories;
DROP POLICY IF EXISTS "Authenticated users can update categories" ON categories;
DROP POLICY IF EXISTS "Authenticated users can delete categories" ON categories;

-- Create new permissive policies for anonymous access
CREATE POLICY "Allow all to read categories"
  ON categories
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow all to insert categories"
  ON categories
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow all to update categories"
  ON categories
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all to delete categories"
  ON categories
  FOR DELETE
  TO anon
  USING (true);
