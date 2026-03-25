/*
  # Create Training Groups Tables

  1. New Tables
    - `training_groups`
      - `id` (uuid, primary key)
      - `name` (text, required) - Name of the training group
      - `description` (text, optional) - Description of the group
      - `created_at` (timestamptz) - When the group was created
      - `updated_at` (timestamptz) - When the group was last updated

    - `group_members`
      - `id` (uuid, primary key)
      - `group_id` (uuid, foreign key to training_groups) - The training group
      - `athlete_id` (uuid, foreign key to athletes) - The athlete in the group
      - `joined_at` (timestamptz) - When the athlete joined the group
      - `left_at` (timestamptz, nullable) - When the athlete left the group (null if still active)

  2. Security
    - Enable RLS on both tables
    - Allow public read access (anon users can view groups)
    - Authenticated users can manage groups

  3. Indexes
    - Index on group_members(group_id) for fast member lookups
    - Index on group_members(athlete_id) for fast athlete group lookups
    - Unique constraint on active memberships (group_id, athlete_id where left_at is null)
*/

-- Create training_groups table
CREATE TABLE IF NOT EXISTS training_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create group_members table
CREATE TABLE IF NOT EXISTS group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES training_groups(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now() NOT NULL,
  left_at timestamptz
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_athlete_id ON group_members(athlete_id);

-- Create unique constraint for active memberships (one athlete can only be in a group once at a time)
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_active_unique 
  ON group_members(group_id, athlete_id) 
  WHERE left_at IS NULL;

-- Enable RLS
ALTER TABLE training_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- Policies for training_groups
CREATE POLICY "Anyone can view training groups"
  ON training_groups FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Authenticated users can create training groups"
  ON training_groups FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update training groups"
  ON training_groups FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete training groups"
  ON training_groups FOR DELETE
  TO authenticated
  USING (true);

-- Policies for group_members
CREATE POLICY "Anyone can view group members"
  ON group_members FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Authenticated users can add group members"
  ON group_members FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update group members"
  ON group_members FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete group members"
  ON group_members FOR DELETE
  TO authenticated
  USING (true);