/**
 * Review feed coach settings — quick reactions + technique rating.
 *
 * Stored on general_settings (one row per coach). A NULL
 * review_quick_reactions falls back to DEFAULT_QUICK_REACTIONS, following the
 * phase_type_presets / rhythm_presets convention; an empty array is a real
 * choice ("no reaction chips"). Every consumer goes through the accessors
 * below so a coach whose settings row predates the columns (or hasn't loaded
 * yet) gets the product defaults.
 */
import type { GeneralSettings } from './database.types';

export const DEFAULT_QUICK_REACTIONS = [
  '👍',
  '💪 Strong work',
  '🔥 Great session',
  '👀 Noted — more later',
];

/** Reactions past this count have no keyboard shortcut (keys 1–9) and stop
 *  being scannable as chips, so the editor caps the list here. */
export const MAX_QUICK_REACTIONS = 9;

export function quickReactionsFrom(
  settings: Pick<GeneralSettings, 'review_quick_reactions'> | null,
): string[] {
  const list = settings?.review_quick_reactions;
  if (list == null) return DEFAULT_QUICK_REACTIONS;
  return list
    .map(r => r.trim())
    .filter(r => r !== '')
    .slice(0, MAX_QUICK_REACTIONS);
}

export function techniqueRatingEnabledFrom(
  settings: Pick<GeneralSettings, 'review_technique_rating_enabled'> | null,
): boolean {
  return settings?.review_technique_rating_enabled ?? true;
}
