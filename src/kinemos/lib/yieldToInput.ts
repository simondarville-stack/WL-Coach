/**
 * yieldToInput — hand the main thread back, briefly, so a click can land.
 *
 * The whole KinEMOS pipeline runs on the main thread: decode, greyscale
 * readback, template matching, and OpenCV's Hough and Canny passes in wasm.
 * Every one of those is straight-line synchronous work, and `await`ing a
 * promise that is already resolved — a cached frame (`Promise.resolve(cached)`
 * in the frame server), the memoised `loadOpenCv()` — is a **microtask**. A
 * microtask does not end the task: the browser still cannot dispatch the
 * coach's click on "Stop sweep", and React still cannot paint. That is why a
 * stop could be wired end to end and the button would *still* feel dead.
 *
 * So the pipeline needs a real task boundary, cheaply, often. Three candidates:
 *
 *   - `setTimeout(…, 0)` — **no.** The HTML spec clamps a timer to >= 4 ms once
 *     the nesting level passes 5, which a per-frame chain reaches immediately,
 *     and a **hidden tab throttles timers to about one per second**. The sweep
 *     runs in hidden tabs (that is how the tab-away stop is noticed at all), so
 *     a 600-frame track would become ten minutes.
 *   - `requestAnimationFrame` — **no.** 16,7 ms a yield, and it never fires in
 *     a hidden tab at all, so the pipeline would simply stall there.
 *   - `MessageChannel` — yes. A port round trip is a genuine task, neither
 *     clamped nor throttled, and costs on the order of 0,05–0,2 ms. It is the
 *     same mechanism React's own scheduler uses for exactly this reason.
 *
 * `scheduler.yield()` is the standard answer where it exists and is preferred:
 * it yields at a priority that lets input through first and continues sooner.
 *
 * Pure and DOM-free apart from the channel, and deliberately in `lib/` rather
 * than `engine/` — the engine core stays a pure core that knows nothing of
 * browsers (CLAUDE.md, KinEMOS design). Only `lib/trackerSource.ts` and
 * `lib/assists.ts` import it; between them they cover every frame read and
 * every OpenCV entry the pipeline makes.
 */

interface SchedulerLike {
  yield?: () => Promise<void>;
}

const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
const nativeYield =
  typeof scheduler?.yield === 'function' ? scheduler.yield.bind(scheduler) : null;

/** Created on first use, never at module init: a live `MessageChannel` can
 *  keep an event loop alive, which would hang a test runner that imports
 *  this module without ever yielding. */
let channel: MessageChannel | null = null;
const waiting: Array<() => void> = [];

function postYield(): Promise<void> {
  if (typeof MessageChannel !== 'function') return Promise.resolve();
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => {
      waiting.shift()?.();
    };
  }
  return new Promise<void>(resolve => {
    waiting.push(resolve);
    channel!.port2.postMessage(0);
  });
}

/**
 * Give the browser one task's worth of room: enough to dispatch a pending
 * click and commit a paint, and nothing more.
 */
export function yieldToInput(): Promise<void> {
  return nativeYield ? nativeYield() : postYield();
}

/**
 * A cancellation point: yield, then report whether the caller has been asked
 * to stop. Reads the flag on both sides of the yield, so a stop that is
 * already true costs nothing and one that arrives *during* the yield — which
 * is the whole point of yielding — is seen immediately.
 */
export async function pausePoint(shouldStop?: () => boolean): Promise<boolean> {
  if (shouldStop?.() === true) return true;
  await yieldToInput();
  return shouldStop?.() === true;
}
