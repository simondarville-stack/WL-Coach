// Pure week/cycle utility functions — no React dependencies
import { getMondayOfWeek, addDaysToISO, toLocalISO } from './dateUtils';

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

export function findCurrentMacroWeek<T extends { week_start: string }>(macroWeeks: T[]): T | null {
  const today = new Date();
  return macroWeeks.find(mw => {
    const start = new Date(mw.week_start);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return today >= start && today < end;
  }) ?? null;
}

export function generateMacroWeeks(
  startDate: string,
  endDate: string,
): Array<{ week_start: string; week_number: number }> {
  const weeks: Array<{ week_start: string; week_number: number }> = [];
  const start = getMondayOfWeek(new Date(startDate));
  const end = new Date(endDate);
  let current = new Date(start);
  let weekNumber = 1;

  while (current <= end) {
    weeks.push({
      // Local-component serialisation (toLocalISO), not `.toISOString()`, so a
      // Monday stays a Monday for positive-UTC coaches. See DD-01/02.
      week_start: toLocalISO(current),
      week_number: weekNumber,
    });
    current.setDate(current.getDate() + 7);
    weekNumber++;
  }

  return weeks;
}

export function getWeekTypeColor(abbreviation: string, weekTypes: import('./database.types').WeekTypeConfig[]): string {
  const wt = weekTypes.find(t => t.abbreviation === abbreviation)
          ?? weekTypes.find(t => t.name.toLowerCase() === abbreviation.toLowerCase());
  return wt?.color ?? '#9ca3af';
}
