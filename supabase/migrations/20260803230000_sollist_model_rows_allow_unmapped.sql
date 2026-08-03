-- Let a saved Soll-Ist model keep rows that are not (yet) mapped to a
-- catalogue exercise.
--
-- Why: the textbook presets (BVDG Senior / U23 / Junior) are 23 rows each,
-- matched against the coach's own catalogue by name and alias. Against a
-- Danish catalogue several rows legitimately fail to resolve. Because
-- exercise_id was NOT NULL, forking a preset silently DROPPED every one of
-- those rows on save — the coach corrected the numbers, saved, reopened, and
-- found rows missing. Keeping the row with its source label instead means the
-- fork is lossless and the coach can repoint the stragglers whenever they get
-- to it.
--
-- Additive and safe: both tables hold 0 rows today, so there is nothing to
-- backfill and nothing to lose.
ALTER TABLE public.sollist_model_rows ALTER COLUMN exercise_id DROP NOT NULL;

-- The source label an unmapped row came from (a preset's German/Danish
-- movement name, or a CSV cell). Null for mapped rows, which take their label
-- from the catalogue at read time so a renamed exercise stays in sync.
ALTER TABLE public.sollist_model_rows ADD COLUMN IF NOT EXISTS label text;

COMMENT ON COLUMN public.sollist_model_rows.label IS
  'Source label for a row with no exercise_id yet. Mapped rows read their label from the catalogue.';
