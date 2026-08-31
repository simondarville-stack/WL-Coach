/**
 * groupPlanSync — how a group plan's *unit structure* lands on an athlete.
 *
 * The exercise copy is `useWeekPlans.syncGroupPlanToAthletes`'s job. This
 * module owns the smaller, fiddlier decision that sits next to it: which
 * training units exist on the athlete's week, what they are called, and in
 * what order they render.
 *
 * The rule in one line: **the group plan owns the identity of every unit in
 * its own `active_days`; everything else belongs to the athlete.** So a rename
 * in the group reaches every member on the next sync, while a bonus day the
 * athlete added is never touched — and a stray label the group happens to
 * carry for a day it doesn't train never leaks out at all.
 *
 * Pure by design: no Supabase, no React, so the merge can be unit-tested
 * without a database.
 */

export interface DaySchedule {
  weekday: number;
  time: string | null;
}

/** The four `week_plans` columns that describe a week's units. */
export interface WeekStructure {
  active_days: number[];
  day_labels: Record<string, string> | null;
  day_display_order: number[] | null;
  day_schedule: Record<string, DaySchedule> | null;
}

export type MergedStructure = Pick<
  WeekStructure,
  'active_days' | 'day_labels' | 'day_display_order' | 'day_schedule'
>;

/**
 * Narrow a label / schedule map to the days a plan actually trains.
 *
 * Needed because `saveDayLabels` persists the whole pre-filled editor map, so
 * a group plan routinely carries keys ("Unit 6", "Saturday") for days outside
 * its `active_days`. Pushing those would overwrite an athlete's bonus-day name
 * with a placeholder nobody typed.
 */
export function pickForDays<T>(
  map: Record<string, T> | null | undefined,
  days: number[],
): Record<string, T> {
  const out: Record<string, T> = {};
  if (!map) return out;
  for (const d of days) {
    const key = String(d);
    if (map[key] !== undefined && map[key] !== null) out[key] = map[key];
  }
  return out;
}

/**
 * Merge the group plan's unit structure into one athlete's.
 *
 * - `active_days` — union, sorted. A day is never *removed*: an athlete's own
 *   extra unit may hold planned rows and logs, and dropping it would orphan
 *   them.
 * - `day_labels` / `day_schedule` — the group's value wins, but only for days
 *   the group itself trains, and only when the group actually has one. Days
 *   outside `group.active_days` keep whatever the athlete has.
 *   With `opts.athleteWins` (append-mode sync: "never replace anything the
 *   athlete already has") the precedence flips: the group's label/schedule
 *   only fills days the athlete hasn't named/scheduled yet.
 * - `day_display_order` — new days are appended to the athlete's own order.
 *   The group's ordering is NOT adopted wholesale; re-sorting an athlete's
 *   week is not what "sync the plan" asks for. A null order stays null (the
 *   readers fall back to sorted `active_days`).
 *
 * Idempotent: merging twice equals merging once.
 */
export function mergeGroupStructureIntoAthlete(
  group: WeekStructure,
  athlete: WeekStructure,
  opts: { athleteWins?: boolean } = {},
): MergedStructure {
  const groupActive = group.active_days ?? [];
  const athleteActive = athlete.active_days ?? [];

  const newDays = groupActive.filter(d => !athleteActive.includes(d));
  const active_days = [...athleteActive, ...newDays].sort((a, b) => a - b);

  const day_labels = opts.athleteWins
    ? { ...pickForDays(group.day_labels, groupActive), ...(athlete.day_labels ?? {}) }
    : { ...(athlete.day_labels ?? {}), ...pickForDays(group.day_labels, groupActive) };
  const day_schedule = opts.athleteWins
    ? { ...pickForDays(group.day_schedule, groupActive), ...(athlete.day_schedule ?? {}) }
    : { ...(athlete.day_schedule ?? {}), ...pickForDays(group.day_schedule, groupActive) };

  // Only extend an order the athlete already has. Leaving it null keeps the
  // "no explicit order" state, which every reader handles; inventing one here
  // would freeze today's ordering into the row for no reason.
  const day_display_order = athlete.day_display_order
    ? [
        ...athlete.day_display_order,
        ...newDays.filter(d => !athlete.day_display_order!.includes(d)),
      ]
    : null;

  return { active_days, day_labels, day_display_order, day_schedule };
}

/**
 * The structure a brand-new athlete plan should be born with when the sync
 * creates it — the group's own rhythm, not the column default `[1,2,3,4,5]`.
 *
 * Without this, a group training three units handed every athlete a five-unit
 * week with two permanently empty, unnamed cards, and no later sync could
 * clean them up (the merge above never removes a day, deliberately).
 *
 * Returns `null` for a group with no active days, so the caller omits the
 * columns entirely and the database defaults still apply — a group plan with
 * no units should not mint a zero-unit athlete plan.
 */
export function seedStructureFromGroup(group: WeekStructure): MergedStructure | null {
  const groupActive = group.active_days ?? [];
  if (groupActive.length === 0) return null;
  return {
    active_days: [...groupActive].sort((a, b) => a - b),
    day_labels: pickForDays(group.day_labels, groupActive),
    day_display_order: group.day_display_order
      ? group.day_display_order.filter(d => groupActive.includes(d))
      : null,
    day_schedule: pickForDays(group.day_schedule, groupActive),
  };
}
