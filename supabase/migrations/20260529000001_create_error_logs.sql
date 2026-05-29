-- PROPOSED MIGRATION — REQUIRES MANUAL APPLICATION
-- Creates the error_logs table used by the in-app error capture system.
-- Errors are written by the client (errorLogger.ts) from three paths:
--   * React error boundary (componentDidCatch)
--   * window 'error' / 'unhandledrejection' listeners
--   * explicit logError() calls (e.g. Supabase mutation failures)
-- Each row carries the last N breadcrumbs (route changes, clicks,
-- mutations) so reviewers can see what the user did before the failure.
--
-- Anon transitional policy matches the rest of the schema until Auth
-- cutover. Owner isolation is intentionally absent: errors are not
-- coach-scoped data — they're operational telemetry shared across the
-- single deployment.
--
-- Rollback:
--   DROP TABLE IF EXISTS error_logs;

CREATE TABLE IF NOT EXISTS error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Where the error came from. Constrained to known sources so the
  -- viewer can group cleanly; new sources require migration + logger
  -- update so the set stays disciplined.
  source text NOT NULL CHECK (source IN ('react', 'window', 'promise', 'manual', 'supabase')),

  name text,
  message text NOT NULL,
  stack text,
  error_code text,

  url text,
  user_agent text,
  app_version text,

  -- Actor context. role is loose-coupled so a future auth model can add
  -- 'admin' or similar without a migration; the viewer treats unknown
  -- roles as 'unknown'.
  actor_role text,
  actor_id uuid,
  actor_label text,

  -- Ring-buffer snapshot at the moment of error. Newest crumb last.
  breadcrumbs jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Free-form payload (componentStack, supabase error details, etc.)
  context jsonb,

  resolved_at timestamptz,
  resolved_note text
);

CREATE INDEX IF NOT EXISTS error_logs_created_at_idx
  ON error_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS error_logs_actor_idx
  ON error_logs (actor_role, actor_id);

CREATE INDEX IF NOT EXISTS error_logs_unresolved_idx
  ON error_logs (created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_all ON error_logs
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);
