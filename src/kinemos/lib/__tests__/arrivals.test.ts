/**
 * The arrival queue exists so a coach who imports six clips at once does not
 * get six decoders at once, and so one clip the pipeline cannot handle does
 * not cost the other five. Both are properties of the queue rather than of
 * any analysis, so they are what is tested here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryVideo } from '../videoLibrary';

/** How many analyses are running at this instant, and the most there ever
 *  were at once — the only way to catch an accidental `Promise.all`. */
let inFlight = 0;
let peakInFlight = 0;
const analysed: string[] = [];
/** Source ids the fake pipeline should throw on. */
const failOn = new Set<string>();

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

vi.mock('../../engine/frameServer', () => ({
  openFrameServer: vi.fn(async () => ({ close: vi.fn() })),
}));

vi.mock('../autoAnalyse', () => ({
  autoAnalyse: vi.fn(async (_server: unknown, options: { sourceId: string }) => {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    // A tick, so a parallel caller would overlap here and be caught.
    await new Promise(resolve => setTimeout(resolve, 1));
    inFlight -= 1;
    if (failOn.has(options.sourceId)) throw new Error('the plate went behind a pillar');
    analysed.push(options.sourceId);
    return { reps: [{}], analysisIds: ['a'], ellipse: {}, joins: 0 };
  }),
  describeAutoAnalysis: (_r: unknown, label: string) => `${label}: 1 rep analysed`,
}));

vi.mock('../analysisService', async () => {
  const actual = await vi.importActual<typeof import('../analysisService')>('../analysisService');
  return { ...actual, listRecentAnalyses: vi.fn(async () => []) };
});

const { runArrivalQueue, unanalysedClips, targetFor } = await import('../arrivals');

function target(id: string) {
  return { source: 'direct' as const, sourceId: id, label: id, url: `blob:${id}` };
}

/** Only the fields `unanalysedClips` and `targetFor` read. */
function row(partial: Partial<LibraryVideo>): LibraryVideo {
  return {
    key: 'direct:x',
    source: 'direct',
    sourceId: 'x',
    isEmbed: false,
    athleteName: null,
    exerciseName: null,
    playbackUrl: 'https://example.test/x.mp4',
    loadKg: null,
    ...partial,
  } as LibraryVideo;
}

beforeEach(() => {
  inFlight = 0;
  peakInFlight = 0;
  analysed.length = 0;
  failOn.clear();
});

describe('runArrivalQueue', () => {
  it('analyses one clip at a time', async () => {
    await runArrivalQueue([target('a'), target('b'), target('c')], { ownerId: null });
    expect(analysed).toEqual(['a', 'b', 'c']);
    expect(peakInFlight).toBe(1);
  });

  it('carries on past a clip that fails', async () => {
    failOn.add('b');
    const outcomes = await runArrivalQueue([target('a'), target('b'), target('c')], { ownerId: null });
    expect(analysed).toEqual(['a', 'c']);
    expect(outcomes).toHaveLength(3);
    expect(outcomes[1].result).toBeNull();
    expect(outcomes[1].message).toContain('pillar');
  });

  it('stops between clips when asked, never mid-clip', async () => {
    let done = 0;
    await runArrivalQueue([target('a'), target('b'), target('c')], {
      ownerId: null,
      shouldStop: () => done >= 1,
      onDone: () => {
        done += 1;
      },
    });
    // The first clip finished — it was not abandoned half-stored.
    expect(analysed).toEqual(['a']);
  });

  it('reports which clip of how many is running', async () => {
    const seen: string[] = [];
    await runArrivalQueue([target('a'), target('b')], {
      ownerId: null,
      onProgress: p => seen.push(`${p.index}/${p.total}`),
    });
    // The fake pipeline reports no stages, so progress comes only from the
    // queue's own indices; what matters is that they are 1-based and bounded.
    expect(seen.every(s => s === '1/2' || s === '2/2')).toBe(true);
  });

  it('says so rather than throwing when a target has no frames to read', async () => {
    const [outcome] = await runArrivalQueue(
      [{ source: 'direct', sourceId: 'z', label: 'Nowhere' }],
      { ownerId: null },
    );
    expect(outcome.result).toBeNull();
    expect(outcome.message).toContain('nothing to read the frames from');
  });
});

describe('unanalysedClips', () => {
  it('leaves out clips that already have reps', () => {
    const rows = [row({ sourceId: 'a' }), row({ sourceId: 'b' })];
    const pending = unanalysedClips(rows, new Set(['direct:a']));
    expect(pending.map(r => r.sourceId)).toEqual(['b']);
  });

  it('leaves out embedded clips, whose bytes are behind an iframe', () => {
    const rows = [row({ sourceId: 'a', isEmbed: true }), row({ sourceId: 'b' })];
    expect(unanalysedClips(rows, new Set()).map(r => r.sourceId)).toEqual(['b']);
  });
});

describe('targetFor', () => {
  it('names the clip by athlete and exercise, and carries the logged load', () => {
    const t = targetFor(row({ athleteName: 'Caroline', exerciseName: 'Snatch', loadKg: 62 }));
    expect(t.label).toBe('Caroline · Snatch');
    expect(t.massKg).toBe(62);
    expect(t.massSource).toBe('logged');
  });

  it('falls back to a name rather than an empty label', () => {
    expect(targetFor(row({})).label).toBe('Clip');
    expect(targetFor(row({})).massSource).toBeNull();
  });
});
