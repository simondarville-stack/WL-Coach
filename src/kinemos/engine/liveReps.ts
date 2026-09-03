/**
 * liveReps — telling that a rep just happened, while it is happening.
 *
 * `reps.ts` cuts a finished track into lifts, and it does so by looking at
 * the whole thing: the local floor within five seconds either side, the
 * apex, the catch. None of that is available live, where the future has not
 * been recorded yet. So live mode needs a different shape entirely — a state
 * machine fed one sample at a time that says "a rep just finished, here is
 * its peak velocity" a fraction of a second after the bar is caught.
 *
 * The machine has three states and the transitions are all physical:
 *
 *   WAITING   the bar is near the floor and still. The floor is learned
 *             here — the lowest still height seen — so no calibration of
 *             "where the platform is" is needed beyond the plate.
 *   RISING    it has come up past `armCm` and is being watched. Peak upward
 *             velocity is accumulated.
 *   SETTLING  it has stopped rising. If it got high enough, this was a rep;
 *             the machine waits for it to be still again before saying so,
 *             which is what stops a wobble at the top counting as two.
 *
 * **Why a rep is emitted at the catch and not at the apex.** The number a
 * coach wants is peak velocity, which is known by the apex — but a bar that
 * rises 60 cm and is dumped is not a rep, and only the settle tells them
 * apart. Half a second of latency buys the difference between counting lifts
 * and counting movements.
 *
 * Engine purity: samples in, reps out. No camera, no DOM, no clock of its
 * own — every time comes from the sample.
 */
import type { Calibration } from './calibration';
import { displacementToCm } from './calibration';

export interface LiveSample {
  /** Seconds. Any monotonic clock; only differences matter. */
  t: number;
  /** Display-space pixels, as the tracker gives them. */
  x: number;
  y: number;
}

export interface LiveRep {
  /** 1-based within this session. */
  index: number;
  /** Peak upward velocity, m/s — the number live mode exists to show. */
  peakVelocityMs: number;
  /** How high the bar got above the floor it started from, cm. */
  riseCm: number;
  /** When it left the floor and when it settled, s. */
  liftOffT: number;
  settledT: number;
  /** The samples of the rep, for a path drawn after the fact. */
  samples: LiveSample[];
}

export interface LiveOptions {
  /** A rep is armed once the bar passes this above its resting height, cm.
   *  Below it, a bar being rolled or a lifter adjusting their grip. */
  armCm?: number;
  /** And counted only if it got at least this high, cm. COACH-CONFIG: a
   *  pull from blocks does not rise as far as a snatch from the floor. */
  minRiseCm?: number;
  /** Still, m/s. */
  restSpeedMs?: number;
  /** How long it must be still to count as settled, s. */
  settleS?: number;
  /** Faster than this is not a barbell — a tracking glitch. Such a sample is
   *  ignored rather than allowed to set a peak velocity of 40 m/s. */
  maxSpeedMs?: number;
}

const DEFAULTS: Required<LiveOptions> = {
  armCm: 15,
  minRiseCm: 40,
  restSpeedMs: 0.25,
  settleS: 0.35,
  maxSpeedMs: 6,
};

type Phase = 'waiting' | 'rising' | 'settling';

export interface LiveState {
  readonly options: Required<LiveOptions>;
  readonly calibration: Calibration;
  phase: Phase;
  /** The lowest still height seen, cm, in the frame's own origin. The floor,
   *  learned rather than told. */
  floorCm: number | null;
  /** The previous sample, for the velocity between them. */
  last: (LiveSample & { heightCm: number }) | null;
  /** The rep in progress. */
  peakVelocityMs: number;
  peakHeightCm: number;
  liftOffT: number | null;
  samples: LiveSample[];
  /** When the bar last moved, so "still for settleS" can be answered. */
  movingUntilT: number;
  repCount: number;
}

export function liveInit(calibration: Calibration, options: LiveOptions = {}): LiveState {
  return {
    options: { ...DEFAULTS, ...options },
    calibration,
    phase: 'waiting',
    floorCm: null,
    last: null,
    peakVelocityMs: 0,
    peakHeightCm: 0,
    liftOffT: null,
    samples: [],
    movingUntilT: -Infinity,
    repCount: 0,
  };
}

/**
 * Feed one tracked position. Returns the state to keep and, on the sample
 * that completes a rep, the rep.
 *
 * The state is mutated and returned rather than copied: this runs on every
 * frame of a live camera, and a fresh object per frame is garbage the
 * animation loop does not need. Callers hold one state and thread it
 * through.
 */
export function liveStep(state: LiveState, sample: LiveSample): { state: LiveState; rep: LiveRep | null } {
  const { options: opt, calibration } = state;
  // Height in the frame's own origin: only differences are used, so the
  // origin never matters.
  const heightCm = displacementToCm(calibration, sample.x, sample.y).y;
  const previous = state.last;
  state.last = { ...sample, heightCm };

  if (!previous) {
    state.floorCm = heightCm;
    state.movingUntilT = sample.t;
    return { state, rep: null };
  }

  const dt = sample.t - previous.t;
  if (!(dt > 0)) return { state, rep: null };
  const velocityMs = (heightCm - previous.heightCm) / 100 / dt;
  // A step no barbell makes is the tracker slipping, not the bar. Ignoring
  // it entirely is right: it must not set a peak, and it must not be read as
  // movement that resets the settle timer either.
  if (Math.abs(velocityMs) > opt.maxSpeedMs) return { state, rep: null };

  const moving = Math.abs(velocityMs) > opt.restSpeedMs;
  if (moving) state.movingUntilT = sample.t;
  const stillFor = sample.t - state.movingUntilT;

  // The floor is the lowest still height ever seen. Learned continuously, so
  // a camera nudged between sets re-learns it rather than reporting every
  // later rep as 4 cm short.
  if (!moving && (state.floorCm === null || heightCm < state.floorCm)) state.floorCm = heightCm;
  const above = state.floorCm === null ? 0 : heightCm - state.floorCm;

  switch (state.phase) {
    case 'waiting':
      if (above >= opt.armCm && velocityMs > 0) {
        state.phase = 'rising';
        state.liftOffT = previous.t;
        state.peakVelocityMs = Math.max(0, velocityMs);
        state.peakHeightCm = above;
        state.samples = [{ t: previous.t, x: previous.x, y: previous.y }, sample];
      }
      break;

    case 'rising':
      state.samples.push(sample);
      state.peakVelocityMs = Math.max(state.peakVelocityMs, velocityMs);
      state.peakHeightCm = Math.max(state.peakHeightCm, above);
      // Stopped going up: the bar is overhead, or being received, or was
      // dumped. Which of those it was is decided in `settling`.
      if (velocityMs <= 0) state.phase = 'settling';
      break;

    case 'settling': {
      state.samples.push(sample);
      state.peakHeightCm = Math.max(state.peakHeightCm, above);
      // Rising again without ever settling: one continuous movement, not
      // two reps. A bar caught and then jerked, or a wobble at the top.
      if (velocityMs > opt.restSpeedMs) {
        state.phase = 'rising';
        state.peakVelocityMs = Math.max(state.peakVelocityMs, velocityMs);
        break;
      }
      if (stillFor >= opt.settleS) {
        const counted = state.peakHeightCm >= opt.minRiseCm;
        const rep: LiveRep | null = counted
          ? {
              index: state.repCount + 1,
              peakVelocityMs: state.peakVelocityMs,
              riseCm: state.peakHeightCm,
              liftOffT: state.liftOffT ?? previous.t,
              settledT: sample.t,
              samples: state.samples,
            }
          : null;
        if (counted) state.repCount += 1;
        state.phase = 'waiting';
        state.peakVelocityMs = 0;
        state.peakHeightCm = 0;
        state.liftOffT = null;
        state.samples = [];
        return { state, rep };
      }
      break;
    }
  }
  return { state, rep: null };
}

/** What the readout shows between reps: whether a lift is under way, and how
 *  high the bar is above the floor right now. */
export function liveStatus(state: LiveState): { active: boolean; aboveCm: number } {
  const above =
    state.floorCm === null || state.last === null ? 0 : state.last.heightCm - state.floorCm;
  return { active: state.phase !== 'waiting', aboveCm: above };
}
