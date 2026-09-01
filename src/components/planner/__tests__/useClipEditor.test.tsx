/**
 * The gate every video upload passes through. What matters here is the
 * decision — does this file go straight up, get offered the editor, or get
 * held until it is edited — because three surfaces now depend on it agreeing
 * with itself.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClipEditor, type ClipEditorGate, type ClipEditorLimits } from '../useClipEditor';

const supported = vi.hoisted(() => ({ value: true }));
const probedDuration = vi.hoisted(() => ({ value: null as number | null }));

vi.mock('../../../lib/videoClipEdit', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/videoClipEdit')>()),
  clipEditingSupported: () => supported.value,
}));
vi.mock('../../../lib/videoProbe', () => ({
  readVideoDurationSeconds: () => Promise.resolve(probedDuration.value),
  captureVideoPoster: () => Promise.resolve(null),
}));

/**
 * The motion pass decodes with WebCodecs, which jsdom does not have. Stub it
 * to "no clear lift" so these tests exercise the editor, not the analysis —
 * `clipMotion.test.ts` covers the suggestion logic on its own.
 */
vi.mock('../../../lib/clipMotion', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/clipMotion')>()),
  analyseClipMotion: () => Promise.resolve([]),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  URL.createObjectURL ??= () => 'blob:clip';
  URL.revokeObjectURL ??= () => undefined;
});

beforeEach(() => {
  supported.value = true;
  probedDuration.value = null;
});

function sizedClip(bytes: number, name = 'lift.mp4'): File {
  const f = new File([new Uint8Array(8)], name, { type: 'video/mp4' });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

/** Mount the hook and hand back its API plus the rendered editor. */
function mountGate(limits: ClipEditorLimits) {
  const ref: { current: ClipEditorGate | null } = { current: null };
  function Host() {
    ref.current = useClipEditor(limits);
    return <>{ref.current.editor}</>;
  }
  render(<Host />);
  return () => {
    if (!ref.current) throw new Error('gate not mounted');
    return ref.current;
  };
}

/**
 * Start a prepare and let the editor open, without awaiting the result — the
 * promise stays pending until the athlete commits or backs out, which is the
 * whole point of the gate.
 */
async function startPrepare(run: () => Promise<File[] | null>) {
  const result: { value?: File[] | null } = {};
  const pending = run().then(v => {
    result.value = v;
    return v;
  });
  // Flush the state update that mounts the editor (and, on the duration path,
  // the probe's microtask) without blocking on `pending`.
  await act(async () => {});
  return { pending, result };
}

const LOG_LIMITS: ClipEditorLimits = { maxBytes: 200 * 1024 * 1024, maxSeconds: 60 };
const OPEN_LIMITS: ClipEditorLimits = { maxBytes: null, maxSeconds: null };

describe('useClipEditor', () => {
  it('passes the file straight through where the browser cannot re-encode', async () => {
    supported.value = false;
    probedDuration.value = 600;
    const gate = mountGate(LOG_LIMITS);

    const file = sizedClip(500 * 1024 * 1024);
    // Even over both caps: without WebCodecs there is no editor to send them
    // to, and the pre-editor behaviour (upload, let the service refuse) stands.
    await expect(gate().prepare(file)).resolves.toEqual([file]);
    expect(screen.queryByText('Trim & crop')).toBeNull();
  });

  it('offers the editor on a deliberate single pick', async () => {
    const gate = mountGate(LOG_LIMITS);
    const { result } = await startPrepare(() => gate().prepare(sizedClip(4 * 1024 * 1024)));

    expect(screen.getByText('Trim & crop')).toBeInTheDocument();
    // Offered, not forced — the escape hatch is present.
    expect(screen.getByRole('button', { name: 'Upload original' })).toBeInTheDocument();
    // Still suspended: the upload waits on the athlete.
    expect(result.value).toBeUndefined();
  });

  it('opens the editor for a batch pick too', async () => {
    // Deliberate: an untrimmed clip is mostly an athlete walking to the bar
    // and away from it, and those bytes are paid for on every upload. Five
    // clips means five editors, one after another.
    const gate = mountGate(LOG_LIMITS);
    await startPrepare(() => gate().prepare(sizedClip(4 * 1024 * 1024)));

    expect(screen.getByText('Trim & crop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload original' })).toBeInTheDocument();
  });

  it('forces the editor, with the reason, on a clip past the byte cap', async () => {
    const gate = mountGate(LOG_LIMITS);
    await startPrepare(() => gate().prepare(sizedClip(300 * 1024 * 1024)));

    expect(screen.getByText(/Clip is 300 MB — the limit is 200 MB/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload original' })).toBeNull();
  });

  it('forces the editor on a clip past the duration cap', async () => {
    probedDuration.value = 180;
    const gate = mountGate(LOG_LIMITS);
    await startPrepare(() => gate().prepare(sizedClip(4 * 1024 * 1024)));

    expect(screen.getByText(/Clip is 180 s long — the limit is 60 s/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload original' })).toBeNull();
  });

  it('never forces on length where the surface declares no duration cap', async () => {
    probedDuration.value = 600;
    const gate = mountGate(OPEN_LIMITS);
    await startPrepare(() => gate().prepare(sizedClip(4 * 1024 * 1024)));

    // A competition attempt or a technique demo is legitimately long, so the
    // editor opens as an offer, with the escape hatch intact.
    expect(screen.getByRole('button', { name: 'Upload original' })).toBeInTheDocument();
    expect(screen.queryByText(/the limit is/)).toBeNull();
  });

  it('resolves null when the athlete backs out', async () => {
    const gate = mountGate(LOG_LIMITS);
    const { pending } = await startPrepare(() => gate().prepare(sizedClip(4 * 1024 * 1024)));

    await act(async () => {
      screen.getByRole('button', { name: 'Cancel' }).click();
    });
    await expect(pending).resolves.toBeNull();
    expect(screen.queryByText('Trim & crop')).toBeNull();
  });

  it('forces the editor after storage refuses a clip, even with no caps set', async () => {
    const gate = mountGate(OPEN_LIMITS);
    await startPrepare(() => gate().prepareAfterRejection(sizedClip(60 * 1024 * 1024)));

    expect(screen.getByText(/refused as too large/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload original' })).toBeNull();
  });
});
