// Local draft store for in-progress prescription edits.
//
// The planner writes every prescription change straight to Supabase. On an
// unstable connection (gym Wi-Fi) a save can fail mid-write, and because the
// typed value lived only in React state it was lost on the next reload. This
// module mirrors each edit to localStorage *before* the network write and
// clears it only after the write confirms. A surviving draft therefore always
// means "this edit was never confirmed saved" and can be offered back to the
// coach for restore on the next load.
//
// Scope is deliberately small (Part 1): prescription edits only, keyed by the
// planned_exercise id. Day-structure edits could be layered on the same way.

import type { DefaultUnit } from './database.types';

export interface PrescriptionDraft {
  /** planned_exercises.id the edit targets — globally unique. */
  plannedExId: string;
  /** week_plans.id the exercise belongs to, used to scope the restore prompt. */
  weekPlanId: string;
  /** Display name for the restore banner. */
  exerciseName: string;
  /** Day the exercise sits on (for labelling); null if it couldn't be resolved. */
  dayIndex: number | null;
  /** The raw prescription text the coach entered. */
  prescription: string;
  unit: DefaultUnit;
  isCombo: boolean;
  /** Epoch ms of the edit, for pruning and last-write-wins. */
  updatedAt: number;
}

const STORAGE_KEY = 'emos:planner:prescription-drafts:v1';
const MAX_DRAFTS = 200;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function readAll(): Record<string, PrescriptionDraft> {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PrescriptionDraft>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Corrupt payload — drop it rather than throw into the save path.
    return {};
  }
}

function writeAll(map: Record<string, PrescriptionDraft>): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded / private mode — best effort, never break the editor.
  }
}

/** Drop entries older than MAX_AGE_MS and cap total count (oldest first). */
function prune(map: Record<string, PrescriptionDraft>): Record<string, PrescriptionDraft> {
  const now = Date.now();
  let entries = Object.values(map).filter(d => now - d.updatedAt <= MAX_AGE_MS);
  if (entries.length > MAX_DRAFTS) {
    entries = entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_DRAFTS);
  }
  const next: Record<string, PrescriptionDraft> = {};
  for (const d of entries) next[d.plannedExId] = d;
  return next;
}

/** Record (or overwrite) the draft for one planned exercise. */
export function recordPrescriptionDraft(draft: PrescriptionDraft): void {
  const map = readAll();
  map[draft.plannedExId] = draft;
  writeAll(prune(map));
}

/** Remove the draft for one planned exercise (call after a confirmed save). */
export function clearPrescriptionDraft(plannedExId: string): void {
  const map = readAll();
  if (map[plannedExId]) {
    delete map[plannedExId];
    writeAll(map);
  }
}

/** All drafts belonging to a given week plan. */
export function getPrescriptionDraftsForWeek(weekPlanId: string): PrescriptionDraft[] {
  return Object.values(readAll()).filter(d => d.weekPlanId === weekPlanId);
}

/** Remove every draft for a week plan (used by "Discard"). */
export function clearPrescriptionDraftsForWeek(weekPlanId: string): void {
  const map = readAll();
  let changed = false;
  for (const id of Object.keys(map)) {
    if (map[id].weekPlanId === weekPlanId) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) writeAll(map);
}
