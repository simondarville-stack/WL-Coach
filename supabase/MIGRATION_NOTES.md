# Migration Notes

## Naming inconsistencies

Most migrations follow `YYYYMMDDHHMMSS_description.sql` or `YYYYMMDD_description.sql`.
One file has a space in the name:

```
20260330100000 add video image exercises.sql   ← space instead of underscore
```

Supabase CLI handles this but it's non-standard. Rename if re-applying.

---

## Unsupported syntax

**File:** `20260330100000 add video image exercises.sql` (lines 72, 77, 82)

Uses `CREATE POLICY IF NOT EXISTS ...` which is not supported in PostgreSQL.
Supabase likely ignores these silently or errors during `supabase db push`.

**Fix pattern:**
```sql
DO $$ BEGIN
  DROP POLICY IF EXISTS "policy-name" ON storage.objects;
  CREATE POLICY "policy-name" ON storage.objects ...;
END $$;
```

These are storage bucket policies for `planner-media`. If the bucket was set up
manually or the policies already exist, these lines are harmless no-ops.
Verify by checking `storage.policies` in the Supabase dashboard.

---

## Potentially dead migrations

- `20260215153750_add_is_active_to_macrocycles_and_fix_rls.sql` adds `is_active`
  to macrocycles. The column exists in the DB but is no longer used in the code
  (not in the MacroCycle interface). Low risk to keep.

- `20260212135324_create_categories_table.sql` creates a `categories` table.
  The app uses a string `category` field on exercises, not a FK to this table.
  This table may be unused. Safe to leave in place.

---

## No conflicting migrations found

All migrations appear to be additive (CREATE TABLE, ALTER TABLE ADD COLUMN).
No migrations create then drop the same table or column.
