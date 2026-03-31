// Pure week/cycle utility functions — no React dependencies
import { getMondayOfWeek } from './dateUtils';

export function getCurrentAndNextWeekStart(): { weekStartISO: string; nextWeekStartISO: string } {
  const monday = getMondayOfWeek(new Date());
  const weekStartISO = monday.toISOString().split('T')[0];

  const nextMonday = new Date(monday);
  nextMonday.setDate(nextMonday.getDate() + 7);
  const nextWeekStartISO = nextMonday.toISOString().split('T')[0];

  return { weekStartISO, nextWeekStartISO };
}

export function getMondayOfWeekISO(date: Date): string {
  return getMondayOfWeek(date).toISOString().split('T')[0];
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
      week_start: current.toISOString().split('T')[0],
      week_number: weekNumber,
    });
    current.setDate(current.getDate() + 7);
    weekNumber++;
  }

  return weeks;
}

export function getMacroWeekColor(weekTypeText: string): string {
  const lower = weekTypeText.toLowerCase();
  if (lower.includes('deload') || lower.includes('low')) return 'bg-green-50';
  if (lower.includes('high')) return 'bg-orange-50';
  return 'bg-white';
}
