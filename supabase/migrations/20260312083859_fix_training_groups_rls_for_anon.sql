/*
  # Fix Training Groups RLS for Anonymous Access

  1. Changes
    - Update all training_groups policies to allow anon users (not just authenticated)
    - Update all group_members policies to allow anon users (not just authenticated)
    
  2. Security Notes
    - This matches the security model used throughout EMOS
    - All other tables (athletes, exercises, week_plans, etc.) allow anon access
    - RLS is still enabled for both tables
*/

-- Drop existing policies for training_groups
DROP POLICY IF EXISTS "Anyone can view training groups" ON training_groups;
DROP POLICY IF EXISTS "Authenticated users can create training groups" ON training_groups;
DROP POLICY IF EXISTS "Authenticated users can update training groups" ON training_groups;
DROP POLICY IF EXISTS "Authenticated users can delete training groups" ON training_groups;

-- Recreate policies with anon access
CREATE POLICY "Anyone can view training groups"
  ON training_groups FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anyone can create training groups"
  ON training_groups FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anyone can update training groups"
  ON training_groups FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete training groups"
  ON training_groups FOR DELETE
  TO anon
  USING (true);

-- Drop existing policies for group_members
DROP POLICY IF EXISTS "Anyone can view group members" ON group_members;
DROP POLICY IF EXISTS "Authenticated users can add group members" ON group_members;
DROP POLICY IF EXISTS "Authenticated users can update group members" ON group_members;
DROP POLICY IF EXISTS "Authenticated users can delete group members" ON group_members;

-- Recreate policies with anon access
CREATE POLICY "Anyone can view group members"
  ON group_members FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anyone can add group members"
  ON group_members FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anyone can update group members"
  ON group_members FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete group members"
  ON group_members FOR DELETE
  TO anon
  USING (true);