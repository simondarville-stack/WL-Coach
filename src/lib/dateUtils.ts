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

// Deterministic English weekday names — avoids locale-dependent ordering
// (toLocaleDateString flips numeric dates to US month-first on en-US machines).
// UI labels stay English per CLAUDE.md; only numeric formatting is localised.
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** Short ("Mon") or long ("Monday") English weekday for a YYYY-MM-DD / ISO date. */
export function formatWeekday(dateStr: string, style: 'short' | 'long' = 'short'): string {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return (style === 'long' ? WEEKDAY_LONG : WEEKDAY_SHORT)[d.getDay()];
}

// Monday-first short labels, indexed 0=Mon … 6=Sun, matching the European
// week convention used across EMOS (weeks start Monday — see Stack/CLAUDE.md).
const WEEKDAY_SHORT_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Monday-based weekday index (0=Mon … 6=Sun) for a YYYY-MM-DD / ISO date,
 * or null when the date can't be parsed. Use this to bucket session dates
 * onto the actual weekday they fall on, independent of the planned slot.
 */
export function weekdayIndexMonday(dateStr: string): number | null {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return (d.getDay() + 6) % 7;
}

/** Short English weekday ("Mon") for a Monday-based index (0=Mon … 6=Sun). */
export function weekdayShortFromMonday(i: number): string {
  return WEEKDAY_SHORT_MON[((i % 7) + 7) % 7] ?? '';
}

/** "Mon 10/06" — short weekday + day-first date. */
export function formatWeekdayDateShort(dateStr: string): string {
  const date = formatDateShort(dateStr);
  return date ? `${formatWeekday(dateStr, 'short')} ${date}` : '';
}

/** "Monday 10/06" — long weekday + day-first date. */
export function formatWeekdayDateLong(dateStr: string): string {
  const date = formatDateShort(dateStr);
  return date ? `${formatWeekday(dateStr, 'long')} ${date}` : '';
}

/** "16:00" (or "16:00:01") — 24-hour local time from an ISO timestamp / Date. */
export function formatTime24(value: string | Date, withSeconds = false): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (withSeconds) {
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}`;
}

/**
 * Combine a 'YYYY-MM-DD' date and a 'HH:mm' 24h time into an ISO instant,
 * interpreting both as local wall-clock (browser timezone) — the same
 * local-Date → toISOString() convention ensureSession uses to stamp
 * started_at. Round-trips with formatTime24 (which reads back in local time).
 * Missing/blank parts fall back to 0 so a partial input never throws.
 */
export function combineDateTimeToISO(dateYMD: string, timeHHmm: string): string {
  const [y, m, d] = (dateYMD || '').split('-').map(Number);
  const [hh, mm] = (timeHHmm || '').split(':').map(Number);
  return new Date(
    y || 1970,
    (m || 1) - 1,
    d || 1,
    hh || 0,
    mm || 0,
    0,
    0,
  ).toISOString();
}

/** "10/06 16:00" — day-first date + 24h time, for comment-thread stamps. */
export function formatDateTimeShort(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDateShort(d.toISOString())} ${formatTime24(d)}`;
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
