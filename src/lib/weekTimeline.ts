/**
 * weekTimeline — where inside its week a training unit sits.
 *
 * EMOS supports two ways of writing a week, and the history chart has to place
 * a session honestly under both:
 *
 *  - **Fixed time.** The coach has given the unit a weekday (and possibly a
 *    clock time) in `week_plans.day_schedule`. That IS the position: Wednesday
 *    16:00 belongs on Wednesday, not at "unit 2 of 3".
 *  - **Free sessions.** No schedule — a unit is just "the second session this
 *    week". There is no calendar answer, so the units are spread evenly across
 *    the week and strictly inside it: with three sessions they sit at 1/4, 2/4
 *    and 3/4 between this week's divider and the next.
 *
 * Everything returns a fraction of the week: 0 is this week's Monday 00:00 and
 * 1 is the next week's Monday. Callers add it to a week index to get a
 * continuous x position.
 *
 * Pure — no Supabase, no React.
 */

/** A unit's scheduled slot. `weekday` is Monday-based (0 = Mon … 6 = Sun). */
export interface DaySlot {
  weekday: number;
  /** "HH:MM", or null when the coach set a weekday but no clock time. */
  time: string | null;
}

export type DaySchedule = Record<string, DaySlot> | null | undefined;

const MINUTES_PER_WEEK = 7 * 24 * 60;

/** Minutes into the day for "HH:MM", or null when unparseable. */
export function parseClockMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * The week's units in the order the coach sees them — the planner's own rule:
 * the explicit display order filtered to active days, otherwise active days
 * ascending. Days in `active_days` that the order forgot are appended, so a
 * unit can never vanish from the timeline just because the order is stale.
 */
export function orderedUnits(
  activeDays: number[] | null | undefined,
  displayOrder: number[] | null | undefined,
): number[] {
  const active = [...new Set(activeDays ?? [])].sort((a, b) => a - b);
  if (!displayOrder || displayOrder.length === 0) return active;
  const ordered = displayOrder.filter(d => active.includes(d));
  const missing = active.filter(d => !ordered.includes(d));
  return [...ordered, ...missing];
}

/**
 * Where a scheduled unit sits: its weekday, plus the clock time when there is
 * one. Without a time, midday of that weekday — a session with a named day but
 * no hour belongs in the middle of that day, not at midnight on its edge.
 */
export function scheduledFraction(slot: DaySlot): number {
  const weekday = Math.min(6, Math.max(0, Math.round(slot.weekday)));
  const minutes = parseClockMinutes(slot.time) ?? 12 * 60;
  return (weekday * 24 * 60 + minutes) / MINUTES_PER_WEEK;
}

/**
 * Where a free (unscheduled) unit sits: evenly across the week by its ordinal.
 *
 * Session k of n lands at k/(n+1), which spreads n sessions across n+1 equal
 * gaps — three sessions sit at 1/4, 2/4, 3/4. The k/n reading (2/3 for session
 * 2 of 3) is the more literal one, but it puts the LAST session of every week
 * exactly on the next week's divider, where it reads as belonging to the wrong
 * week and collides with the gridline. Keeping every session strictly inside
 * its own week is worth the half-step.
 *
 * Returns null when the unit is not in the week's ordered list at all, so the
 * caller can fall back rather than invent a position.
 */
export function ordinalFraction(dayIndex: number, ordered: number[]): number | null {
  const i = ordered.indexOf(dayIndex);
  if (i < 0 || ordered.length === 0) return null;
  return (i + 1) / (ordered.length + 1);
}

export interface UnitPlacement {
  fraction: number;
  /** How the position was decided — drives the tooltip's wording. */
  basis: 'scheduled' | 'ordinal' | 'fallback';
}

/**
 * Place one planned unit within its week. Fixed time wins; otherwise the
 * ordinal spread; otherwise mid-week, which only happens for a unit that is not
 * in `active_days` at all (a leftover row on a day the coach has since turned
 * off — it still has to render somewhere).
 */
export function placeUnit(args: {
  dayIndex: number;
  activeDays: number[] | null | undefined;
  displayOrder: number[] | null | undefined;
  schedule: DaySchedule;
}): UnitPlacement {
  const slot = args.schedule?.[String(args.dayIndex)];
  if (slot && Number.isFinite(slot.weekday)) {
    return { fraction: scheduledFraction(slot), basis: 'scheduled' };
  }
  const ordinal = ordinalFraction(args.dayIndex, orderedUnits(args.activeDays, args.displayOrder));
  if (ordinal != null) return { fraction: ordinal, basis: 'ordinal' };
  return { fraction: 0.5, basis: 'fallback' };
}

/**
 * Where a LOGGED session sits: its real date, which beats both rules above
 * because it is what actually happened. `weekStart` is the Monday the session
 * is being plotted under; a date outside that week clamps into it rather than
 * bleeding into a neighbour's column.
 */
export function placeLoggedDate(
  weekStart: string,
  date: string,
  time?: string | null,
): number {
  const ms = Date.parse(date.slice(0, 10) + 'T00:00:00Z') - Date.parse(weekStart.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(ms)) return 0.5;
  const dayOffset = Math.round(ms / 86_400_000);
  const clamped = Math.min(6, Math.max(0, dayOffset));
  const minutes = parseClockMinutes(time) ?? 12 * 60;
  return (clamped * 24 * 60 + minutes) / MINUTES_PER_WEEK;
}
