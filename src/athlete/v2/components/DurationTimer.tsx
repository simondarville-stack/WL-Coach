import { useCallback, useEffect, useRef, useState } from 'react';
import { formatSeconds } from '../../../lib/exerciseFeatures';

/**
 * Tap-to-run countdown for a coach-prescribed duration (⏱ total time, ⏸ rest).
 *
 * Two things matter in a gym and drive the design:
 *
 * 1. **It counts wall-clock, not ticks.** State is the absolute epoch ms the
 *    timer ENDS at; the interval only re-renders. A phone that sleeps, a
 *    backgrounded tab, or a dropped frame therefore cannot make the timer run
 *    slow — the athlete would have no way to notice it had.
 * 2. **It survives leaving the screen.** The end time is mirrored to
 *    sessionStorage per row, so scrolling away, collapsing the card or
 *    switching tab and coming back resumes the same countdown rather than
 *    silently resetting a rest the athlete is relying on.
 *
 * The chip is display-only until tapped, so nothing changes for an athlete who
 * ignores it. It writes no training data — a timer is not a log.
 */

interface DurationTimerProps {
  /** Prescribed duration in seconds. */
  seconds: number;
  /** Glyph shown when idle — ⏱ for total time, ⏸ for rest. */
  icon: string;
  /** Optional word after the glyph when idle (e.g. "rest"). */
  label?: string;
  /** Stable key for persistence: the planned row id plus which duration. */
  storageKey: string;
}

interface Persisted {
  /** Epoch ms when the countdown ends. Absent while paused. */
  endsAt?: number;
  /** Seconds left, while paused. */
  remaining?: number;
}

function read(key: string): Persisted | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch { return null; }
}
function write(key: string, value: Persisted | null): void {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* private mode — the timer still works for this mount */ }
}

/** mm:ss, which is what a countdown wants; formatSeconds' 12′ form is for a
 *  prescription being read, not for a number ticking down. */
function clock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function DurationTimer({ seconds, icon, label, storageKey }: DurationTimerProps) {
  const stored = useRef<Persisted | null>(read(storageKey)).current;
  const [endsAt, setEndsAt] = useState<number | null>(stored?.endsAt ?? null);
  const [paused, setPaused] = useState<number | null>(
    stored?.endsAt == null ? stored?.remaining ?? null : null,
  );
  const [, forceTick] = useState(0);
  const firedRef = useRef(false);

  const running = endsAt != null;
  const remaining = running
    ? (endsAt - Date.now()) / 1000
    : paused ?? seconds;
  const finished = running && remaining <= 0;

  // Re-render while running. Cleared the moment it stops, so an idle card
  // costs nothing.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => forceTick(n => n + 1), 250);
    return () => clearInterval(id);
  }, [running]);

  // One buzz when it hits zero, on the hardware that supports it. Guarded so a
  // re-render at 0 cannot re-fire it.
  useEffect(() => {
    if (!finished || firedRef.current) return;
    firedRef.current = true;
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* unsupported */ }
  }, [finished]);

  const start = useCallback(() => {
    const from = paused ?? seconds;
    const end = Date.now() + from * 1000;
    firedRef.current = false;
    setPaused(null);
    setEndsAt(end);
    write(storageKey, { endsAt: end });
  }, [paused, seconds, storageKey]);

  const pause = useCallback(() => {
    if (endsAt == null) return;
    const left = Math.max(0, (endsAt - Date.now()) / 1000);
    setEndsAt(null);
    setPaused(left);
    write(storageKey, { remaining: left });
  }, [endsAt, storageKey]);

  const reset = useCallback(() => {
    firedRef.current = false;
    setEndsAt(null);
    setPaused(null);
    write(storageKey, null);
  }, [storageKey]);

  const idle = !running && paused == null;

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        // The card header toggles expand/collapse on click; without this the
        // timer would fold the row away every time it is tapped.
        onClick={e => {
          e.stopPropagation();
          if (finished) reset();
          else if (running) pause();
          else start();
        }}
        title={
          idle ? `Start ${formatSeconds(seconds)} timer`
            : finished ? 'Done — tap to reset'
            : running ? 'Tap to pause' : 'Tap to resume'
        }
        aria-label={
          idle ? `Start ${formatSeconds(seconds)} timer` : `Timer ${clock(Math.max(0, remaining))}`
        }
        className={
          'text-[11px] font-medium tabular-nums rounded px-1 -mx-1 py-0.5 transition-colors ' +
          (finished
            ? 'text-emerald-400 bg-emerald-500/15'
            : running
            ? 'text-white bg-white/10'
            : paused != null
            ? 'text-amber-300 bg-amber-500/10'
            : 'text-[color:var(--color-text-secondary)] active:bg-white/10')
        }
      >
        {idle
          ? `${icon} ${label ? `${label} ` : ''}${formatSeconds(seconds)}`
          : finished
          ? '✓ 0:00'
          : `${running ? '⏵' : '⏸'} ${clock(Math.max(0, remaining))}`}
      </button>
      {!idle && !finished && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); reset(); }}
          title="Reset timer"
          aria-label="Reset timer"
          className="tap-y text-[11px] text-[color:var(--color-text-secondary)] leading-none px-1 active:text-white"
        >
          ✕
        </button>
      )}
    </span>
  );
}
