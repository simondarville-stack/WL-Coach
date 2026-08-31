-- Last-synced stamp on group week plans.
--
-- The Sync wizard (GroupSyncModal) writes these after every run so the group
-- plan banner can show "Last synced 2h ago by Coach A" — the context a
-- co-coach was missing before re-syncing over a colleague's work.
--
-- Written on the GROUP plan row only (is_group_plan = true); athlete plans
-- already carry source_group_plan_id for lineage. Mirrors the
-- last_edited_by_coach_id pattern from 20260530000001_coach_sharing.sql.
--
-- Rollback:
--   ALTER TABLE week_plans DROP COLUMN IF EXISTS last_synced_at;
--   ALTER TABLE week_plans DROP COLUMN IF EXISTS last_synced_by_coach_id;

ALTER TABLE week_plans
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_by_coach_id uuid REFERENCES coach_profiles(id);

COMMENT ON COLUMN week_plans.last_synced_at IS
  'When this group plan was last synced to its athletes. Null = never synced (or synced before the column existed).';
COMMENT ON COLUMN week_plans.last_synced_by_coach_id IS
  'Coach who ran the last sync of this group plan.';
