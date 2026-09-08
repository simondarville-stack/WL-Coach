/**
 * displayPrefs — how the viewer draws, as the coach's own setting.
 *
 * Two surfaces read these: the overlay on the clip (`ViewerStage`) and the
 * bar-path / velocity plots (`BarPathPanel`). Both had every stroke width,
 * marker and label hardcoded; a coach reading a blurred phone clip wants a
 * thicker path and no points, a coach teaching from a screen wants the
 * labels off and the velocity heat on. These are preferences of the coach,
 * not of the athlete or the clip, so they are stored once per browser
 * (`hooks/useDisplayPrefs.ts`), not per athlete the way the rail
 * composition is.
 *
 * Pure: types, defaults, a tolerant parser for what localStorage hands back,
 * and the velocity colour ramp both surfaces use for the heat line.
 */

// ── The clip overlay ───────────────────────────────────────────────────────

/** What of the track is drawn over the video. */
export type StagePathStyle = 'line' | 'points' | 'both' | 'off';
/** How the path is coloured: one colour, by velocity, or by phase. */
export type StagePathColour = 'plain' | 'velocity' | 'phase';
/** A grid over the frame: none, thirds of the frame, or real centimetres
 *  through the calibration (which needs a plate outline to exist). */
export type StageGrid = 'off' | 'thirds' | 'cm';
/** How much of the path: the whole rep, or only what the bar has done so
 *  far — the path grows with the playhead. */
export type StageTrail = 'full' | 'past';

export interface StagePrefs {
  path: StagePathStyle;
  /** Stroke of the path, in screen pixels. */
  lineWidthPx: number;
  /** Radius of a tracked point, in screen pixels. */
  pointRadiusPx: number;
  /** Opacity of the whole path layer, 0–1. */
  opacity: number;
  colour: StagePathColour;
  grid: StageGrid;
  /** Spacing of the centimetre grid. */
  gridCm: number;
  /** The ring on the bar at the current frame. */
  cursor: boolean;
  trail: StageTrail;
}

// ── The plots ──────────────────────────────────────────────────────────────

/** Every label the plots can carry. Each is a toggle. */
export interface PlotLabels {
  v1: boolean;
  v2: boolean;
  vmax: boolean;
  vmin: boolean;
  /** The bar-path landmarks: start, S_max, S_sit (diamonds). */
  pathMarks: boolean;
  /** The height reference lines S_max / S_vmax / S_sit and their gutter labels. */
  heightLines: boolean;
  knee: boolean;
  /** The tick rows under the plot (cm, m/s). */
  ticks: boolean;
}

export type PlotLine = 'plain' | 'heatmap';

export interface PlotPrefs {
  labels: PlotLabels;
  /** One colour per series, or each series coloured by velocity along it. */
  line: PlotLine;
  /** A dot on every sample, on top of the line. */
  points: boolean;
  /** Stroke of the curves, in viewBox units (the plot is 200 wide). */
  lineWidth: number;
  /** The current frame as a ring on each visible curve. */
  cursor: boolean;
}

export interface DisplayPrefs {
  stage: StagePrefs;
  plot: PlotPrefs;
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  stage: {
    path: 'line',
    lineWidthPx: 2,
    pointRadiusPx: 2.5,
    opacity: 1,
    colour: 'plain',
    grid: 'off',
    gridCm: 10,
    cursor: true,
    trail: 'full',
  },
  plot: {
    labels: { v1: true, v2: true, vmax: true, vmin: true, pathMarks: true, heightLines: true, knee: true, ticks: true },
    line: 'plain',
    points: false,
    lineWidth: 2.2,
    cursor: true,
  },
};

/** The choices the options popovers offer. Kept here so a test can walk them. */
export const STAGE_LINE_WIDTHS_PX = [1, 2, 3, 4] as const;
export const STAGE_POINT_RADII_PX = [1.5, 2.5, 3.5] as const;
export const STAGE_OPACITIES = [0.25, 0.5, 0.75, 1] as const;
export const STAGE_GRID_CM = [5, 10, 20] as const;
export const PLOT_LINE_WIDTHS = [1.2, 2.2, 3.4] as const;

// ── Parsing what storage hands back ────────────────────────────────────────

const STAGE_PATHS: readonly StagePathStyle[] = ['line', 'points', 'both', 'off'];
const STAGE_COLOURS: readonly StagePathColour[] = ['plain', 'velocity', 'phase'];
const STAGE_GRIDS: readonly StageGrid[] = ['off', 'thirds', 'cm'];
const STAGE_TRAILS: readonly StageTrail[] = ['full', 'past'];
const PLOT_LINES: readonly PlotLine[] = ['plain', 'heatmap'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Merge a stored value over the defaults, field by field, dropping anything
 * unknown or out of range. A preference file from an older build, a hand
 * edit, or garbage all come back as a complete, valid set — the viewer
 * never has to guard a missing field.
 */
export function parseDisplayPrefs(raw: unknown): DisplayPrefs {
  const d = DEFAULT_DISPLAY_PREFS;
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const s = obj.stage && typeof obj.stage === 'object' ? (obj.stage as Record<string, unknown>) : {};
  const p = obj.plot && typeof obj.plot === 'object' ? (obj.plot as Record<string, unknown>) : {};
  const l = p.labels && typeof p.labels === 'object' ? (p.labels as Record<string, unknown>) : {};
  return {
    stage: {
      path: oneOf(s.path, STAGE_PATHS, d.stage.path),
      lineWidthPx: numberIn(s.lineWidthPx, 0.5, 8, d.stage.lineWidthPx),
      pointRadiusPx: numberIn(s.pointRadiusPx, 0.5, 8, d.stage.pointRadiusPx),
      opacity: numberIn(s.opacity, 0.05, 1, d.stage.opacity),
      colour: oneOf(s.colour, STAGE_COLOURS, d.stage.colour),
      grid: oneOf(s.grid, STAGE_GRIDS, d.stage.grid),
      gridCm: numberIn(s.gridCm, 1, 100, d.stage.gridCm),
      cursor: bool(s.cursor, d.stage.cursor),
      trail: oneOf(s.trail, STAGE_TRAILS, d.stage.trail),
    },
    plot: {
      labels: {
        v1: bool(l.v1, d.plot.labels.v1),
        v2: bool(l.v2, d.plot.labels.v2),
        vmax: bool(l.vmax, d.plot.labels.vmax),
        vmin: bool(l.vmin, d.plot.labels.vmin),
        pathMarks: bool(l.pathMarks, d.plot.labels.pathMarks),
        heightLines: bool(l.heightLines, d.plot.labels.heightLines),
        knee: bool(l.knee, d.plot.labels.knee),
        ticks: bool(l.ticks, d.plot.labels.ticks),
      },
      line: oneOf(p.line, PLOT_LINES, d.plot.line),
      points: bool(p.points, d.plot.points),
      lineWidth: numberIn(p.lineWidth, 0.4, 8, d.plot.lineWidth),
      cursor: bool(p.cursor, d.plot.cursor),
    },
  };
}

// ── The velocity heat ramp ─────────────────────────────────────────────────

/**
 * Colour for a vertical velocity, on a diverging ramp: the bar falling is
 * blue, at rest is grey, rising is warm and reaches red at `scaleMs` — the
 * lift's own Vmax, so every rep spans the whole ramp and the second pull
 * is where the red is. DATA colour, not chrome; never tokenised.
 */
export function velocityColour(vMs: number, scaleMs: number): string {
  const scale = scaleMs > 0 && Number.isFinite(scaleMs) ? scaleMs : 1;
  const x = Math.max(-1, Math.min(1, (Number.isFinite(vMs) ? vMs : 0) / scale));
  // Stops: −1 blue, 0 grey, +0.5 amber, +1 red.
  const grey: Rgb = [156, 163, 175];
  const blue: Rgb = [37, 99, 235];
  const amber: Rgb = [245, 158, 11];
  const red: Rgb = [220, 38, 38];
  let c: Rgb;
  if (x < 0) c = mix(grey, blue, -x);
  else if (x < 0.5) c = mix(grey, amber, x / 0.5);
  else c = mix(amber, red, (x - 0.5) / 0.5);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

type Rgb = [number, number, number];

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * The scale the heat ramp is drawn against: the largest upward velocity of
 * the series, so red is this lift's own peak. Falls back to 1 m/s for a
 * series that never rises.
 */
export function heatScaleMs(vyMs: readonly number[]): number {
  let max = 0;
  for (const v of vyMs) if (Number.isFinite(v) && v > max) max = v;
  return max > 0.05 ? max : 1;
}
