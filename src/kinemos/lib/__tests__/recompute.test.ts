/**
 * The cache refresh rewrites what a season of trend points is read from, so
 * what it skips matters as much as what it writes: a rep the viewer wrote
 * today is left alone, a rep with no calibration is named as such, and a
 * failed read does not stop the rest.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  KinemosAnalysis,
  KinemosCalibration,
  KinemosTrack,
  KinemosTrackPoint,
} from '../../../lib/database.types';
import { STORED_METRICS_SCHEMA } from '../../engine/metricCatalogue';
import type { KinemosLiftRecord } from '../analysisAdapter';
import type { AnalysisBundle } from '../analysisService';
import { computeFromBundle, isStale, refreshStoredMetrics } from '../recompute';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

/** A pull: 1,4 s of rising bar at 60 fps, then a settle. Enough points for a
 *  velocity and a phase proposal. */
function track(): KinemosTrackPoint[] {
  const points: KinemosTrackPoint[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 60;
    const rise = t < 1.4 ? 100 * (1 - Math.cos((Math.PI * t) / 1.4)) / 2 : 100;
    points.push({ t, x: 500 + 3 * Math.sin(t * 4), y: 700 - rise, s: 'm' });
  }
  return points;
}

function analysis(over: Partial<KinemosAnalysis> = {}): KinemosAnalysis {
  return {
    id: 'a1',
    owner_id: null,
    source_kind: 'direct',
    source_id: 'c1',
    rep_index: 1,
    label: null,
    frame_width: 1080,
    frame_height: 1920,
    rotation: 0,
    mass_kg: 80,
    mass_source: 'logged',
    status: 'draft',
    notes: null,
    phase_boundaries: null,
    phase_set_id: 'default',
    metrics: null,
    grade: null,
    grade_error_ms: null,
    grade_factors: null,
    camera: null,
    is_reference: false,
    is_model: false,
    model_label: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

const calibration: KinemosCalibration = {
  id: 'cal',
  owner_id: null,
  analysis_id: 'a1',
  frame_index: 0,
  frame_t: 0,
  ellipse_cx: 500,
  ellipse_cy: 700,
  semi_major_px: 22.5,
  semi_minor_px: 22.5,
  tilt_deg: 0,
  plate_diameter_cm: 45,
  cm_per_px_v: 1,
  cm_per_px_h: 1,
  viewing_angle_deg: 0,
  confidence: 'good',
  distortion_source: 'none',
  stabilised: false,
  created_at: '',
  updated_at: '',
} as KinemosCalibration;

function trackRow(points: KinemosTrackPoint[]): KinemosTrack {
  return {
    id: 't',
    owner_id: null,
    analysis_id: 'a1',
    kind: 'bar_end',
    points,
    tracker_tier: 'manual',
    correction_count: 0,
    filter_settings: null,
    created_at: '',
    updated_at: '',
  } as KinemosTrack;
}

function bundle(over: Partial<AnalysisBundle> = {}): AnalysisBundle {
  return { analysis: analysis(), calibration, track: trackRow(track()), annotations: [], ...over };
}

function record(over: Partial<KinemosLiftRecord> & { analysisId: string }): KinemosLiftRecord {
  return {
    clipKey: 'direct:c1',
    sourceKind: 'direct',
    sourceId: 'c1',
    repIndex: 1,
    label: null,
    athleteId: 'ath',
    athleteName: 'A',
    exerciseName: 'Snatch',
    date: '2026-08-01',
    loadKg: 80,
    massKg: 80,
    massSource: 'logged',
    grade: null,
    gradeErrorMs: null,
    phaseSetId: 'default',
    isReference: false,
    isModel: false,
    modelLabel: null,
    schema: 0,
    analysedAt: '',
    values: {},
    ...over,
  };
}

describe('computeFromBundle', () => {
  it('produces metrics and a summary from a calibrated track', () => {
    const out = computeFromBundle(bundle());
    expect(out).not.toBeNull();
    expect(out!.metrics.peakVelocityMs).toBeGreaterThan(0.5);
    expect(out!.summary.peakHeightCm).toBeGreaterThan(90);
    expect(out!.boundaries.length).toBeGreaterThan(0);
  });

  it('is null without a calibration or a track', () => {
    expect(computeFromBundle(bundle({ calibration: null }))).toBeNull();
    expect(computeFromBundle(bundle({ track: null }))).toBeNull();
    expect(computeFromBundle(bundle({ track: trackRow([]) }))).toBeNull();
  });

  it('keeps a coach-placed phase set rather than re-proposing', () => {
    const coach = [
      { phaseId: 'first_pull', t: 0.1, rule: 'liftoff', source: 'coach' as const },
      { phaseId: null, t: 1.5, rule: 'settle', source: 'coach' as const },
    ];
    const out = computeFromBundle(bundle({ analysis: analysis({ phase_boundaries: coach }) }));
    expect(out!.boundaries).toEqual(coach);
  });
});

describe('isStale', () => {
  it('is true below the current schema and false at it', () => {
    expect(isStale({ schema: 0 })).toBe(true);
    expect(isStale({ schema: STORED_METRICS_SCHEMA })).toBe(false);
  });
});

describe('refreshStoredMetrics', () => {
  it('rewrites the cache of stale reps and leaves current ones alone', async () => {
    const load = vi.fn(async () => bundle());
    const save = vi.fn(async () => undefined);
    const out = await refreshStoredMetrics(
      [record({ analysisId: 'old', schema: 0 }), record({ analysisId: 'fresh', schema: STORED_METRICS_SCHEMA })],
      { load, save },
    );
    expect(out.refreshed).toEqual(['old']);
    expect(out.skipped).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    const [id, state] = save.mock.calls[0] as unknown as [string, { metrics: { schema: number; summary: unknown } }];
    expect(id).toBe('old');
    expect(state.metrics.schema).toBe(STORED_METRICS_SCHEMA);
    expect(state.metrics.summary).not.toBeNull();
  });

  it('rewrites everything when forced', async () => {
    const save = vi.fn(async () => undefined);
    const out = await refreshStoredMetrics(
      [record({ analysisId: 'fresh', schema: STORED_METRICS_SCHEMA })],
      { load: async () => bundle(), save, force: true },
    );
    expect(out.refreshed).toEqual(['fresh']);
  });

  it('names why a rep was skipped, in the coach’s terms', async () => {
    const save = vi.fn(async () => undefined);
    const load = vi.fn(async (_k: string, id: string) =>
      id === 'gone'
        ? null
        : id === 'uncal'
          ? bundle({ calibration: null })
          : bundle({ track: null }),
    );
    const out = await refreshStoredMetrics(
      [
        record({ analysisId: 'gone', sourceId: 'gone' }),
        record({ analysisId: 'uncal', sourceId: 'uncal' }),
        record({ analysisId: 'notrack', sourceId: 'notrack' }),
      ],
      { load: load as unknown as RefreshLoad, save },
    );
    expect(out.refreshed).toEqual([]);
    expect(out.skipped).toEqual([
      { analysisId: 'gone', reason: 'no longer stored' },
      { analysisId: 'uncal', reason: 'not calibrated' },
      { analysisId: 'notrack', reason: 'no track' },
    ]);
    expect(save).not.toHaveBeenCalled();
  });

  it('carries on past a failed read and reports progress', async () => {
    const progress: Array<[number, number]> = [];
    let n = 0;
    const load = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('network down');
      return bundle();
    });
    const out = await refreshStoredMetrics(
      [record({ analysisId: 'a' }), record({ analysisId: 'b' })],
      { load, save: async () => undefined, onProgress: (d, t) => progress.push([d, t]) },
    );
    expect(out.skipped).toEqual([{ analysisId: 'a', reason: 'network down' }]);
    expect(out.refreshed).toEqual(['b']);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

type RefreshLoad = NonNullable<Parameters<typeof refreshStoredMetrics>[1]>['load'];
