-- Add macro_table_columns to general_settings so users can toggle which columns appear in the macro table
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS macro_table_columns TEXT[] DEFAULT ARRAY['week','weektype','k','tonnage','avg','notes']::TEXT[];
