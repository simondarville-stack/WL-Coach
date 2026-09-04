/**
 * useRepeatOnHold — click-and-hold repeat for the house ±1 steppers.
 *
 * EMOS steps numbers with the mouse everywhere a coach edits a plan: left-click
 * +1, right-click −1, on load / reps / sets / ranges / combo tuples / macro
 * targets / the ⏱ ⏸ Σ S Hi Ø feature values. That grammar is fast for a nudge
 * and miserable for a jump — a 10 kg move was ten clicks.
 *
 * `start(step)` fires `step` once for the click itself, then, while the button
 * stays down, again after `delay` and thereafter on an accelerating interval
 * (`interval` → `minInterval`, multiplied by `accel` each tick).
 *
 * `step` returns `false` to refuse or end a repeat. Callers use it for the
 * gestures that share the mousedown but are not steps — Ctrl+click opens an
 * edit, Alt+click cycles the unit, Del-held removes the column — because
 * holding those down would be destructive or absurd. It also ends the repeat
 * at a clamp, so holding −1 on a value already at its floor stops instead of
 * spinning writes at a number that cannot move.
 *
 * IMPORTANT — `step` must read the LATEST state on every call. It is invoked
 * again from a timer, so a closure over this render's value would step off the
 * same stale base every tick and the hold would move the number by one. Pass a
 * closure that dereferences a ref kept fresh each render (all callers here do:
 * `() => stepsRef.current.foo(id, delta)`).
 *
 * The repeat ends on mouseup anywhere, Escape, a lost window focus, a hidden
 * tab, or unmount — never only on a mouseup over the button, which the coach
 * may well have slid off.
 */
import { useCallback, useEffect, useRef } from 'react';

export interface RepeatOnHoldOptions {
  /** ms held before the repeat starts. Long enough that a normal click is
   *  never mistaken for a hold. */
  delay?: number;
  /** ms between the first repeats. */
  interval?: number;
  /** floor the interval accelerates down to. */
  minInterval?: number;
  /** interval multiplier per repeat (< 1 accelerates). */
  accel?: number;
}

export interface RepeatOnHold {
  /** Run `step` for the click, then repeat it while the button is held. */
  start: (step: () => boolean | void) => void;
  /** End any repeat in progress. Idempotent. */
  stop: () => void;
}

export function useRepeatOnHold(options: RepeatOnHoldOptions = {}): RepeatOnHold {
  const { delay = 400, interval = 120, minInterval = 50, accel = 0.85 } = options;

  const timerRef = useRef<number | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    detachRef.current?.();
    detachRef.current = null;
  }, []);

  const start = useCallback((step: () => boolean | void) => {
    stop();
    // The click itself. A refused gesture (edit / cycle / delete) never arms.
    if (step() === false) return;

    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') stop(); };
    const onVisibility = () => { if (document.hidden) stop(); };
    window.addEventListener('mouseup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibility);
    detachRef.current = () => {
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
    };

    let wait = interval;
    const tick = () => {
      if (step() === false) { stop(); return; }
      wait = Math.max(minInterval, wait * accel);
      timerRef.current = window.setTimeout(tick, wait);
    };
    timerRef.current = window.setTimeout(tick, delay);
  }, [delay, interval, minInterval, accel, stop]);

  // A repeat must not outlive the row it is stepping.
  useEffect(() => stop, [stop]);

  return { start, stop };
}
