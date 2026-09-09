-- KinEMOS P9 §11.1 — what the reference bands and the jerk's dip need from
-- the athlete (docs/KINEMOS_P9_PLAN.md §6, §13).
--
--   athletes.sex        — 'men' | 'women' as the BVDG tables are stated
--                         (free text, not an enum: a federation's categories
--                         are the coach's business). Null: not declared; the
--                         bands then use the coach's pick in the viewer.
--   athletes.height_cm  — standing height, so a jerk's dip depth can be read
--                         as a share of the lifter's height (the material's
--                         16–22 cm is a men's-squad figure; a share travels
--                         across sizes).
--
-- `bodyweight` and `weight_class` already exist and give the weight-class
-- tier the tables are grouped by.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS sex text NULL;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS height_cm numeric NULL;
