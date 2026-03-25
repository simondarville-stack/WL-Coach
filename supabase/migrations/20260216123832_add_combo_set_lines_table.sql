/*
  # Add combo set lines support

  1. New Tables
    - `planned_combo_set_lines`
      - `id` (uuid, primary key)
      - `planned_combo_id` (uuid, foreign key to planned_combos)
      - `position` (integer) - Order of the set line (1, 2, 3...)
      - `load_value` (numeric) - Load for this line
      - `sets` (integer) - Number of sets for this line
      - `reps_tuple_text` (text) - Reps tuple for each exercise (e.g., "2+2+2")
      - `created_at` (timestamptz)
  
  2. Changes
    - This allows combos to have multiple set lines with different loads
    - Format: "80 x 2+2+2 x 3, 85 x 2+2+2 x 2" becomes two rows
    - Maintains compatibility with existing single-load combos
  
  3. Security
    - Enable RLS with anonymous access (matching existing patterns)
*/

-- Create planned combo set lines table
CREATE TABLE IF NOT EXISTS planned_combo_set_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_combo_id uuid REFERENCES planned_combos(id) ON DELETE CASCADE NOT NULL,
  position integer NOT NULL,
  load_value numeric DEFAULT 0,
  sets integer NOT NULL,
  reps_tuple_text text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_combo_line_position CHECK (position > 0),
  CONSTRAINT valid_combo_line_sets CHECK (sets >= 1),
  UNIQUE(planned_combo_id, position)
);

-- Enable RLS
ALTER TABLE planned_combo_set_lines ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Anyone can view combo set lines"
  ON planned_combo_set_lines
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert combo set lines"
  ON planned_combo_set_lines
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update combo set lines"
  ON planned_combo_set_lines
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete combo set lines"
  ON planned_combo_set_lines
  FOR DELETE
  USING (true);

-- Create index
CREATE INDEX IF NOT EXISTS idx_combo_set_lines_combo ON planned_combo_set_lines(planned_combo_id);
