/**
 * useAsyncTask — one definition of "an async thing the coach started, and what
 * to say about it".
 *
 * The viewer had eight hand-rolled copies of the same shape: share, export,
 * talkover, assist, stabilise, re-centre, lens and snapshot each carried their
 * own `busy` flag, their own `note` string, and in three cases their own
 * `{ done, total }` progress object — about twenty `useState` calls spelling
 * out the identical sequence:
 *
 *     setXBusy(true); setXNote(null);
 *     try { …; setXNote(message) }
 *     catch (e) { setXNote(e instanceof Error ? e.message : 'fallback') }
 *     finally { setXBusy(false) }
 *
 * Every copy had to remember to clear the note on entry and the flag in
 * `finally`. This owns both, so a task that throws — or returns early, which
 * several of these do — can never strand the UI in a busy state.
 *
 * Two shapes, one hook:
 *   const share  = useAsyncTask();                    // busy: true | null
 *   const assist = useAsyncTask<'find' | 'snap'>();   // busy: 'find' | 'snap' | null
 *
 * The kind matters where one control runs two different jobs and the UI needs
 * to know which is in flight (the calibration assists), so `busy` carries it
 * rather than being a bare boolean. Use `isBusy` wherever a boolean is wanted.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

export interface TaskProgress {
  done: number;
  total: number;
}

/** Handle passed to the task body, for reporting progress and interim notes. */
export interface AsyncTaskContext {
  /** Report progress. Drives the same `{ done, total }` the callers already use. */
  progress: (done: number, total?: number) => void;
  /**
   * Set the note mid-run. Use for a message on a path that then returns early;
   * the usual case is simply to *return* the message string instead.
   */
  note: (text: string | null) => void;
}

export interface RunOptions<K> {
  /** Marks `busy` with a kind instead of `true`, for a control with two jobs. */
  kind?: K;
  /** Seeds progress before the first `progress()` call, so a bar can render at 0. */
  total?: number;
  /**
   * What to say when the thrown value carries no message of its own. Every
   * call site spelled this out as `e instanceof Error ? e.message : '…'`, so
   * the hook keeps that rule and takes only the tail.
   */
  fallback?: string;
  /**
   * Turn a thrown value into the note, ignoring the rule above. For the cases
   * that map a specific failure to actionable copy — a missing migration, say
   * — rather than echoing `e.message`.
   */
  onError?: (error: unknown) => string;
}

export interface AsyncTask<K = true> {
  /** The running kind, or null. `true` when no kind was given. */
  busy: K | null;
  /** `busy !== null`, for the common `disabled={…}` / `{… && <Spinner/>}` case. */
  isBusy: boolean;
  /** What to tell the coach — outcome or failure. Cleared when a run starts. */
  note: string | null;
  /** Non-null only while a task that reports progress is running. */
  progress: TaskProgress | null;
  /**
   * Run `fn` with `busy` set and `note` cleared, restoring `busy` and clearing
   * `progress` however it ends. A returned string becomes the note; returning
   * nothing leaves whatever `ctx.note()` set (or nothing at all).
   */
  run: (
    fn: (ctx: AsyncTaskContext) => Promise<string | void>,
    options?: RunOptions<K>,
  ) => Promise<void>;
  /** Set the note without running anything (an undo, a hint, a reset). */
  setNote: (note: string | null) => void;
  /** Clear note and progress. Does not abort a run in flight. */
  reset: () => void;
}

function defaultMessage(error: unknown, fallback = 'That could not run.'): string {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error;
  return fallback;
}

export function useAsyncTask<K = true>(): AsyncTask<K> {
  const [busy, setBusy] = useState<K | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<TaskProgress | null>(null);

  // Guards against a late progress callback from an abandoned run painting over
  // a newer one — the tracker and stabiliser both report from long loops.
  const runIdRef = useRef(0);

  const run = useCallback(
    async (
      fn: (ctx: AsyncTaskContext) => Promise<string | void>,
      options: RunOptions<K> = {},
    ): Promise<void> => {
      const id = ++runIdRef.current;
      setBusy((options.kind ?? (true as unknown as K)));
      setNote(null);
      setProgress(options.total === undefined ? null : { done: 0, total: options.total });
      try {
        const message = await fn({
          progress: (done, total) => {
            if (runIdRef.current !== id) return;
            setProgress(current => ({ done, total: total ?? current?.total ?? done }));
          },
          note: text => {
            if (runIdRef.current === id) setNote(text);
          },
        });
        if (runIdRef.current !== id) return;
        if (typeof message === 'string') setNote(message);
      } catch (error) {
        if (runIdRef.current !== id) return;
        setNote(options.onError ? options.onError(error) : defaultMessage(error, options.fallback));
      } finally {
        if (runIdRef.current === id) {
          setBusy(null);
          setProgress(null);
        }
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setNote(null);
    setProgress(null);
  }, []);

  return useMemo(
    () => ({ busy, isBusy: busy !== null, note, progress, run, setNote, reset }),
    [busy, note, progress, run, reset],
  );
}
