/** Format a Date object as a local YYYY-MM-DD string (timezone-safe). */
export function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add (or subtract) weeks from an ISO date string, returning a local ISO string. */
export function addWeeks(isoDate: string, weeks: number): string {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + weeks * 7);
  return toLocalISO(d);
}

export function formatDateToDDMMYYYY(dateString: string | null | undefined): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatDateShort(dateString: string): string {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

export function parseDDMMYYYYToISO(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('/');
  if (parts.length !== 3) return '';
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function formatISOToDateInput(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

// ── Canonical UTC-consistent week-key arithmetic ────────────────────────────
// Week starts Monday (European convention). All operations parse with an
// explicit UTC midnight and serialise by slicing the ISO string, so a coach in
// ANY timezone — especially positive-UTC Europe — gets identical, DST-stable
// week keys. Use these for week bucketing and macro joins. Do NOT mix local
// Date math with `.toISOString()`: that rolls the date back a day for
// positive-UTC users and is what produced the non-Monday `week_start` rows in
// production (see REVIEW_PLAN_analysis_module.md, invariant #4 / DD-01/02).

/** UTC-consistent Monday of the week containing the given YYYY-MM-DD date. */
export function isoMonday(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

/** Add (or subtract) days from a YYYY-MM-DD date, UTC-consistent. */
export function isoAddDays(dateStr: string, days: number): string {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Add (or subtract) weeks from a YYYY-MM-DD date, UTC-consistent. */
export function isoAddWeeks(dateStr: string, weeks: number): string {
  return isoAddDays(dateStr, weeks * 7);
}

/**
 * Snap a possibly-corrupted `week_start` to the NEAREST Monday.
 *
 * The legacy `toISOString()` serialisation bug stored some week-starts one day
 * early (a Monday saved as the preceding Sunday for positive-UTC coaches).
 * "Monday of this week" would snap such a Sunday *backward six days*; snapping
 * to the nearest Monday instead moves it forward one day to the intended week.
 * A value that is already a Monday is returned unchanged.
 */
export function snapToMonday(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  const offset = (d.getUTCDay() + 6) % 7; // 0=Mon..6=Sun (days since Monday)
  const shift = offset <= 3 ? -offset : 7 - offset; // nearest Monday
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of Monday week-starts spanning the two dates (UTC-consistent). */
export function weekStartsBetween(fromStr: string, toStr: string): string[] {
  const out: string[] = [];
  const end = toStr.slice(0, 10);
  let cur = isoMonday(fromStr);
  while (cur <= end) {
    out.push(cur);
    cur = isoAddWeeks(cur, 1);
  }
  return out;
}

/** Whole weeks between two dates (b − a), using Monday-aligned keys. */
export function weeksBetween(aStr: string, bStr: string): number {
  const a = new Date(isoMonday(aStr) + 'T00:00:00Z').getTime();
  const b = new Date(isoMonday(bStr) + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (7 * 86400000));
}

/**
 * ISO 8601 week number. Week starts Monday. Week 1 of a year is the
 * week containing the first Thursday (equivalently, 4 Jan).
 */
export function getISOWeek(date: Date): number {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  // Thursday in current ISO week
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const jan4 = new Date(target.getFullYear(), 0, 4);
  const jan4Monday = new Date(jan4);
  jan4Monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  return 1 + Math.round((target.getTime() - jan4Monday.getTime()) / (7 * 86400000));
}

export function addDaysToISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toLocalISO(d);
}

export function formatDateRange(startDateStr: string, numDays: number = 7): string {
  const start = new Date(startDateStr);
  const end = new Date(start);
  end.setDate(start.getDate() + numDays - 1);

  const startDay = String(start.getDate()).padStart(2, '0');
  const startMonth = String(start.getMonth() + 1).padStart(2, '0');
  const startYear = start.getFullYear();

  const endDay = String(end.getDate()).padStart(2, '0');
  const endMonth = String(end.getMonth() + 1).padStart(2, '0');
  const endYear = end.getFullYear();

  if (startYear === endYear && startMonth === endMonth) {
    return `${startDay}-${endDay}/${startMonth}/${startYear}`;
  } else if (startYear === endYear) {
    return `${startDay}/${startMonth} - ${endDay}/${endMonth}/${startYear}`;
  } else {
    return `${startDay}/${startMonth}/${startYear} - ${endDay}/${endMonth}/${endYear}`;
  }
}
