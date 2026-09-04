/**
 * The house ±step grammar, in one place.
 *
 * Every surface a coach edits a plan on steps numbers the same way: left-click
 * up, right-click down, Shift for a coarse jump. The size of one step is the
 * coach's own `grid_click_increment` setting on load cells, and always 1 on
 * counts — reps, sets and combo tuple entries are whole things, so a 2,5-rep
 * step would be nonsense whatever the setting says.
 *
 * Pair it with `useRepeatOnHold` for click-and-hold: read the delta ONCE at
 * mousedown and reuse it for every repeat, so a hold keeps the size and
 * direction the gesture started with rather than sampling the modifier keys
 * again on a timer.
 */

/** Shift multiplies the step. Five is a plate-ish jump on a 2,5 kg increment
 *  and a set-ish jump on reps — coarse enough to be worth the modifier,
 *  small enough to stay controllable without looking away from the number. */
export const SHIFT_STEP_MULTIPLIER = 5;

/** The default click increment, matching the general_settings column default.
 *  Used where the setting has not loaded yet or is not threaded. */
export const DEFAULT_CLICK_INCREMENT = 1;

/**
 * The signed step one mousedown asks for: left +, right −, Shift ×5, scaled by
 * `base` (the click increment for load cells, 1 for counts).
 */
export function gestureDelta(
  e: { button: number; shiftKey: boolean },
  base: number = DEFAULT_CLICK_INCREMENT,
): number {
  const sign = e.button === 2 ? -1 : 1;
  return sign * base * (e.shiftKey ? SHIFT_STEP_MULTIPLIER : 1);
}

/**
 * Trim the float noise a fractional increment can leave behind. The setting
 * allows halves (0,5 kg), which are exact in binary — but a coach editing a
 * load of 117,3 by 2,5 should still land on 119,8 and not 119,80000000000001.
 */
export function roundStep(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The stepper half of a cell's tooltip, so the grammar reads the same
 *  everywhere it is advertised. */
export function stepHint(unitLabel = ''): string {
  const suffix = unitLabel ? ` ${unitLabel}` : '';
  return `click +${suffix} · right-click −${suffix} · Shift ×${SHIFT_STEP_MULTIPLIER} · hold to repeat`;
}
