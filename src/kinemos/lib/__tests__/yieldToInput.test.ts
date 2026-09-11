/**
 * The yield exists so the coach's click on "Stop sweep" can be dispatched at
 * all: every OpenCV pass and every cached frame read is otherwise one
 * uninterruptible task, and awaiting an already-resolved promise is a
 * microtask that does not end it. What matters is that it always resolves —
 * on a browser with `scheduler.yield`, on one without, and in a runtime with
 * no `MessageChannel` at all — because a yield that never settles would hang
 * the whole pipeline rather than merely fail to help.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pausePoint, yieldToInput } from '../yieldToInput';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('yieldToInput', () => {
  it('resolves through the MessageChannel fallback', async () => {
    await expect(yieldToInput()).resolves.toBeUndefined();
  });

  it('resolves twice in a row, so a per-frame loop cannot wedge on it', async () => {
    await yieldToInput();
    await yieldToInput();
    await expect(yieldToInput()).resolves.toBeUndefined();
  });
});

describe('pausePoint', () => {
  it('reports a stop that was already asked for, without yielding first', async () => {
    await expect(pausePoint(() => true)).resolves.toBe(true);
  });

  it('yields and reports no stop when none was asked for', async () => {
    await expect(pausePoint(() => false)).resolves.toBe(false);
  });

  it('reports a stop that arrives during the yield', async () => {
    // The whole point: the flag is read again on the far side, so a click
    // dispatched in the task boundary this opened is seen immediately.
    let stop = false;
    const promise = pausePoint(() => stop);
    stop = true;
    await expect(promise).resolves.toBe(true);
  });

  it('is a no-op guard when no stop function is given', async () => {
    await expect(pausePoint(undefined)).resolves.toBe(false);
  });
});
