/**
 * Extract a human-readable message from anything thrown.
 *
 * Supabase / PostgREST errors are plain objects shaped like
 * `{ message, code, details, hint }` and are NOT instances of Error, so
 * `String(err)` on them produces the useless string "[object Object]".
 * This helper pulls the best available field and, when present, appends
 * the PostgreSQL detail/hint so a coach reading the inbox actually sees
 * what went wrong (e.g. "column training_log_messages.owner_id does not
 * exist") instead of a generic placeholder.
 */
/**
 * Coach-facing copy for the unique constraints a coach can trip by typing a
 * name that is already taken. Keyed by constraint name because that is the
 * only thing Postgres tells us about *which* uniqueness failed.
 *
 * Without this, a duplicate category name surfaced as
 *   duplicate key value violates unique constraint "categories_owner_name_unique"
 *   — Key (owner_id, name)=(…) already exists.
 * which is a database implementation detail, not something a coach can act on.
 * Add a row here when a new user-named unique constraint ships.
 */
// Every entry here is verified against the live schema's unique constraints —
// a name invented from a guessed convention would silently never match and
// leave the raw error showing. Note there is deliberately no entry for
// training-group / macro-cycle / template names: those columns carry no unique
// constraint, so duplicates there are allowed, not errors.
const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  categories_owner_name_unique: 'A category with that name already exists.',
  exercises_owner_code_unique: 'An exercise with that code already exists.',
  macro_tracked_exercises_macrocycle_id_exercise_id_key:
    'That exercise is already tracked in this cycle.',
  athlete_prs_athlete_id_exercise_id_key:
    'This athlete already has a personal record for that exercise.',
  bodyweight_entries_athlete_id_date_key:
    'A bodyweight entry already exists for that date.',
  event_athletes_event_id_athlete_id_key:
    'That athlete is already attached to this event.',
};

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Friendly text for a unique-constraint violation, or null when this isn't one
 * (or is one we have no specific copy for — the caller then falls through to
 * the generic description rather than inventing a reassuring message).
 */
export function describeUniqueViolation(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code !== UNIQUE_VIOLATION) return null;
  const message = typeof e.message === 'string' ? e.message : '';
  for (const [constraint, friendly] of Object.entries(UNIQUE_CONSTRAINT_MESSAGES)) {
    if (message.includes(constraint)) return friendly;
  }
  return 'That name is already taken — pick a different one.';
}

export function describeError(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  // A duplicate name is the one DB error a coach causes and can fix, so it
  // gets plain language before the raw-detail path below (which would append
  // "Key (owner_id, name)=(…) already exists" and read as a crash).
  const duplicate = describeUniqueViolation(err);
  if (duplicate) return duplicate;
  if (err instanceof Error) return err.message || err.name || 'Error';
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === 'string' && e.message.trim()) parts.push(e.message.trim());
    if (typeof e.details === 'string' && e.details.trim()) parts.push(e.details.trim());
    if (typeof e.hint === 'string' && e.hint.trim()) parts.push(`hint: ${e.hint.trim()}`);
    if (parts.length === 0 && typeof e.code === 'string') parts.push(`Error ${e.code}`);
    if (parts.length === 0) {
      try {
        const json = JSON.stringify(err);
        if (json && json !== '{}') return json;
      } catch {
        // fall through
      }
      return 'Unknown error';
    }
    return parts.join(' — ');
  }
  return String(err);
}
