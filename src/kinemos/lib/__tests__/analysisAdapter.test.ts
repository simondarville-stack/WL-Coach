/**
 * The projection is the seam between KinEMOS's storage and everything that
 * reads it from outside — the trend view, the Analysis module. These tests fix
 * what crosses it: which analyses survive the join, what an older cache row
 * yields, and how the filters behave at their edges.
 */
import { describe, expect, it, vi } from 'vitest';
import type { KinemosAnalysis } from '../../../lib/database.types';
import { toStoredMetrics } from '../../engine/metricCatalogue';
import type { LiftMetrics } from '../../engine/phases';
import { factsFrom, filterLiftRecords, projectLiftRecords } from '../analysisAdapter';
import type { LibraryVideo } from '../videoLibrary';

// The projection is pure; only the loader touches Supabase, and it is not
// under test here. Stub the client so importing the module needs no env.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

const metrics: LiftMetrics = {
  phases: [
    {
      phaseId: 'second_pull',
      label: 'Second pull',
      durationS: 0.2,
      meanVelocityMs: 1.6,
      peakVelocityMs: 1.8,
      peakVelocityT: 0.7,
      heightGainedCm: 25,
      peakPowerW: null,
    },
  ],
  peakVelocityMs: 1.8,
  transitionVelocityLossMs: 0.1,
  turnoverVelocityMs: 0.5,
  peakPowerW: null,
};

function analysis(over: Partial<KinemosAnalysis> & { id: string }): KinemosAnalysis {
  return {
    owner_id: null,
    source_kind: 'direct',
    source_id: 'clip-1',
    rep_index: 1,
    label: null,
    frame_width: 1080,
    frame_height: 1920,
    rotation: 90,
    mass_kg: 90,
    mass_source: 'logged',
    status: 'draft',
    notes: null,
    phase_boundaries: null,
    phase_set_id: 'default',
    metrics: JSON.parse(JSON.stringify(toStoredMetrics(metrics, null))),
    grade: 'B',
    grade_error_ms: 0.045,
    grade_factors: null,
    camera: 'tripod',
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:05:00Z',
    ...over,
  };
}

function clip(over: Partial<LibraryVideo> & { key: string }): LibraryVideo {
  const [source, sourceId] = over.key.split(':') as [LibraryVideo['source'], string];
  return {
    source,
    sourceId,
    athleteId: 'ath-1',
    athleteName: 'Anna',
    exerciseName: 'Snatch',
    date: '2026-08-01',
    sortedAt: '2026-08-01T10:00:00Z',
    loadKg: 90,
    loadIsTopSet: false,
    durationS: 5,
    fps: 60,
    width: 1080,
    height: 1920,
    playbackUrl: 'blob:x',
    isEmbed: false,
    thumbnailUrl: null,
    note: null,
    sessionId: null,
    eventId: null,
    ...over,
  };
}

describe('projectLiftRecords', () => {
  it('joins an analysis to its clip and reads every catalogue metric', () => {
    const [rec] = projectLiftRecords([analysis({ id: 'a1' })], [clip({ key: 'direct:clip-1' })]);
    expect(rec.athleteId).toBe('ath-1');
    expect(rec.exerciseName).toBe('Snatch');
    expect(rec.date).toBe('2026-08-01');
    expect(rec.loadKg).toBe(90);
    expect(rec.grade).toBe('B');
    expect(rec.gradeErrorMs).toBe(0.045);
    expect(rec.schema).toBe(1);
    expect(rec.values.peakVelocity).toBe(1.8);
    expect(rec.values.secondPull).toBe(1.8);
    // No first pull in this phase set, no summary cached, no mass-dependent power.
    expect(rec.values.firstPull).toBeNull();
    expect(rec.values.peakHeight).toBeNull();
    expect(rec.values.peakPower).toBeNull();
  });

  it('drops an analysis whose clip is gone from the library', () => {
    const out = projectLiftRecords([analysis({ id: 'a1', source_id: 'missing' })], [
      clip({ key: 'direct:clip-1' }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('keeps an analysis with no cached metrics, with every value null', () => {
    const [rec] = projectLiftRecords([analysis({ id: 'a1', metrics: null })], [
      clip({ key: 'direct:clip-1' }),
    ]);
    expect(rec).toBeDefined();
    expect(rec.schema).toBe(0);
    expect(Object.values(rec.values).every(v => v === null)).toBe(true);
  });

  it('coerces the numerics Supabase hands back as strings', () => {
    const [rec] = projectLiftRecords(
      [analysis({ id: 'a1', mass_kg: '92.5' as unknown as number, grade_error_ms: '0.03' as unknown as number })],
      [clip({ key: 'direct:clip-1' })],
    );
    expect(rec.massKg).toBe(92.5);
    expect(rec.gradeErrorMs).toBe(0.03);
  });

  it('orders oldest first, reps in order within a day', () => {
    const out = projectLiftRecords(
      [
        analysis({ id: 'new', source_id: 'c2', rep_index: 1 }),
        analysis({ id: 'old-rep2', source_id: 'c1', rep_index: 2 }),
        analysis({ id: 'old-rep1', source_id: 'c1', rep_index: 1 }),
      ],
      [clip({ key: 'direct:c1', date: '2026-07-01' }), clip({ key: 'direct:c2', date: '2026-08-01' })],
    );
    expect(out.map(r => r.analysisId)).toEqual(['old-rep1', 'old-rep2', 'new']);
  });
});

describe('factsFrom', () => {
  it('flattens to one fact per metric that has a value, carrying unit and grade', () => {
    const records = projectLiftRecords([analysis({ id: 'a1' })], [clip({ key: 'direct:clip-1' })]);
    const facts = factsFrom(records);
    const ids = facts.map(f => f.metricId).sort();
    expect(ids).toEqual(['peakVelocity', 'secondPull', 'transitionLoss', 'turnover']);
    const peak = facts.find(f => f.metricId === 'peakVelocity')!;
    expect(peak).toMatchObject({
      athleteId: 'ath-1',
      date: '2026-08-01',
      value: 1.8,
      unit: 'm/s',
      grade: 'B',
    });
  });

  it('leaves out a rep with no athlete — it has no axis to sit on', () => {
    const records = projectLiftRecords([analysis({ id: 'a1' })], [
      clip({ key: 'direct:clip-1', athleteId: null }),
    ]);
    expect(factsFrom(records)).toHaveLength(0);
  });
});

describe('filterLiftRecords', () => {
  const records = projectLiftRecords(
    [
      analysis({ id: 'jul', source_id: 'c1' }),
      analysis({ id: 'aug', source_id: 'c2' }),
      analysis({ id: 'other', source_id: 'c3' }),
    ],
    [
      clip({ key: 'direct:c1', date: '2026-07-15' }),
      clip({ key: 'direct:c2', date: '2026-08-15' }),
      clip({ key: 'direct:c3', date: '2026-08-15', athleteId: 'ath-2' }),
    ],
  );

  it('filters by athlete', () => {
    expect(filterLiftRecords(records, { athleteIds: ['ath-2'] }).map(r => r.analysisId)).toEqual([
      'other',
    ]);
  });

  it('filters by an inclusive date window', () => {
    expect(
      filterLiftRecords(records, { from: '2026-08-01', to: '2026-08-15' }).map(r => r.analysisId),
    ).toEqual(['aug', 'other']);
    expect(filterLiftRecords(records, { to: '2026-07-15' }).map(r => r.analysisId)).toEqual(['jul']);
  });

  it('passes everything through with no filters', () => {
    expect(filterLiftRecords(records, {})).toHaveLength(3);
  });
});
