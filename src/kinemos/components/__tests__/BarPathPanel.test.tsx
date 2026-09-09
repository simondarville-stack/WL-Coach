/**
 * The bar-path column: V1, V2, Vmax and Vmin are drawn on the bar path as
 * well as on the velocity curve, from the one search the analyzer numbers
 * come from — and when a phase edge was only guessed at, the mark is
 * withheld and the legend says why. The coach's display choices (labels, a
 * heated line, points) change what is drawn, not what is measured.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse, type TrackPoint } from '../../engine/calibration';
import { computeKinematics } from '../../engine/kinematics';
import { computeLiftMetrics, proposePhases, spansFrom, type PhaseBoundary, type PhaseSpan } from '../../engine/phases';
import { DEFAULT_DISPLAY_PREFS, type PlotPrefs } from '../../lib/displayPrefs';
import { BarPathPanel, missingReason } from '../BarPathPanel';

// ── A textbook snatch, integrated from a velocity profile ──────────────────
const cal = calibrateFromEllipse({ cx: 500, cy: 700, semiMajorPx: 22.5, semiMinorPx: 22.5, tiltDeg: 0 }, 45);
const CONTROL: Array<[number, number]> = [
  [0.0, 0], [0.4, 0], [0.8, 1.0], [1.0, 0.75], [1.3, 1.85], [1.5, 0], [1.7, -0.6], [1.9, 0], [2.3, 0],
];
const smooth = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};
function velocityAt(t: number): number {
  for (let i = 1; i < CONTROL.length; i++) {
    const [t0, v0] = CONTROL[i - 1];
    const [t1, v1] = CONTROL[i];
    if (t <= t1) return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
  }
  return 0;
}
function syntheticLift(fps = 120): TrackPoint[] {
  const points: TrackPoint[] = [];
  const fine = 2400;
  let y = 0;
  let next = 0;
  for (let i = 0; i <= 2.3 * fine; i++) {
    const t = i / fine;
    if (t >= next) {
      points.push({ t, x: 500 + 4 * Math.sin(2 * Math.PI * t * 0.7), y: 700 - y * 100 });
      next += 1 / fps;
    }
    y += velocityAt(t) / fine;
  }
  return points;
}

const series = computeKinematics(syntheticLift(), cal, { massKg: 100 })!;
const detected = spansFrom(proposePhases(series).boundaries);
const analyzer = computeLiftMetrics(series, detected).analyzer;

/** The same edges, but the transition's start placed by proportion. */
function withFallbackTransition(spans: PhaseSpan[]): PhaseSpan[] {
  const boundaries: PhaseBoundary[] = proposePhases(series).boundaries.map(b =>
    b.phaseId === 'transition' ? { ...b, source: 'fallback' } : b,
  );
  void spans;
  return spansFrom(boundaries);
}

function renderPanel(overrides: { spans?: PhaseSpan[]; display?: PlotPrefs } = {}) {
  return render(
    <BarPathPanel
      series={series}
      spans={overrides.spans ?? detected}
      analyzer={analyzer}
      summary={null}
      currentT={null}
      onSeekT={() => undefined}
      emptyReason={null}
      display={overrides.display}
    />,
  );
}

const eventMarks = (container: HTMLElement, layer: 'path' | 'velocity') =>
  Array.from(container.querySelectorAll(`[data-layer="${layer}"] [data-event]`)).map(el => el.getAttribute('data-event'));

describe('BarPathPanel draws the analyzer events on the bar path', () => {
  it('marks V1, V2, Vmax and Vmin on the path in Bar path mode, as diamonds', () => {
    const { container } = renderPanel();
    expect(eventMarks(container, 'path')).toEqual(['v1', 'v2', 'vmax', 'vmin']);
    const v2 = container.querySelector('[data-layer="path"] [data-event="v2"]')!;
    expect(v2.tagName.toLowerCase()).toBe('rect');
    expect(v2.getAttribute('transform')).toMatch(/^rotate\(45/);
    expect(v2.querySelector('title')!.textContent).toMatch(/^V2 \d,\d\d m\/s at \d+,\d cm/);
  });

  it('puts the same V2 on both curves in Combined mode, at the same height', () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Combined' }));
    expect(eventMarks(container, 'velocity')).toEqual(['v1', 'v2', 'vmax', 'vmin']);
    const onPath = container.querySelector('[data-layer="path"] [data-event="v2"]')!;
    const onVelocity = container.querySelector('[data-layer="velocity"] [data-event="v2"]')!;
    // The rect is placed by its top-left corner (y − 4); the circle by its centre.
    expect(Number(onPath.getAttribute('y')) + 4).toBeCloseTo(Number(onVelocity.getAttribute('cy')), 5);
  });

  it('is the analyzer table’s number, not a second search', () => {
    renderPanel();
    const chip = screen.getByText(/^V1 \d,\d\d @/);
    expect(chip.textContent).toContain(analyzer.v1Ms!.toFixed(2).replace('.', ','));
  });

  it('withholds V1 and V2 when the edge was placed by proportion, and says so on the chip', () => {
    const spans = withFallbackTransition(detected);
    const { container } = renderPanel({ spans });
    // The transition edge is the end of the first pull too, so both go.
    expect(eventMarks(container, 'path')).toEqual(['vmax', 'vmin']);
    expect(screen.getByText('V1 —').getAttribute('title')).toMatch(/placed by proportion/);
    expect(screen.getByText('V2 —').getAttribute('title')).toMatch(/Drag it on the timeline to read V2/);
    // Vmax needs no phase and stays.
    expect(screen.getByText(/^Vmax \d,\d\d @/)).toBeInTheDocument();
  });

  it('draws nothing it is told not to, and heats the line when asked', () => {
    const display: PlotPrefs = {
      ...DEFAULT_DISPLAY_PREFS.plot,
      labels: { ...DEFAULT_DISPLAY_PREFS.plot.labels, v1: false, v2: false, ticks: false, pathMarks: false },
      line: 'heatmap',
      points: true,
    };
    const { container } = renderPanel({ display });
    expect(eventMarks(container, 'path')).toEqual(['vmax', 'vmin']);
    expect(screen.queryByText('V1 —')).toBeNull();
    expect(container.querySelector('[data-curve="heat"]')).not.toBeNull();
    // A heated line is one segment per sample pair, each its own colour.
    const segments = container.querySelectorAll('[data-curve="heat"] line');
    expect(segments.length).toBe(series.t.length - 1);
    const colours = new Set(Array.from(segments).map(l => l.getAttribute('stroke')));
    expect(colours.size).toBeGreaterThan(10);
    // Points on every sample.
    expect(container.querySelectorAll('[data-curve="heat"] circle').length).toBe(series.t.length);
    // No ticks: no "cm" unit label.
    expect(container.querySelector('[data-layer="path"] text')?.textContent ?? '').not.toBe('cm');
    expect(screen.getByText(/^heat · red at/)).toBeInTheDocument();
  });
});

describe('missingReason', () => {
  it('tells a missing phase, a guessed edge, and an empty phase apart', () => {
    expect(missingReason('v1', [])).toMatch(/no first pull phase/);
    expect(missingReason('v2', withFallbackTransition(detected))).toMatch(/transition edge was placed by proportion/);
    expect(missingReason('v1', detected)).toMatch(/nothing to read inside the first pull/);
  });
});

describe('BarPathPanel — a front view', () => {
  it('offers no bar path and opens on the velocity plot', () => {
    render(
      <BarPathPanel
        series={series}
        spans={detected}
        analyzer={analyzer}
        summary={null}
        currentT={null}
        onSeekT={() => undefined}
        emptyReason={null}
        pathUsable={false}
      />,
    );
    expect(screen.queryByRole('radio', { name: 'Bar path' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Combined' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Velocity' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('front view · no bar path')).toBeTruthy();
    expect(document.querySelector('[data-layer="path"]')).toBeNull();
    expect(document.querySelector('[data-layer="velocity"]')).not.toBeNull();
  });
});
