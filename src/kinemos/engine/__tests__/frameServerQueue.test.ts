/**
 * The frame server's decode queue.
 *
 * Real decoding needs WebCodecs and container bytes, neither of which exists in
 * jsdom — but the SCHEDULING around the decoder is plain bookkeeping, and it is
 * where the bug was. Handed straight to `CanvasSink`, a stream of overlapping
 * requests stops resolving after fifty or sixty and does not reject either: the
 * picture freezes for the rest of the session while the transport and every
 * readout carry on naming a different moment. It survived three phases because
 * it reads as a viewer that lost sync rather than a decoder that stalled.
 *
 * So mediabunny is replaced with a sink that records how many decodes are in
 * flight, and the invariants are asserted directly: never more than one at a
 * time, everything settles, and the frame a coach is waiting for is not queued
 * behind speculative work.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const FPS = 30;
const FRAMES = 60;

/** How the fake sink behaved during a run, so a test can assert on it. */
const sink = {
  maxConcurrent: 0,
  inFlight: 0,
  /** Timestamps in the order the sink was actually asked for them. */
  order: [] as number[],
  /** Resolve manually, so a test can hold a decode open and queue behind it. */
  gate: null as null | (() => void),
};

vi.mock('mediabunny', () => {
  class FakePacketSink {
    async *packets() {
      for (let i = 0; i < FRAMES; i++) {
        yield { timestamp: i / FPS, type: i % 30 === 0 ? 'key' : 'delta' };
      }
    }
  }

  class FakeCanvasSink {
    async getCanvas(timestamp: number) {
      sink.inFlight++;
      sink.maxConcurrent = Math.max(sink.maxConcurrent, sink.inFlight);
      sink.order.push(timestamp);
      if (sink.gate) {
        await new Promise<void>(resolve => {
          sink.gate = resolve;
        });
      } else {
        await Promise.resolve();
      }
      sink.inFlight--;
      return { canvas: { timestamp } as unknown as HTMLCanvasElement };
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
  };
});

const { openFrameServer } = await import('../frameServer');

beforeEach(() => {
  sink.maxConcurrent = 0;
  sink.inFlight = 0;
  sink.order = [];
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

    // Frame 50 was asked for last and decoded first of the remainder.
    const afterFirst = sink.order.slice(1);
    expect(afterFirst[0]).toBeCloseTo(50 / FPS, 9);
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

    // Radius 1, so each call queues its two neighbours.
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
