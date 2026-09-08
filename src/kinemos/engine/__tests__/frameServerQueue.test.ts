/**
 * The frame server's decode queue and its decode run.
 *
 * Real decoding needs WebCodecs and container bytes, neither of which exists in
 * jsdom — but the SCHEDULING around the decoder is plain bookkeeping, and it is
 * where the bugs were. Handed straight to `CanvasSink`, a stream of overlapping
 * requests stops resolving after fifty or sixty and does not reject either: the
 * picture freezes for the rest of the session while the transport and every
 * readout carry on naming a different moment. It survived three phases because
 * it reads as a viewer that lost sync rather than a decoder that stalled.
 *
 * And `getCanvas` itself is a fresh decoder per call, decoding from the key
 * frame every time (08/09/2026: 57–75 ms a frame on the testset's 60 fps
 * clip, 13 of 240 frames shown at 1×). The server now walks one forward run
 * and seeks only when the run cannot reach the frame.
 *
 * So mediabunny is replaced with a sink that records how many decodes are in
 * flight, every run it was asked to open and every frame it produced, and the
 * invariants are asserted directly: never more than one decode at a time,
 * everything settles, the frame a coach is waiting for is not queued behind
 * speculative work, consecutive frames come from one run, and a step back is
 * served from the backfill of one seek rather than a seek each.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const FPS = 30;
const FRAMES = 60;
/** Every thirtieth frame is declared a key frame — two GOPs. */
const GOP = 30;

/** How the fake sink behaved during a run, so a test can assert on it. */
const sink = {
  maxConcurrent: 0,
  inFlight: 0,
  /** Timestamps in the order the sink actually produced them. */
  order: [] as number[],
  /** Start timestamps of every decoder run opened. */
  runs: [] as number[],
  /** Resolve manually, so a test can hold a decode open and queue behind it. */
  gate: null as null | (() => void),
};

const frameOf = (timestamp: number) => Math.round(timestamp * FPS);

vi.mock('mediabunny', () => {
  class FakePacketSink {
    async *packets() {
      for (let i = 0; i < FRAMES; i++) {
        yield { timestamp: i / FPS, type: i % GOP === 0 ? 'key' : 'delta' };
      }
    }
  }

  class FakeCanvasSink {
    async *canvases(startTimestamp: number) {
      sink.runs.push(startTimestamp);
      for (let i = frameOf(startTimestamp); i < FRAMES; i++) {
        sink.inFlight++;
        sink.maxConcurrent = Math.max(sink.maxConcurrent, sink.inFlight);
        sink.order.push(i / FPS);
        if (sink.gate) {
          await new Promise<void>(resolve => {
            sink.gate = resolve;
          });
        } else {
          await Promise.resolve();
        }
        sink.inFlight--;
        yield {
          canvas: { timestamp: i / FPS } as unknown as HTMLCanvasElement,
          timestamp: i / FPS,
          duration: 1 / FPS,
        };
      }
    }
  }

  const track = {
    displayWidth: 320,
    displayHeight: 180,
    rotation: 0,
    codec: 'avc',
    canDecode: async () => true,
  };

  return {
    ALL_FORMATS: [],
    BlobSource: class {},
    UrlSource: class {},
    Input: class {
      async getPrimaryVideoTrack() {
        return track;
      }
      dispose() {}
    },
    EncodedPacketSink: FakePacketSink,
    CanvasSink: FakeCanvasSink,
    // The luma path's sink is only constructed on first use; nothing here
    // asks for it.
    VideoSampleSink: class {},
  };
});

const { openFrameServer } = await import('../frameServer');

beforeEach(() => {
  sink.maxConcurrent = 0;
  sink.inFlight = 0;
  sink.order = [];
  sink.runs = [];
  sink.gate = null;
});

describe('the decode queue', () => {
  it('never runs two decodes at once, however many are asked for', async () => {
    const server = await openFrameServer('clip.mp4');
    const all = [];
    for (let i = 0; i < FRAMES; i++) {
      all.push(server.frameAt(i));
      server.prefetch(i, 4);
    }
    const settled = await Promise.allSettled(all);

    expect(sink.maxConcurrent).toBe(1);
    expect(settled.every(r => r.status === 'fulfilled')).toBe(true);
    server.close();
  });

  it('gives every request its own frame', async () => {
    const server = await openFrameServer('clip.mp4');
    const frames = await Promise.all(
      Array.from({ length: FRAMES }, (_, i) => server.frameAt(i)),
    );
    frames.forEach((frame, i) => {
      expect(frame.index).toBe(i);
      expect(frame.timestamp).toBeCloseTo(i / FPS, 9);
    });
    // A batch in order is one walk, not sixty seeks.
    expect(sink.runs).toHaveLength(1);
    server.close();
  });

  it('serves the frame the coach is waiting for before speculative ones', async () => {
    // The whole reason for a priority: while the queue drains the playhead has
    // usually moved, and the frame under it is the one being waited for.
    const server = await openFrameServer('clip.mp4');

    // Hold the first decode open so everything else has to queue behind it.
    sink.gate = () => undefined;
    const first = server.frameAt(0);
    await Promise.resolve();

    server.prefetch(20, 3);
    const wanted = server.frameAt(50);

    // Release, and let the queue drain.
    const release = sink.gate!;
    sink.gate = null;
    release();
    await first;
    await wanted;
    // Let the speculative work drain too.
    await new Promise(resolve => setTimeout(resolve, 0));

    // The seek for frame 50 opened before any speculative frame was decoded:
    // the run started at its backfill, not at the prefetch's frames.
    const afterFirst = sink.order.slice(1).map(frameOf);
    expect(afterFirst[0]).toBeGreaterThanOrEqual(50 - 12);
    expect(afterFirst.indexOf(50)).toBeLessThan(afterFirst.indexOf(21));
    server.close();
  });

  it('drops stale speculative work rather than decoding all of it', async () => {
    // A prefetch for where the playhead WAS is worth nothing once it has moved,
    // and a queue that keeps them all puts every real request behind a wall of
    // stale work.
    const server = await openFrameServer('clip.mp4');
    sink.gate = () => undefined;
    const held = server.frameAt(0);
    await Promise.resolve();

    // Radius 1, so each call queues the frame after it.
    for (let i = 1; i < 40; i++) server.prefetch(i, 1);

    const release = sink.gate!;
    sink.gate = null;
    release();
    await held;
    await new Promise(resolve => setTimeout(resolve, 0));

    // The held frame plus a bounded number of speculative ones — not 39.
    expect(sink.order.length).toBeLessThan(20);
    expect(sink.order.length).toBeGreaterThan(1);
    server.close();
  });

  it('answers anyone still waiting when the clip is closed', async () => {
    const server = await openFrameServer('clip.mp4');
    sink.gate = () => undefined;
    const held = server.frameAt(0);
    await Promise.resolve();
    const queuedBehind = server.frameAt(9);

    server.close();
    const release = sink.gate!;
    sink.gate = null;
    release();

    await expect(queuedBehind).rejects.toThrow(/closed/i);
    await held.catch(() => undefined);
  });
});

describe('the decode run', () => {
  it('walks one run for consecutive frames instead of seeking each', async () => {
    const server = await openFrameServer('clip.mp4');
    for (let i = 0; i < FRAMES; i++) {
      const frame = await server.frameAt(i);
      expect(frame.index).toBe(i);
    }
    expect(sink.runs).toHaveLength(1);
    // One decode a frame: nothing was decoded twice.
    expect(sink.order).toHaveLength(FRAMES);
    server.close();
  });

  it('walks to a frame a short jump ahead rather than reopening at the key frame', async () => {
    const server = await openFrameServer('clip.mp4');
    await server.frameAt(31);
    sink.order = [];
    const frame = await server.frameAt(41); // ⇧→, ten frames
    expect(frame.index).toBe(41);
    expect(sink.runs).toHaveLength(1);
    expect(sink.order.map(frameOf)).toEqual([32, 33, 34, 35, 36, 37, 38, 39, 40, 41]);
    server.close();
  });

  it('backfills a seek for a step back, so the next steps back are free', async () => {
    const server = await openFrameServer('clip.mp4');
    // A jump lands exactly where it was asked: nothing is backfilled for a
    // frame the coach may never step back from.
    await server.frameAt(45);
    expect(sink.runs).toHaveLength(1);
    expect(frameOf(sink.runs[0])).toBe(45);

    // The first step back seeks — and starts twelve frames early (past the
    // key frame at 30), caching what it passes.
    await server.frameAt(44);
    expect(sink.runs).toHaveLength(2);
    expect(frameOf(sink.runs[1])).toBe(32);

    sink.order = [];
    for (let i = 43; i >= 32; i--) {
      const frame = await server.frameAt(i);
      expect(frame.index).toBe(i);
    }
    // Twelve more steps back, not one decode among them.
    expect(sink.order).toHaveLength(0);
    expect(sink.runs).toHaveLength(2);

    // Past the backfill: one more seek, itself backfilled to the key frame.
    await server.frameAt(31);
    expect(sink.runs).toHaveLength(3);
    expect(frameOf(sink.runs[2])).toBe(30);
    server.close();
  });

  it('prefetches ahead only', async () => {
    const server = await openFrameServer('clip.mp4');
    await server.frameAt(30); // a key frame: the seek starts exactly here
    sink.order = [];
    server.prefetch(30, 3);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sink.order.map(frameOf)).toEqual([31, 32, 33]);
    expect(sink.runs).toHaveLength(1);
    server.close();
  });

  it('serves a batch behind the run in order with one seek and a walk', async () => {
    const server = await openFrameServer('clip.mp4');
    await server.frameAt(50);
    sink.order = [];
    sink.runs = [];
    const frames = await Promise.all([server.frameAt(10), server.frameAt(11), server.frameAt(12)]);
    expect(frames.map(f => f.index)).toEqual([10, 11, 12]);
    expect(sink.runs).toHaveLength(1);
    expect(sink.order.map(frameOf)).toEqual([10, 11, 12]);
    server.close();
  });

  it('seeks rather than walks to a frame far ahead, even inside one GOP', async () => {
    const server = await openFrameServer('clip.mp4');
    await server.frameAt(31);
    sink.order = [];
    const frame = await server.frameAt(59);
    expect(frame.index).toBe(59);
    expect(sink.runs).toHaveLength(2);
    // One frame decoded for the jump, not twenty-eight.
    expect(sink.order.map(frameOf)).toEqual([59]);
    server.close();
  });
});
