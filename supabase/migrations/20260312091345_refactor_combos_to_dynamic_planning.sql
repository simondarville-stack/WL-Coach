/*
  # Refactor combos from catalogue-defined to planner-defined

  1. Modified Tables
    - `planned_combos`
      - Make `template_id` nullable (no longer required)
      - Add `combo_name` (text, nullable) - optional user label for the combo

  2. Notes
    - Combo templates (exercise_combo_templates, exercise_combo_template_parts) are left
      intact so existing data is preserved, but they will no longer be used in the UI.
    - Existing planned_combos rows retain their template_id for historical reference.
    - New combos will be created with template_id = NULL and exercises chosen dynamically.
*/

ALTER TABLE planned_combos
  ALTER COLUMN template_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'planned_combos' AND column_name = 'combo_name'
  ) THEN
    ALTER TABLE planned_combos ADD COLUMN combo_name text;
  END IF;
END $$;
