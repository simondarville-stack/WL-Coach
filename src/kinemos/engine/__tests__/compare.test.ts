/**
 * Comparison. Two things have to be right here and neither is obvious from
 * looking at a chart: that the two lifts are laid on top of each other at the
 * same physical moment, and that a difference is called an improvement only
 * where "improvement" means something.
 */
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse, type TrackPoint } from '../calibration';
import { computeKinematics, summariseRep } from '../kinematics';
import { computeLiftMetrics, proposePhases, spansFrom, type PhaseBoundary } from '../phases';
import {
  ALIGNMENT_LABEL,
  alignSeries,
  anchorTimeOf,
  compareMetrics,
  comparisonCaveats,
  massesAreComparable,
} from '../compare';

const cal = calibrateFromEllipse(
  { cx: 500, cy: 700, semiMajorPx: 22.5, semiMinorPx: 22.5, tiltDeg: 0 },
  45,
); // 1 cm per pixel

const smoothstep = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

/**
 * A lift whose velocity profile is built from control points, optionally
 * delayed (a clip that starts earlier) and scaled (a faster or slower pull).
 */
function lift({ delay = 0, scale = 1, xOffset = 0 } = {}): TrackPoint[] {
  const control: Array<[number, number]> = [
    [0, 0],
    [0.4 + delay, 0],
    [0.8 + delay, 1.0 * scale],
    [1.0 + delay, 0.75 * scale],
    [1.3 + delay, 1.85 * scale],
    [1.5 + delay, 0],
    [1.7 + delay, -0.6],
    [1.9 + delay, 0],
    [2.4 + delay, 0],
  ];
  const velocityAt = (t: number) => {
    for (let i = 1; i < control.length; i++) {
      const [t0, v0] = control[i - 1];
      const [t1, v1] = control[i];
      if (t <= t1) return v0 + (v1 - v0) * smoothstep((t - t0) / (t1 - t0));
    }
    return 0;
  };

  const duration = control[control.length - 1][0];
  const points: TrackPoint[] = [];
  const fine = 2400;
  let y = 0;
  let next = 0;
  for (let i = 0; i <= duration * fine; i++) {
    const t = i / fine;
    if (t >= next) {
      points.push({ t, x: 500 + xOffset + 4 * Math.sin(2 * Math.PI * t * 0.7), y: 700 - y * 100 });
      next += 1 / 120;
    }
    y += velocityAt(t) / fine;
  }
  return points;
}

function analyse(points: TrackPoint[], massKg: number | null = 100) {
  const series = computeKinematics(points, cal, { massKg })!;
  const { boundaries } = proposePhases(series);
  const spans = spansFrom(boundaries);
  return {
    series,
    boundaries,
    metrics: computeLiftMetrics(series, spans),
    summary: summariseRep(series),
  };
}

describe('anchorTimeOf', () => {
  const a = analyse(lift());

  it('finds lift-off from the detected boundary', () => {
    const t = anchorTimeOf(a.series, a.boundaries, 'liftoff');
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(0.4);
    expect(t!).toBeLessThan(0.7);
  });

  it('finds peak velocity without needing a phase model at all', () => {
    const t = anchorTimeOf(a.series, [], 'peak-velocity');
    expect(t).toBeCloseTo(1.3, 1);
  });

  it('refuses to align on a boundary the engine only guessed at', () => {
    // Aligning two lifts on two guesses compares the guesses.
    const guessed: PhaseBoundary[] = a.boundaries.map(b =>
      b.rule === 'liftoff' ? { ...b, source: 'fallback' } : b,
    );
    expect(anchorTimeOf(a.series, guessed, 'liftoff')).toBeNull();
  });

  it('accepts an edge the coach placed themselves', () => {
    const corrected: PhaseBoundary[] = a.boundaries.map(b =>
      b.rule === 'liftoff' ? { ...b, source: 'coach', t: 0.55 } : b,
    );
    expect(anchorTimeOf(a.series, corrected, 'liftoff')).toBeCloseTo(0.55, 6);
  });

  it('has a label for every anchor it offers', () => {
    for (const key of Object.keys(ALIGNMENT_LABEL)) {
      expect(ALIGNMENT_LABEL[key as keyof typeof ALIGNMENT_LABEL].length).toBeGreaterThan(3);
    }
  });
});

describe('alignSeries', () => {
  // The same lift, one clip starting a third of a second later and filmed with
  // the bar 40 cm further right in frame. Overlaid from frame zero these
  // compare nothing.
  const early = analyse(lift());
  const late = analyse(lift({ delay: 0.35, xOffset: 40 }));

  it('puts the anchor at t = 0 in both', () => {
    const a = alignSeries(early.series, early.boundaries, 'liftoff');
    const b = alignSeries(late.series, late.boundaries, 'liftoff');
    expect(a.anchored && b.anchored).toBe(true);
    // Whatever the clips did before the bar moved, both now start counting from
    // the same physical instant.
    expect(a.anchorT).not.toBeCloseTo(b.anchorT, 1);
    expect(Math.min(...a.t.map(Math.abs))).toBeLessThan(0.02);
    expect(Math.min(...b.t.map(Math.abs))).toBeLessThan(0.02);
  });

  it('lines the two peaks up in time once aligned', () => {
    const a = alignSeries(early.series, early.boundaries, 'liftoff');
    const b = alignSeries(late.series, late.boundaries, 'liftoff');
    const peakT = (s: { t: number[]; vyMs: number[] }) => {
      let best = 0;
      for (let i = 1; i < s.vyMs.length; i++) if (s.vyMs[i] > s.vyMs[best]) best = i;
      return s.t[best];
    };
    expect(Math.abs(peakT(a) - peakT(b))).toBeLessThan(0.06);
  });

  it('normalises position, so a bar filmed elsewhere in frame overlays', () => {
    const a = alignSeries(early.series, early.boundaries, 'liftoff');
    const b = alignSeries(late.series, late.boundaries, 'liftoff');
    // At the anchor both paths are at the origin, whatever the camera saw.
    const atAnchor = (s: { t: number[]; xCm: number[]; yCm: number[] }) => {
      const i = s.t.findIndex(t => t >= 0);
      return { x: s.xCm[i], y: s.yCm[i] };
    };
    expect(Math.abs(atAnchor(a).x)).toBeLessThan(1);
    expect(Math.abs(atAnchor(b).x)).toBeLessThan(1);
    expect(Math.abs(atAnchor(a).y)).toBeLessThan(1);
  });

  it('says when the anchor was not there, rather than pretending', () => {
    const noAnchor = alignSeries(early.series, [], 'liftoff');
    expect(noAnchor.anchored).toBe(false);
    // It still returns a usable series, aligned on the clip start.
    expect(noAnchor.t.length).toBe(early.series.t.length);
  });

  it('aligning on peak velocity puts the two turnovers together', () => {
    const a = alignSeries(early.series, early.boundaries, 'peak-velocity');
    const b = alignSeries(late.series, late.boundaries, 'peak-velocity');
    const at = (s: { t: number[]; vyMs: number[] }, target: number) => {
      const i = s.t.findIndex(t => t >= target);
      return s.vyMs[i];
    };
    // A tenth of a second past the peak, both are decelerating similarly.
    expect(Math.abs(at(a, 0.1) - at(b, 0.1))).toBeLessThan(0.15);
  });
});

describe('compareMetrics', () => {
  const slow = analyse(lift({ scale: 0.9 }));
  const fast = analyse(lift());
  const rows = compareMetrics(slow, fast);

  const row = (id: string) => rows.find(r => r.id === id)!;

  it('reports every metric with a unit and a reason to care', () => {
    expect(rows.length).toBeGreaterThan(6);
    for (const r of rows) {
      expect(r.unit.length).toBeGreaterThan(0);
      expect(r.why.length).toBeGreaterThan(20);
    }
  });

  it('a faster peak is better', () => {
    expect(row('peakVelocity').delta!).toBeGreaterThan(0);
    expect(row('peakVelocity').verdict).toBe('better');
  });

  it('the same peak is neither', () => {
    const same = compareMetrics(fast, analyse(lift()));
    expect(same.find(r => r.id === 'peakVelocity')!.verdict).toBe('same');
  });

  it('a faster first pull is a DIFFERENCE, not an improvement', () => {
    // The judgement this table is most likely to get wrong: many coaches teach
    // a patient first pull precisely so the second can be faster.
    expect(row('firstPull').betterWhen).toBeNull();
    expect(row('firstPull').verdict).toBe('different');
  });

  it('more velocity lost through the transition is worse, not better', () => {
    // The sign trap: a bigger loss is a bigger positive number.
    const worse = compareMetrics(fast, slow);
    const loss = worse.find(r => r.id === 'transitionLoss')!;
    expect(loss.betterWhen).toBe('lower');
    if (loss.delta !== null && loss.delta > 0.03) expect(loss.verdict).toBe('worse');
  });

  it('leaves a metric null rather than inventing it', () => {
    const noMass = analyse(lift(), null);
    const rowsNoMass = compareMetrics(noMass, fast);
    const power = rowsNoMass.find(r => r.id === 'peakPower')!;
    expect(power.a).toBeNull();
    expect(power.delta).toBeNull();
    expect(power.verdict).toBeNull();
  });

  it('will not call a power difference an improvement across two different bars', () => {
    // The self-contradiction this option exists to stop: the table saying
    // "+498 W better" directly above a caveat saying power is not comparable.
    const lighter = analyse(lift({ scale: 0.9 }), 96);
    const heavier = analyse(lift(), 102);
    const power = compareMetrics(lighter, heavier, { massesComparable: false }).find(
      r => r.id === 'peakPower',
    )!;

    expect(power.delta).not.toBeNull();
    expect(power.verdict).toBe('incomparable');
    // And no arrow of improvement is left behind for a renderer to colour by.
    expect(power.betterWhen).toBeNull();
  });

  it('still judges velocity across different bars — only power is withheld', () => {
    // Design §6.4: a heavier bar moving slower can out-power a lighter bar
    // moving faster, which says nothing about the lifter. Velocity is not
    // subject to that, so withholding it too would be over-correction.
    const withheld = compareMetrics(analyse(lift({ scale: 0.9 })), analyse(lift()), {
      massesComparable: false,
    });
    expect(withheld.find(r => r.id === 'peakVelocity')!.verdict).toBe('better');
    expect(withheld.filter(r => r.verdict === 'incomparable').map(r => r.id)).toEqual(['peakPower']);
  });

  it('judges power normally when nothing says the bars differ', () => {
    expect(rows.find(r => r.id === 'peakPower')!.verdict).toBe('better');
  });

  it('cannot contradict the caveat, because both ask the same question', () => {
    // The invariant, not the implementation: for any pair of masses, a caveat
    // about power and a verdict about power must agree.
    for (const [ma, mb] of [
      [100, 100],
      [100, 100.2],
      [96, 102],
      [100, 60],
    ] as Array<[number, number]>) {
      const comparable = massesAreComparable(ma, mb);
      const power = compareMetrics(analyse(lift({ scale: 0.9 }), ma), analyse(lift(), mb), {
        massesComparable: comparable,
      }).find(r => r.id === 'peakPower')!;
      const flagged = comparisonCaveats(
        { grade: 'B', massKg: ma, phaseSetId: 'default' },
        { grade: 'B', massKg: mb, phaseSetId: 'default' },
      ).some(c => /power is not/.test(c));

      expect(flagged).toBe(!comparable);
      expect(power.verdict === 'incomparable').toBe(flagged);
    }
  });
});

describe('massesAreComparable', () => {
  it('needs both masses — an unknown bar is not a matching bar', () => {
    expect(massesAreComparable(100, null)).toBe(false);
    expect(massesAreComparable(null, 100)).toBe(false);
    expect(massesAreComparable(null, null)).toBe(false);
  });

  it('tolerates collar-and-clip differences, not plate differences', () => {
    expect(massesAreComparable(100, 100.5)).toBe(true);
    expect(massesAreComparable(100, 99.5)).toBe(true);
    expect(massesAreComparable(100, 101)).toBe(false);
  });
});

describe('comparisonCaveats', () => {
  const base = { grade: 'B' as string | null, massKg: 100 as number | null, phaseSetId: 'default' };

  it('is silent when the two are genuinely comparable', () => {
    expect(comparisonCaveats(base, { ...base })).toEqual([]);
  });

  it('flags a grade mismatch — design §6.4 allows it and requires the flag', () => {
    const out = comparisonCaveats(base, { ...base, grade: 'C' });
    expect(out.join(' ')).toMatch(/graded differently/);
  });

  it('flags a different bar, and says what survives it', () => {
    const out = comparisonCaveats(base, { ...base, massKg: 120 });
    expect(out.join(' ')).toMatch(/Velocities are comparable; power is not/);
  });

  it('says when power cannot be compared at all', () => {
    expect(comparisonCaveats(base, { ...base, massKg: null }).join(' ')).toMatch(/no bar mass/);
  });

  it('flags two different phase models', () => {
    const out = comparisonCaveats(base, { ...base, phaseSetId: 'three-phase' });
    expect(out.join(' ')).toMatch(/does not mean the same thing/);
  });

  it('does not fuss about half a kilo', () => {
    expect(comparisonCaveats(base, { ...base, massKg: 100.2 })).toEqual([]);
  });
});
