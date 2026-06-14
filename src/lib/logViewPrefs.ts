/**
 * logViewPrefs — coach-side, device-local display preferences for the
 * Training Log overview.
 *
 * These are view-only preferences (how the coach wants the overview laid
 * out), NOT athlete data, so they live in localStorage rather than a
 * per-athlete/week config row — no migration, no server round-trip, and
 * they apply across every athlete the coach opens.
 */

const SHOW_ALL_WEEKDAYS_KEY = 'emos.logOverview.showAllWeekdays';

/**
 * Whether the overview metric tables show all seven weekdays (Mon–Sun)
 * rather than only the weekdays that have a logged session. Defaults to
 * false (compact: only weekdays with a session).
 */
export function getShowAllWeekdays(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_WEEKDAYS_KEY) === '1';
  } catch {
    return false;
  }
}

export function setShowAllWeekdays(value: boolean): void {
  try {
    localStorage.setItem(SHOW_ALL_WEEKDAYS_KEY, value ? '1' : '0');
  } catch {
    /* localStorage unavailable (private mode / SSR) — preference is best-effort */
  }
}
