/**
 * Smoke coverage for the clip editor's contract with its caller. The encode
 * itself is WebCodecs and cannot run under jsdom, so what is checked here is
 * the part that decides whether a clip gets uploaded at all.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipEditor } from '../ClipEditor';

/**
 * The motion pass decodes with WebCodecs, which jsdom does not have. Only the
 * decode is stubbed — `suggestTrimFromMotion` stays real, so these tests
 * exercise the editor against the same judgement production uses.
 */
const motionSamples = vi.hoisted(() => ({ value: [] as { t: number; energy: number }[] }));
vi.mock('../../../lib/clipMotion', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/clipMotion')>()),
  analyseClipMotion: () => Promise.resolve(motionSamples.value),
}));

/** A quiet clip with a burst of movement over [from, to) — an athlete milling
 *  about the platform, then lifting. */
function motionWithLiftAt(from: number, to: number, duration: number) {
  const samples: { t: number; energy: number }[] = [];
  for (let t = 0; t < duration; t += 0.25) {
    samples.push({ t, energy: t >= from && t < to ? 0.3 : 0.02 });
  }
  return samples;
}

beforeEach(() => {
  motionSamples.value = [];
});

beforeAll(() => {
  // jsdom ships none of these; the editor measures its stage with the first,
  // creates a preview URL with the second, and lays the crop box out over a
  // stage that jsdom would otherwise report as 0 × 0.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  URL.createObjectURL ??= () => 'blob:clip';
  URL.revokeObjectURL ??= () => undefined;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 360,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 240,
  });
});

/**
 * jsdom decodes nothing, so stand in for the metadata the editor waits on.
 * Without this every control stays disabled — which is itself the behaviour
 * the "unreadable clip" path covers.
 */
function loadMetadata({ width = 1920, height = 1080, duration = 90 } = {}) {
  const video = document.querySelector('video');
  if (!video) throw new Error('no preview element');
  for (const [key, value] of Object.entries({ duration, videoWidth: width, videoHeight: height })) {
    Object.defineProperty(video, key, { configurable: true, value });
  }
  fireEvent.loadedMetadata(video);
}

const clip = (name = 'lift.mp4') => new File([new Uint8Array(8)], name, { type: 'video/mp4' });

/** File.size is derived from the parts, so override it for the size cases. */
function sizedClip(bytes: number, name = 'lift.mp4'): File {
  const f = clip(name);
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

describe('ClipEditor', () => {
  it('offers the original when the clip was already uploadable', () => {
    const onDone = vi.fn();
    render(<ClipEditor file={clip()} onCancel={() => {}} onDone={onDone} />);
    loadMetadata({ duration: 12 });

    fireEvent.click(screen.getByRole('button', { name: 'Upload original' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0].name).toBe('lift.mp4');
  });

  it('withholds the original when the clip cannot be uploaded as it is', () => {
    render(
      <ClipEditor
        file={sizedClip(300 * 1024 * 1024)}
        reason="Clip is 300 MB — the limit is 200 MB."
        mustEdit
        defaultMaxEdge={1920}
        onCancel={() => {}}
        onDone={() => {}}
      />,
    );

    loadMetadata();

    expect(screen.queryByRole('button', { name: 'Upload original' })).toBeNull();
    expect(screen.getByText(/Clip is 300 MB/)).toBeInTheDocument();
    // A resolution ceiling is already set, so the edit is never a no-op and
    // the athlete can send without touching anything else.
    expect(screen.getByRole('button', { name: /Save & upload/ })).not.toBeDisabled();
  });

  it('shows the trim, crop and size controls', () => {
    render(<ClipEditor file={clip()} onCancel={() => {}} onDone={() => {}} />);
    loadMetadata();

    expect(screen.getByRole('button', { name: 'Trim start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trim end' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crop/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '720p' })).toBeInTheDocument();
  });

  it('reveals the crop box and its ratio presets on entering crop mode', () => {
    render(<ClipEditor file={clip()} onCancel={() => {}} onDone={() => {}} />);
    loadMetadata();

    expect(screen.queryByRole('group', { name: 'Crop area' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Crop/ }));

    expect(screen.getByRole('group', { name: 'Crop area' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '9:16' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resize crop se' })).toBeInTheDocument();
  });

  it('opens an over-length clip on a legal window rather than a doomed one', () => {
    render(
      <ClipEditor file={clip()} mustEdit maxSeconds={60} onCancel={() => {}} onDone={() => {}} />,
    );
    loadMetadata({ duration: 180 });

    // 60 s cap: the selection is pre-trimmed, so the athlete slides it onto
    // the lift instead of first having to shorten it.
    expect(screen.getByText(/0,0 s → 60,0 s/)).toBeInTheDocument();
    expect(screen.getByText(/of 180,0 s/)).toBeInTheDocument();
  });

  it('says so when the browser cannot open the clip at all', () => {
    render(<ClipEditor file={clip()} onCancel={() => {}} onDone={() => {}} />);
    fireEvent.error(document.querySelector('video')!);

    expect(screen.getByText(/cannot open the clip for editing/)).toBeInTheDocument();
    // The escape hatch survives: an unreadable clip is still uploadable as is.
    expect(screen.getByRole('button', { name: 'Upload original' })).toBeInTheDocument();
  });

  it('leaves the whole clip selected where the surface has no duration cap', () => {
    // A coach's technique demo or a full competition attempt is legitimately
    // longer than one lift, so those surfaces pass maxSeconds={null}.
    render(<ClipEditor file={clip()} onCancel={() => {}} onDone={() => {}} />);
    loadMetadata({ duration: 180 });

    expect(screen.getByText(/0,0 s → 180,0 s/)).toBeInTheDocument();
    // Nothing trimmed and nothing cropped, so the button says what it will
    // actually do — upload the file as it stands, no re-encode.
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('brackets the lift for the athlete and offers the whole clip back', async () => {
    motionSamples.value = motionWithLiftAt(30, 34, 60);
    render(<ClipEditor file={clip()} maxSeconds={60} onCancel={() => {}} onDone={() => {}} />);
    loadMetadata({ duration: 60 });
    await act(async () => {});

    // Handles land on the burst plus run-up and run-out, not on the whole clip.
    expect(screen.getByText('Lift found')).toBeInTheDocument();
    expect(screen.getByText(/28,5 s → 3[56],[0-9] s/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Whole clip' }));
    expect(screen.getByText(/0,0 s → 60,0 s/)).toBeInTheDocument();
    expect(screen.queryByText('Lift found')).toBeNull();
  });

  it('leaves the handles alone when there is no clear lift to find', async () => {
    // Uniform motion — a pan, a busy platform. Saying nothing beats guessing.
    motionSamples.value = Array.from({ length: 100 }, (_, i) => ({ t: i * 0.25, energy: 0.05 }));
    render(<ClipEditor file={clip()} maxSeconds={60} onCancel={() => {}} onDone={() => {}} />);
    loadMetadata({ duration: 25 });
    await act(async () => {});

    expect(screen.queryByText('Lift found')).toBeNull();
    expect(screen.queryByText('Finding the lift…')).toBeNull();
    expect(screen.getByText(/0,0 s → 25,0 s/)).toBeInTheDocument();
  });

  it('does not yank the window from under an athlete who already trimmed', async () => {
    motionSamples.value = motionWithLiftAt(30, 34, 60);
    render(<ClipEditor file={clip()} maxSeconds={60} onCancel={() => {}} onDone={() => {}} />);
    loadMetadata({ duration: 60 });

    // A drag lands before the analysis returns — which is the normal race on a
    // long clip, since the decode takes seconds.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Trim start' }), {
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerUp(window);
    await act(async () => {});

    expect(screen.queryByText('Lift found')).toBeNull();
  });

  it('cancels without handing anything back', () => {
    const onCancel = vi.fn();
    const onDone = vi.fn();
    render(<ClipEditor file={clip()} onCancel={onCancel} onDone={onDone} />);
    loadMetadata();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
