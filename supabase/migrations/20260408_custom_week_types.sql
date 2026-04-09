/*
  # Add coach-defined week types to general_settings

  Each entry: { name: string, abbreviation: string, color: string }
  Defaults match the old hardcoded set (High/Medium/Low) using the
  abbreviated keys the new UI will produce.
*/

ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS week_types jsonb DEFAULT '[
    {"name": "High",   "abbreviation": "h", "color": "#E24B4A"},
    {"name": "Medium", "abbreviation": "m", "color": "#EF9F27"},
    {"name": "Low",    "abbreviation": "g", "color": "#1D9E75"}
  ]'::jsonb;
