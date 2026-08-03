/**
 * useSaveQueue — a coalescing serial save queue for autosaving editors.
 *
 * Every edit enqueues the *whole* current payload. While a save is in flight
 * further edits simply overwrite the pending payload, so a burst of keystrokes
 * collapses into one round-trip carrying the latest state. Two properties that
 * matter for EMOS:
 *
 *  - **At most one write in flight per editor.** The GPP payloads are
 *    read-modify-write on a JSON column; parallel writes would interleave.
 *  - **Last state wins, not last request.** Out-of-order responses can't
 *    resurrect an older payload, because only one request is ever outstanding.
 *
 * `status` drives a Saving… / Saved indicator; the 'saved' flash clears itself
 * after ~1,2 s, matching TemplateEditor's existing autosave affordance.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const SAVED_FLASH_MS = 1200;

export interface SaveQueue<T> {
  /** Queue a payload. Coalesces with anything not yet written. */
  enqueue: (payload: T) => void;
  /** Await everything queued so far — call before closing / unmounting. */
  flush: () => Promise<void>;
  status: SaveStatus;
  /** Message from the last failed save, or null. */
  error: string | null;
  clearError: () => void;
}

export function useSaveQueue<T>(
  save: (payload: T) => Promise<void>,
  describeError: (e: unknown) => string = e => (e instanceof Error ? e.message : String(e)),
): SaveQueue<T> {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const pendingRef = useRef<{ payload: T } | null>(null);
  const processingRef = useRef<Promise<void> | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Keep the latest callbacks in refs so the queue identity never changes —
  // callers hold on to `enqueue` across renders.
  const saveRef = useRef(save);
  saveRef.current = save;
  const describeRef = useRef(describeError);
  describeRef.current = describeError;

  useEffect(() => () => {
    mountedRef.current = false;
    if (flashRef.current) clearTimeout(flashRef.current);
  }, []);

  const drain = useCallback(async (): Promise<void> => {
    while (pendingRef.current) {
      const { payload } = pendingRef.current;
      pendingRef.current = null;
      try {
        await saveRef.current(payload);
      } catch (e) {
        if (mountedRef.current) {
          setStatus('error');
          setError(describeRef.current(e));
        }
        // Stop draining; the next edit retries with the newest payload.
        return;
      }
    }
    if (!mountedRef.current) return;
    setStatus('saved');
    setError(null);
    if (flashRef.current) clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => {
      if (mountedRef.current) setStatus(s => (s === 'saved' ? 'idle' : s));
    }, SAVED_FLASH_MS);
  }, []);

  const enqueue = useCallback((payload: T) => {
    pendingRef.current = { payload };
    setStatus('saving');
    if (processingRef.current) return;
    processingRef.current = drain().finally(() => { processingRef.current = null; });
  }, [drain]);

  const flush = useCallback(async () => {
    // Await the in-flight run, then any payload it left behind.
    while (processingRef.current || pendingRef.current) {
      if (processingRef.current) {
        await processingRef.current;
      } else {
        processingRef.current = drain().finally(() => { processingRef.current = null; });
      }
    }
  }, [drain]);

  const clearError = useCallback(() => setError(null), []);

  return { enqueue, flush, status, error, clearError };
}
