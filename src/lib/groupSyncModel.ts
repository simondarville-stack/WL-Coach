/**
 * groupSyncModel — the pure half of the group-plan sync engine.
 *
 * What one sync would DO to one athlete, as data: the classification of the
 * athlete's rows against the group plan, and how each sync mode folds that
 * classification into an outcome. No Supabase, no React — the Sync wizard's
 * preview, the execution in `groupSyncService.ts` and the unit tests all
 * share this one truth.
 *
 * A "slot" is (exercise_id, day_index) — the same key the individual-override
 * check has always used.
 */

export type SyncMode = 'update' | 'overwrite' | 'append';

/** One group-plan exercise, as the preview shows it. */
export interface SyncSlot {
  /** `${exercise_id}:${day_index}` — the override key. */
  key: string;
  dayIndex: number;
  /** Resolved display label (display_name / combo notation / catalogue name). */
  label: string;
}

/**
 * Mode-independent classification of one athlete against the group plan.
 * The first four arrays partition the GROUP plan's rows; `stale`/`extras`
 * describe athlete rows the group plan doesn't cover.
 */
export interface AthleteSyncClassification {
  /** Group rows on a slot the athlete has no row for → inserted in every mode. */
  add: SyncSlot[];
  /** Group rows on a slot held by an unlogged group-sourced athlete row. */
  replace: SyncSlot[];
  /** Group rows on a slot held by an unlogged individual (coach-edited) row. */
  pinned: SyncSlot[];
  /** Group rows on a slot the athlete has logged against → kept in every mode. */
  logged: SyncSlot[];
  /** Unlogged group-sourced athlete rows on slots the group no longer trains. */
  stale: SyncSlot[];
  /** Athlete rows the sync never touches (individual/untracked rows off the group's slots). */
  extras: number;
}

/** What one classified athlete turns into under a given mode. */
export interface ModeOutcome {
  added: number;
  replaced: number;
  /** Individual overrides replaced — only ever non-zero under 'overwrite'. */
  overwritten: number;
  /** Pinned individual rows left in place ('update' / 'append'). */
  keptPinned: number;
  /** Logged rows left in place (every mode). */
  keptLogged: number;
  /** Stale group rows deleted ('update' / 'overwrite'). */
  removed: number;
}

/** Minimal row shapes the classifier needs — independent of the DB types. */
export interface ClassifiableGroupRow {
  exercise_id: string;
  day_index: number;
  label: string;
}
export interface ClassifiableAthleteRow {
  id: string;
  exercise_id: string;
  day_index: number;
  source: 'group' | 'individual' | null;
  label: string;
}

export const slotKey = (exerciseId: string, dayIndex: number) => `${exerciseId}:${dayIndex}`;

/**
 * Classify one athlete's rows against the group plan.
 *
 * Priority per slot: logged beats individual beats group-sourced — a slot the
 * athlete has logged is untouchable no matter what else sits on it. Rows with
 * `source = null` (written before source tracking) are deliberately invisible
 * here, matching the historical sync: they neither suppress an incoming copy
 * nor get deleted.
 */
export function classifyAthleteRows(
  groupRows: ClassifiableGroupRow[],
  athleteRows: ClassifiableAthleteRow[],
  loggedRowIds: ReadonlySet<string>,
): AthleteSyncClassification {
  const loggedKeys = new Set<string>();
  const individualKeys = new Set<string>();
  const groupSourcedKeys = new Set<string>();
  for (const row of athleteRows) {
    const key = slotKey(row.exercise_id, row.day_index);
    if (loggedRowIds.has(row.id)) loggedKeys.add(key);
    else if (row.source === 'individual') individualKeys.add(key);
    else if (row.source === 'group') groupSourcedKeys.add(key);
  }

  const groupKeys = new Set(groupRows.map(r => slotKey(r.exercise_id, r.day_index)));

  const out: AthleteSyncClassification = {
    add: [], replace: [], pinned: [], logged: [], stale: [], extras: 0,
  };
  for (const row of groupRows) {
    const key = slotKey(row.exercise_id, row.day_index);
    const slot: SyncSlot = { key, dayIndex: row.day_index, label: row.label };
    if (loggedKeys.has(key)) out.logged.push(slot);
    else if (individualKeys.has(key)) out.pinned.push(slot);
    else if (groupSourcedKeys.has(key)) out.replace.push(slot);
    else out.add.push(slot);
  }

  for (const row of athleteRows) {
    const key = slotKey(row.exercise_id, row.day_index);
    if (groupKeys.has(key)) continue;
    if (row.source === 'group' && !loggedRowIds.has(row.id)) {
      out.stale.push({ key, dayIndex: row.day_index, label: row.label });
    } else {
      out.extras += 1;
    }
  }
  return out;
}

/** Fold a classification into what a given mode would actually do. */
export function outcomeForMode(c: AthleteSyncClassification, mode: SyncMode): ModeOutcome {
  return {
    added: c.add.length,
    replaced: mode === 'append' ? 0 : c.replace.length,
    overwritten: mode === 'overwrite' ? c.pinned.length : 0,
    keptPinned: mode === 'overwrite' ? 0 : c.pinned.length,
    keptLogged: c.logged.length + (mode === 'append' ? c.replace.length : 0),
    removed: mode === 'append' ? 0 : c.stale.length,
  };
}
