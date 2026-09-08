/**
 * The post-upload hook (P8 plan §2): runs the pipeline once per clip, after
 * the row exists, with the right target; never throws into the upload; one
 * clip at a time; abandoned when the screen goes away. The pipeline is
 * injected, so nothing here opens a decoder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import type { AnalyseArrivalOptions, ArrivalOutcome, ArrivalTarget } from '../../../../kinemos/lib/arrivals';
import type { DeviceState } from '../../../../kinemos/lib/deviceGate';
import { useUploadAnalysis, type UploadAnalysisDeps, type UploadAnalysisJob } from '../useUploadAnalysis';

const fine: DeviceState = { hasWebCodecs: true, saveData: false, battery: null };

type Enqueue = (job: UploadAnalysisJob) => void;

function Probe({ deps, onReady }: { deps: UploadAnalysisDeps; onReady: (enqueue: Enqueue) => void }) {
  const { enqueue, line } = useUploadAnalysis('coach-1', deps);
  useEffect(() => onReady(enqueue), [enqueue, onReady]);
  return <span data-testid="line">{line ?? ''}</span>;
}

const line = () => screen.getByTestId('line').textContent;

/** Let the pump's chain of awaits settle. */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

const file = new File(['bytes'], 'lift.mp4', { type: 'video/mp4' });
const outcomeOf = (n: number): ArrivalOutcome => ({
  target: { source: 'log', sourceId: 'v1', label: 'Your lift' },
  result: { reps: Array.from({ length: n }, () => ({}) as never), analysisIds: [], ellipse: null, joins: 0, windows: [], scan: null, fellBack: false },
  message: '',
});

interface Harness {
  enqueue: Enqueue;
  calls: Array<{ target: ArrivalTarget; options: AnalyseArrivalOptions }>;
  unmount: () => void;
}

function mount(
  analyse: (target: ArrivalTarget, options: AnalyseArrivalOptions) => Promise<ArrivalOutcome>,
  more: Partial<UploadAnalysisDeps> = {},
): Harness {
  const calls: Harness['calls'] = [];
  let enqueue: Enqueue = () => undefined;
  const deps: UploadAnalysisDeps = {
    readDevice: async () => fine,
    loadAnalyser: async () => async (target, options) => {
      calls.push({ target, options });
      return analyse(target, options);
    },
    enabled: () => true,
    ...more,
  };
  const { unmount } = render(<Probe deps={deps} onReady={fn => (enqueue = fn)} />);
  return { enqueue: job => enqueue(job), calls, unmount };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useUploadAnalysis', () => {
  it('analyses the clip once, against the log row, with the logged mass, for the coach', async () => {
    const h = mount(async () => outcomeOf(2));
    act(() => h.enqueue({ file, videoId: 'video-9', massKg: 62 }));
    await flush();
    expect(h.calls).toHaveLength(1);
    const { target, options } = h.calls[0];
    expect(target.source).toBe('log');
    expect(target.sourceId).toBe('video-9');
    expect(target.file).toBe(file);
    expect(target.url).toBeUndefined();
    expect(target.massKg).toBe(62);
    expect(target.massSource).toBe('logged');
    expect(options.ownerId).toBe('coach-1');
    expect(line()).toBe('2 reps analysed');
  });

  it('carries no mass source when there is no mass', async () => {
    const h = mount(async () => outcomeOf(1));
    act(() => h.enqueue({ file, videoId: 'v', massKg: null }));
    await flush();
    expect(h.calls[0].target.massKg).toBeNull();
    expect(h.calls[0].target.massSource).toBeNull();
    expect(line()).toBe('1 rep analysed');
  });

  it('says it is analysing while the run is going, and clears the count afterwards', async () => {
    vi.useFakeTimers();
    let finish: (o: ArrivalOutcome) => void = () => undefined;
    const h = mount(() => new Promise<ArrivalOutcome>(resolve => (finish = resolve)));
    act(() => h.enqueue({ file, videoId: 'v', massKg: null }));
    await flush();
    expect(line()).toBe('Analysing your lift…');
    await act(async () => finish(outcomeOf(3)));
    await flush();
    expect(line()).toBe('3 reps analysed');
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(line()).toBe('');
  });

  it('is silent when the run fails or finds nothing, and never throws', async () => {
    const h = mount(async () => {
      throw new Error('the decoder died');
    });
    expect(() => h.enqueue({ file, videoId: 'v', massKg: null })).not.toThrow();
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(line()).toBe('');

    const quiet = mount(async () => ({ ...outcomeOf(0), result: null }));
    act(() => quiet.enqueue({ file, videoId: 'v', massKg: null }));
    await flush();
    expect(quiet.calls).toHaveLength(1);
  });

  it('does not run when the device gate refuses, or the preference is off', async () => {
    const noDecoder = mount(async () => outcomeOf(1), { readDevice: async () => ({ ...fine, hasWebCodecs: false }) });
    act(() => noDecoder.enqueue({ file, videoId: 'v', massKg: null }));
    await flush();
    expect(noDecoder.calls).toHaveLength(0);

    const off = mount(async () => outcomeOf(1), { enabled: () => false });
    act(() => off.enqueue({ file, videoId: 'v', massKg: null }));
    await flush();
    expect(off.calls).toHaveLength(0);
  });

  it('runs one clip at a time, in order', async () => {
    let inFlight = 0;
    let peak = 0;
    const h = mount(async target => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      inFlight -= 1;
      return { ...outcomeOf(1), target };
    });
    act(() => {
      h.enqueue({ file, videoId: 'a', massKg: null });
      h.enqueue({ file, videoId: 'b', massKg: null });
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(h.calls.map(c => c.target.sourceId)).toEqual(['a', 'b']);
    expect(peak).toBe(1);
  });

  it('asks the pipeline to stop when the screen goes away', async () => {
    let stop: (() => boolean) | undefined;
    const h = mount(
      (_t, options) =>
        new Promise<ArrivalOutcome>(() => {
          stop = options.shouldStop;
        }),
    );
    act(() => h.enqueue({ file, videoId: 'v', massKg: null }));
    await flush();
    expect(stop?.()).toBe(false);
    h.unmount();
    expect(stop?.()).toBe(true);
  });
});
