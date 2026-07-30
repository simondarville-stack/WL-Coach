// Pure week/cycle utility functions — no React dependencies
import { getMondayOfWeek, addDaysToISO, isoMonday, isoAddWeeks } from './dateUtils';

export function getCurrentAndNextWeekStart(): { weekStartISO: string; nextWeekStartISO: string } {
  // Serialise via local-component formatting (getMondayOfWeekISO / addDaysToISO),
  // never `.toISOString()` on a locally-constructed Date — the latter rolls the
  // date back a day for positive-UTC coaches and is the source of the non-Monday
  // `week_start` rows in production. See REVIEW_PLAN_analysis_module.md DD-01/02.
  const weekStartISO = getMondayOfWeekISO(new Date());
  const nextWeekStartISO = addDaysToISO(weekStartISO, 7);

  return { weekStartISO, nextWeekStartISO };
}

export function getMondayOfWeekISO(date: Date): string {
  const monday = getMondayOfWeek(date);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type WeekState = 'past' | 'current' | 'future';

/**
 * Where a week sits relative to the current week, by Monday-aligned ISO compare
 * (all `week_start` values are Mondays, so the string compare is DST-safe).
 */
export function weekState(weekStart: string, todayMonday: string = getMondayOfWeekISO(new Date())): WeekState {
  if (weekStart < todayMonday) return 'past';
  if (weekStart === todayMonday) return 'current';
  return 'future';
}

/**
 * A week is "complete" only once the next Monday has arrived. Its compliance %
 * is a source of truth ONLY then — athletes choose their own rhythm within the
 * week (units aren't day-anchored), so a mid-week % understates and must not be
 * shown as a grade. The current week shows progress, not a percentage.
 */
export function isWeekComplete(weekStart: string, todayMonday?: string): boolean {
  return weekState(weekStart, todayMonday) === 'past';
}

export function findCurrentMacroWeek<T extends { week_start: string }>(macroWeeks: T[]): T | null {
  const today = new Date();
  return macroWeeks.find(mw => {
    const start = new Date(mw.week_start);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return today >= start && today < end;
  }) ?? null;
}

/**
 * Mondays of every week a cycle covers, WHOLE weeks at both ends: the week
 * holding `startDate` and the week holding `endDate` are both included, no
 * matter which weekday those dates fall on (weeks run Mon–Sun).
 *
 * The end bound is compared Monday-to-Monday, so any end date inside the
 * final week keeps that week — the earlier `weekMonday <= endDate` compare
 * dropped it whenever the stored end date was mid-week.
 *
 * Pure ISO string math (isoMonday / isoAddWeeks), never local Date stepping:
 * `setDate(+7)` preserves the local wall clock, so a cycle that crossed the
 * October DST change drifted an hour past UTC midnight and silently lost its
 * last week for positive-UTC coaches.
 */
export function generateMacroWeeks(
  startDate: string,
  endDate: string,
): Array<{ week_start: string; week_number: number }> {
  const weeks: Array<{ week_start: string; week_number: number }> = [];
  const lastMonday = isoMonday(endDate);
  let current = isoMonday(startDate);
  let weekNumber = 1;

  while (current <= lastMonday) {
    weeks.push({ week_start: current, week_number: weekNumber });
    current = isoAddWeeks(current, 1);
    weekNumber++;
  }

  return weeks;
}

export function getWeekTypeColor(abbreviation: string, weekTypes: import('./database.types').WeekTypeConfig[]): string {
  const wt = weekTypes.find(t => t.abbreviation === abbreviation)
          ?? weekTypes.find(t => t.name.toLowerCase() === abbreviation.toLowerCase());
  return wt?.color ?? '#9ca3af';
}
