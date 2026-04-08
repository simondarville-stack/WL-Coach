/*
  # Add visible_card_metrics to general_settings

  Separate setting for which metrics appear on the top of day cards,
  independent of visible_summary_metrics (week summary row).

  Default matches the existing default: reps, sets, max, tonnage.
*/

ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS visible_card_metrics text[]
    NOT NULL DEFAULT ARRAY['reps','sets','max','tonnage']::text[];
