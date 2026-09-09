/**
 * The automatic run by lifts (P7 plan §5), with every heavy part stubbed:
 * the scan hands back windows, the finder a plate, the set tracker reps,
 * the store an id. What is tested is the procedure between them — one find
 * and one confined track per lift, the hint tried before the open search,
 * rep numbers running on across lifts, the fall-back to the whole clip —
 * and what the coach is told about it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiftWindow } from '../../engine/activity';
import { calibrateFromEllipse } from '../../engine/calibration';
import type { FrameServer } from '../../engine/frameServer';

const findPlateOnFrame = vi.fn();
const trackSet = vi.fn();
const scanActivity = vi.fn();
const persisted: number[] = [];

vi.mock('../assists', () => ({ findPlateOnFrame: (...args: unknown[]) => findPlateOnFrame(...args) }));
vi.mock('../setTracker', () => ({ trackSet: (...args: unknown[]) => trackSet(...args) }));
vi.mock('../activityScan', async () => {
  const real = await vi.importActual<typeof import('../activityScan')>('../activityScan');
  return { ...real, scanActivity: (...args: unknown[]) => scanActivity(...args) };
});
vi.mock('../analysisService', () => ({
  ensureAnalysis: vi.fn(async (_s: unknown, _id: unknown, repIndex: number) => {
    persisted.push(repIndex);
    return { id: `analysis-${repIndex}` };
  }),
  saveTrack: vi.fn(async () => undefined),
  saveCalibration: vi.fn(async () => undefined),
  saveAnalysisState: vi.fn(async () => undefined),
}));

const FPS = 30;
const FRAMES = 300;
const server: FrameServer = {
  timestamps: Array.from({ length: FRAMES }, (_, i) => i / FPS),
  keyframeTimestamps: [0],
  frameCount: FRAMES,
  durationS: FRAMES / FPS,
  displayWidth: 1080,
  displayHeight: 1920,
  rotation: 0,
  averageFps: FPS,
  isVfr: false,
  codec: 'avc1',
  frameAt: () => Promise.reject(new Error('stubbed')),
  prefetch: () => undefined,
  nearestIndex: t => Math.max(0, Math.min(FRAMES - 1, Math.round(t * FPS))),
  close: () => undefined,
};

const evidence = { peakEnergy: 2, quietEnergy: 0.2, centroidRiseRows: 30, centroidFallRows: 10, coverage: 0.2, burstS: 1.2 };
const windowAt = (liftT: number): LiftWindow => ({
  restT: liftT - 0.3,
  fromT: liftT - 0.5,
  liftT,
  toT: liftT + 1.5,
  confidence: 0.8,
  evidence,
});
const scanOf = (windows: LiftWindow[]) => ({
  windows,
  samples: [],
  frames: FRAMES,
  totalMs: 1500,
  msPerFrame: 5,
  thumbWidth: 90,
  thumbHeight: 160,
  stopped: false,
});
const plate = (cx: number, cy: number) => ({
  ellipse: { cx, cy, semiMajorPx: 100, semiMinorPx: 100, tiltDeg: 0 },
  support: 0.9,
});
const rep = (n: number, liftOffT: number) => ({
  rep: n,
  segment: { from: 0, to: 10, liftOffT, apexT: liftOffT + 1, catchT: liftOffT + 1.3, riseCm: 120 , kind: 'pull' as const, dipCm: 0},
  points: [{ t: liftOffT, x: 0, y: 0, s: 't' as const }],
  ellipse: plate(0, 0).ellipse,
  calibration: calibrateFromEllipse(plate(0, 0).ellipse, 45),
  ownCalibration: true,
  lowConfidenceIndices: [],
});
const setResult = (reps: ReturnType<typeof rep>[]) => ({
  points: [],
  tracked: [],
  lowConfidenceIndices: [],
  reps,
  joins: [],
  lostAtEnd: false,
  colour: null,
});

const options = { source: 'direct' as const, sourceId: 'clip-1', ownerId: null, src: 'blob:clip' };

beforeEach(() => {
  findPlateOnFrame.mockReset();
  trackSet.mockReset();
  scanActivity.mockReset();
  persisted.length = 0;
});

describe('autoAnalyse by lifts', () => {
  it('finds and tracks once per lift, inside its range, and numbers the reps on', async () => {
    const { autoAnalyse } = await import('../autoAnalyse');
    scanActivity.mockResolvedValue(scanOf([windowAt(1.2), windowAt(6.9)]));
    findPlateOnFrame.mockResolvedValue(plate(500, 1400));
    trackSet
      .mockResolvedValueOnce(setResult([rep(1, 1.22)]))
      .mockResolvedValueOnce(setResult([rep(1, 6.91)]));

    const result = await autoAnalyse(server, options);

    expect(scanActivity).toHaveBeenCalledWith('blob:clip', expect.anything());
    expect(findPlateOnFrame).toHaveBeenCalledTimes(2);
    // The first lift is searched open; the second with the first's centre
    // as the hint.
    expect(findPlateOnFrame.mock.calls[0][2]).toBeUndefined();
    expect(findPlateOnFrame.mock.calls[1][2]).toEqual({ x: 500, y: 1400 });
    expect(trackSet).toHaveBeenCalledTimes(2);
    const firstCall = trackSet.mock.calls[0];
    expect(firstCall[1]).toEqual({ index: server.nearestIndex(0.9), x: 500, y: 1400 });
    expect(firstCall[2].range).toEqual({ from: server.nearestIndex(0.7), to: server.nearestIndex(2.7) });
    expect(trackSet.mock.calls[1][2].range).toEqual({ from: server.nearestIndex(6.4), to: server.nearestIndex(8.4) });
    expect(result.reps.map(r => r.rep)).toEqual([1, 2]);
    expect(persisted).toEqual([1, 2]);
    expect(result.windows).toHaveLength(2);
    expect(result.scan).toEqual({ frames: FRAMES, totalMs: 1500, msPerFrame: 5 });
    expect(result.fellBack).toBe(false);
    expect(result.problem).toBeUndefined();
  });

  it('tries the finder without the hint when the hinted search finds nothing', async () => {
    const { autoAnalyse } = await import('../autoAnalyse');
    scanActivity.mockResolvedValue(scanOf([windowAt(1.2), windowAt(6.9)]));
    findPlateOnFrame
      .mockResolvedValueOnce(plate(500, 1400))
      .mockResolvedValueOnce(null) // hinted, nothing near the first plate
      .mockResolvedValueOnce(plate(700, 1400)); // open search: the bar was rolled
    trackSet.mockResolvedValue(setResult([rep(1, 1.22)]));

    const result = await autoAnalyse(server, options);

    expect(findPlateOnFrame).toHaveBeenCalledTimes(3);
    expect(findPlateOnFrame.mock.calls[2][2]).toBeUndefined();
    expect(trackSet.mock.calls[1][1]).toEqual({ index: server.nearestIndex(6.6), x: 700, y: 1400 });
    expect(result.reps).toHaveLength(2);
  });

  it('falls back to the whole clip when no lift tracks to a rep', async () => {
    const { autoAnalyse } = await import('../autoAnalyse');
    scanActivity.mockResolvedValue(scanOf([windowAt(1.2)]));
    findPlateOnFrame.mockResolvedValue(plate(500, 1400));
    trackSet
      .mockResolvedValueOnce(setResult([])) // inside the lift: nothing
      .mockResolvedValueOnce(setResult([rep(1, 1.22)])); // the whole clip

    const result = await autoAnalyse(server, options);

    expect(trackSet).toHaveBeenCalledTimes(2);
    expect(trackSet.mock.calls[1][1].index).toBe(0);
    expect(trackSet.mock.calls[1][2].range).toBeUndefined();
    expect(result.fellBack).toBe(true);
    expect(result.reps).toHaveLength(1);
  });

  it('takes today’s path when there is no source to scan and when the scan finds nothing', async () => {
    const { autoAnalyse } = await import('../autoAnalyse');
    findPlateOnFrame.mockResolvedValue(plate(500, 1400));
    trackSet.mockResolvedValue(setResult([rep(1, 1.22)]));

    const noSrc = await autoAnalyse(server, { ...options, src: undefined });
    expect(scanActivity).not.toHaveBeenCalled();
    expect(noSrc.windows).toEqual([]);
    expect(noSrc.scan).toBeNull();
    expect(noSrc.fellBack).toBe(false);

    scanActivity.mockResolvedValue(scanOf([]));
    const nothing = await autoAnalyse(server, options);
    expect(nothing.scan?.msPerFrame).toBe(5);
    expect(nothing.fellBack).toBe(false);
    expect(nothing.reps).toHaveLength(1);
  });

  it('uses a scan it is handed instead of running one', async () => {
    const { autoAnalyse } = await import('../autoAnalyse');
    findPlateOnFrame.mockResolvedValue(plate(500, 1400));
    trackSet.mockResolvedValue(setResult([rep(1, 1.22)]));
    await autoAnalyse(server, { ...options, activity: scanOf([windowAt(1.2)]) });
    expect(scanActivity).not.toHaveBeenCalled();
    expect(trackSet.mock.calls[0][2].range).toBeDefined();
  });
});

describe('describeAutoAnalysis', () => {
  const base = { analysisIds: [], ellipse: null, joins: 0, scan: null, fellBack: false };

  it('says where the lifts were found', async () => {
    const { describeAutoAnalysis } = await import('../autoAnalyse');
    const text = describeAutoAnalysis(
      { ...base, reps: [rep(1, 1.22), rep(2, 6.91)], windows: [windowAt(1.2), windowAt(6.9)] },
      'Snatch double',
    );
    expect(text).toContain('2 lifts found at 1,2 s and 6,9 s');
    expect(text).toContain('2 reps analysed');
  });

  it('says when the lifts came to nothing and the whole clip was tracked', async () => {
    const { describeAutoAnalysis } = await import('../autoAnalyse');
    const text = describeAutoAnalysis(
      { ...base, reps: [rep(1, 1.22)], windows: [windowAt(1.2)], fellBack: true },
      'Clip',
    );
    expect(text).toContain('1 lift found at 1,2 s but nothing tracked there, so the whole clip was tracked');
  });

  it('keeps the old messages for a clip without a scan', async () => {
    const { describeAutoAnalysis } = await import('../autoAnalyse');
    expect(describeAutoAnalysis({ ...base, reps: [], windows: [], problem: 'no-plate' }, 'Clip')).toContain(
      'no plate found on the first frame',
    );
    expect(describeAutoAnalysis({ ...base, reps: [], windows: [], problem: 'no-reps' }, 'Clip')).toContain(
      'nothing in the track rises 40 cm',
    );
  });
});

describe('a stopped run (P8 plan §2)', () => {
  it('stores nothing when the scan was cut short, and never looks for the plate', async () => {
    const { autoAnalyse } = await import('../autoAnalyse');
    scanActivity.mockResolvedValue({ ...scanOf([windowAt(1.2)]), stopped: true });
    const result = await autoAnalyse(server, { ...options, shouldStop: () => false });
    expect(result.problem).toBe('stopped');
    expect(findPlateOnFrame).not.toHaveBeenCalled();
    expect(trackSet).not.toHaveBeenCalled();
    expect(persisted).toEqual([]);
  });

  it('hands the stop to the scan and to every track, and stores nothing once asked', async () => {
    const { autoAnalyse } = await import('../autoAnalyse');
    let stop = false;
    scanActivity.mockResolvedValue(scanOf([windowAt(1.2), windowAt(6.9)]));
    findPlateOnFrame.mockResolvedValue(plate(500, 1400));
    trackSet.mockImplementation(async () => {
      // The athlete leaves while the first lift is being tracked.
      stop = true;
      return setResult([rep(1, 1.22)]);
    });
    const result = await autoAnalyse(server, { ...options, shouldStop: () => stop });
    expect(scanActivity.mock.calls[0][1].shouldStop).toBeTypeOf('function');
    expect(trackSet).toHaveBeenCalledTimes(1);
    expect(trackSet.mock.calls[0][2].shouldStop).toBeTypeOf('function');
    expect(result.problem).toBe('stopped');
    expect(result.reps).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it('stops the whole-clip path too, after the track and before the store', async () => {
    const { autoAnalyse } = await import('../autoAnalyse');
    let stop = false;
    scanActivity.mockResolvedValue(scanOf([]));
    findPlateOnFrame.mockResolvedValue(plate(500, 1400));
    trackSet.mockImplementation(async () => {
      stop = true;
      return setResult([rep(1, 1.22), rep(2, 6.91)]);
    });
    const result = await autoAnalyse(server, { ...options, shouldStop: () => stop });
    expect(result.problem).toBe('stopped');
    expect(persisted).toEqual([]);
  });

  it('says so, in one line', async () => {
    const { describeAutoAnalysis } = await import('../autoAnalyse');
    const text = describeAutoAnalysis(
      { reps: [], analysisIds: [], ellipse: null, joins: 0, windows: [], scan: null, fellBack: false, problem: 'stopped' },
      'Your lift',
    );
    expect(text).toBe('Your lift: the analysis was stopped before anything was stored.');
  });
});
