import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsyncTask } from '../useAsyncTask';

describe('useAsyncTask', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useAsyncTask());
    expect(result.current.busy).toBeNull();
    expect(result.current.isBusy).toBe(false);
    expect(result.current.note).toBeNull();
    expect(result.current.progress).toBeNull();
  });

  it('is busy for the duration and takes the returned string as the note', async () => {
    const { result } = renderHook(() => useAsyncTask());
    let release: (v: string) => void = () => {};
    const gate = new Promise<string>(resolve => { release = resolve; });

    act(() => { void result.current.run(() => gate); });
    await waitFor(() => expect(result.current.isBusy).toBe(true));
    expect(result.current.busy).toBe(true);

    await act(async () => { release('Sent to the athlete'); await gate; });
    expect(result.current.isBusy).toBe(false);
    expect(result.current.note).toBe('Sent to the athlete');
  });

  it('clears the previous note when a new run starts', async () => {
    const { result } = renderHook(() => useAsyncTask());
    await act(async () => { await result.current.run(async () => 'first'); });
    expect(result.current.note).toBe('first');

    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    act(() => { void result.current.run(() => gate); });
    await waitFor(() => expect(result.current.note).toBeNull());
    await act(async () => { release(); await gate; });
  });

  // The whole reason the hook exists: eight hand-rolled copies each had to
  // remember `finally { setBusy(false) }`.
  it('clears busy when the task throws, and notes the message', async () => {
    const { result } = renderHook(() => useAsyncTask());
    await act(async () => {
      await result.current.run(async () => { throw new Error('boom'); });
    });
    expect(result.current.isBusy).toBe(false);
    expect(result.current.note).toBe('boom');
  });

  it('clears busy when the task returns early without a message', async () => {
    const { result } = renderHook(() => useAsyncTask());
    await act(async () => { await result.current.run(async () => { return; }); });
    expect(result.current.isBusy).toBe(false);
    expect(result.current.note).toBeNull();
  });

  it('maps the error through onError when given', async () => {
    const { result } = renderHook(() => useAsyncTask());
    await act(async () => {
      await result.current.run(
        async () => { throw new Error('relation kinemos_shares does not exist'); },
        { onError: e => (/kinemos_shares/.test(String(e)) ? 'Migration not applied.' : 'other') },
      );
    });
    expect(result.current.note).toBe('Migration not applied.');
  });

  it('handles a non-Error throw', async () => {
    const { result } = renderHook(() => useAsyncTask());
    await act(async () => { await result.current.run(async () => { throw 'plain string'; }); });
    expect(result.current.note).toBe('plain string');
    await act(async () => { await result.current.run(async () => { throw { odd: true }; }); });
    expect(result.current.note).toBe('That could not run.');
  });

  it('reports progress and clears it when the run ends', async () => {
    const { result } = renderHook(() => useAsyncTask());
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });

    act(() => {
      void result.current.run(async ctx => { ctx.progress(3, 10); await gate; }, { total: 10 });
    });
    await waitFor(() => expect(result.current.progress).toEqual({ done: 3, total: 10 }));

    await act(async () => { release(); await gate; });
    expect(result.current.progress).toBeNull();
  });

  it('seeds progress at zero when a total is given, so a bar can render', async () => {
    const { result } = renderHook(() => useAsyncTask());
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    act(() => { void result.current.run(() => gate, { total: 240 }); });
    await waitFor(() => expect(result.current.progress).toEqual({ done: 0, total: 240 }));
    await act(async () => { release(); await gate; });
  });

  it('carries a kind on busy, for a control that runs two jobs', async () => {
    const { result } = renderHook(() => useAsyncTask<'find' | 'snap'>());
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    act(() => { void result.current.run(() => gate, { kind: 'snap' }); });
    await waitFor(() => expect(result.current.busy).toBe('snap'));
    await act(async () => { release(); await gate; });
    expect(result.current.busy).toBeNull();
  });

  it('lets the task set a note mid-run, for an early-return path', async () => {
    const { result } = renderHook(() => useAsyncTask());
    await act(async () => {
      await result.current.run(async ctx => {
        ctx.note('The athlete has no environment to send into.');
        return;
      });
    });
    expect(result.current.note).toBe('The athlete has no environment to send into.');
    expect(result.current.isBusy).toBe(false);
  });

  it('setNote and reset work outside a run', async () => {
    const { result } = renderHook(() => useAsyncTask());
    act(() => { result.current.setNote('Back to no correction for this clip.'); });
    expect(result.current.note).toBe('Back to no correction for this clip.');
    act(() => { result.current.reset(); });
    expect(result.current.note).toBeNull();
  });

  // A superseded run must not paint over the newer one — the stabiliser and
  // re-centre loops both report progress from long walks over every frame.
  it('ignores a superseded run: its progress, note and busy-clear are dropped', async () => {
    const { result } = renderHook(() => useAsyncTask());
    let releaseFirst: (v: string) => void = () => {};
    const first = new Promise<string>(resolve => { releaseFirst = resolve; });
    let firstCtx: { progress: (d: number, t?: number) => void } | null = null;

    act(() => { void result.current.run(async ctx => { firstCtx = ctx; return first; }); });
    await waitFor(() => expect(result.current.isBusy).toBe(true));

    let releaseSecond: (v: string) => void = () => {};
    const second = new Promise<string>(resolve => { releaseSecond = resolve; });
    act(() => { void result.current.run(() => second, { total: 5 }); });
    await waitFor(() => expect(result.current.progress).toEqual({ done: 0, total: 5 }));

    // The abandoned first run now reports and finishes.
    await act(async () => {
      firstCtx!.progress(99, 99);
      releaseFirst('stale note');
      await first;
    });
    expect(result.current.progress).toEqual({ done: 0, total: 5 });
    expect(result.current.note).toBeNull();
    expect(result.current.isBusy).toBe(true);

    await act(async () => { releaseSecond('fresh note'); await second; });
    expect(result.current.note).toBe('fresh note');
    expect(result.current.isBusy).toBe(false);
  });
});

describe('useAsyncTask fallback', () => {
  it('uses the fallback only when the thrown value carries no message', async () => {
    const { result } = renderHook(() => useAsyncTask());
    await act(async () => {
      await result.current.run(async () => { throw new Error('the real reason'); }, { fallback: 'Recording could not start.' });
    });
    expect(result.current.note).toBe('the real reason');

    await act(async () => {
      await result.current.run(async () => { throw { weird: true }; }, { fallback: 'Recording could not start.' });
    });
    expect(result.current.note).toBe('Recording could not start.');

    // An Error with an empty message is as useless as no message.
    await act(async () => {
      await result.current.run(async () => { throw new Error(''); }, { fallback: 'Recording could not start.' });
    });
    expect(result.current.note).toBe('Recording could not start.');
  });
});
