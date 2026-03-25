/*
  # Create combo exercises tables

  1. New Tables
    - `exercise_combo_templates`
      - `id` (uuid, primary key)
      - `name` (text) - Template name (e.g., "Snatch Complex")
      - `unit` (text, nullable) - Optional default unit (kg/percentage/rpe)
      - `is_active` (boolean, default true) - Whether template is active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `exercise_combo_template_parts`
      - `id` (uuid, primary key)
      - `template_id` (uuid, foreign key to exercise_combo_templates)
      - `exercise_id` (uuid, foreign key to exercises)
      - `position` (integer) - Order of exercise in combo
      - `created_at` (timestamptz)
    
    - `planned_combos`
      - `id` (uuid, primary key)
      - `weekplan_id` (uuid, foreign key to week_plans)
      - `day_index` (integer 1..7) - Which day in the week
      - `position` (integer) - Position within the day
      - `template_id` (uuid, foreign key to exercise_combo_templates)
      - `unit` (text) - Unit for this combo instance (kg/percentage/rpe)
      - `shared_load_value` (numeric) - Single load applied to all parts
      - `sets` (integer, default 1) - Number of sets
      - `reps_tuple_text` (text) - e.g., "2+2+2" representing reps for each part
      - `notes` (text, nullable) - Optional notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `planned_combo_items`
      - `id` (uuid, primary key)
      - `planned_combo_id` (uuid, foreign key to planned_combos)
      - `exercise_id` (uuid, foreign key to exercises)
      - `position` (integer) - Order within the combo
      - `planned_exercise_id` (uuid, foreign key to planned_exercises) - Link to atomic storage
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Allow anonymous access for all operations (matching existing table patterns)

  3. Notes
    - Combos are displayed as grouped cards in the day view
    - Each combo expands to multiple PlannedExercises for atomic storage/metrics
    - The reps_tuple_text format is validated to match the number of parts
*/

-- Exercise combo templates
CREATE TABLE IF NOT EXISTS exercise_combo_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_combo_unit CHECK (unit IS NULL OR unit IN ('absolute_kg', 'percentage', 'rpe'))
);

-- Exercise combo template parts
CREATE TABLE IF NOT EXISTS exercise_combo_template_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES exercise_combo_templates(id) ON DELETE CASCADE NOT NULL,
  exercise_id uuid REFERENCES exercises(id) ON DELETE CASCADE NOT NULL,
  position integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_part_position CHECK (position > 0)
);

-- Planned combos
CREATE TABLE IF NOT EXISTS planned_combos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekplan_id uuid REFERENCES week_plans(id) ON DELETE CASCADE NOT NULL,
  day_index integer NOT NULL,
  position integer NOT NULL,
  template_id uuid REFERENCES exercise_combo_templates(id) ON DELETE RESTRICT NOT NULL,
  unit text NOT NULL,
  shared_load_value numeric DEFAULT 0,
  sets integer DEFAULT 1,
  reps_tuple_text text NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_combo_day_index CHECK (day_index >= 1 AND day_index <= 7),
  CONSTRAINT valid_combo_position CHECK (position > 0),
  CONSTRAINT valid_combo_unit CHECK (unit IN ('absolute_kg', 'percentage', 'rpe')),
  CONSTRAINT valid_combo_sets CHECK (sets >= 1)
);

-- Planned combo items
CREATE TABLE IF NOT EXISTS planned_combo_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_combo_id uuid REFERENCES planned_combos(id) ON DELETE CASCADE NOT NULL,
  exercise_id uuid REFERENCES exercises(id) ON DELETE CASCADE NOT NULL,
  position integer NOT NULL,
  planned_exercise_id uuid REFERENCES planned_exercises(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_item_position CHECK (position > 0),
  UNIQUE(planned_combo_id, position)
);

-- Enable RLS
ALTER TABLE exercise_combo_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_combo_template_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE planned_combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE planned_combo_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for exercise_combo_templates
CREATE POLICY "Anyone can view combo templates"
  ON exercise_combo_templates
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert combo templates"
  ON exercise_combo_templates
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update combo templates"
  ON exercise_combo_templates
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete combo templates"
  ON exercise_combo_templates
  FOR DELETE
  USING (true);

-- RLS policies for exercise_combo_template_parts
CREATE POLICY "Anyone can view combo template parts"
  ON exercise_combo_template_parts
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert combo template parts"
  ON exercise_combo_template_parts
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update combo template parts"
  ON exercise_combo_template_parts
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete combo template parts"
  ON exercise_combo_template_parts
  FOR DELETE
  USING (true);

-- RLS policies for planned_combos
CREATE POLICY "Anyone can view planned combos"
  ON planned_combos
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert planned combos"
  ON planned_combos
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update planned combos"
  ON planned_combos
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete planned combos"
  ON planned_combos
  FOR DELETE
  USING (true);

-- RLS policies for planned_combo_items
CREATE POLICY "Anyone can view planned combo items"
  ON planned_combo_items
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert planned combo items"
  ON planned_combo_items
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update planned combo items"
  ON planned_combo_items
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete planned combo items"
  ON planned_combo_items
  FOR DELETE
  USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_combo_template_parts_template ON exercise_combo_template_parts(template_id);
CREATE INDEX IF NOT EXISTS idx_combo_template_parts_exercise ON exercise_combo_template_parts(exercise_id);
CREATE INDEX IF NOT EXISTS idx_planned_combos_weekplan ON planned_combos(weekplan_id);
CREATE INDEX IF NOT EXISTS idx_planned_combos_day ON planned_combos(weekplan_id, day_index);
CREATE INDEX IF NOT EXISTS idx_planned_combo_items_combo ON planned_combo_items(planned_combo_id);
CREATE INDEX IF NOT EXISTS idx_planned_combo_items_exercise ON planned_combo_items(planned_exercise_id);
