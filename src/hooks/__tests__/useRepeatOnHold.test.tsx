import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useRepeatOnHold } from '../useRepeatOnHold';

/**
 * A stand-in for the house ±1 stepper: a number in local state, a button that
 * steps it on mousedown, and the ref indirection every real caller uses so the
 * repeat reads the value the last tick wrote instead of the one captured at
 * mousedown.
 */
function Stepper({ floor = 0, onStepSpy }: { floor?: number; onStepSpy?: () => void }) {
  const [value, setValue] = useState(10);
  const hold = useRepeatOnHold({ delay: 100, interval: 50, minInterval: 50 });

  function step(delta: number): boolean {
    onStepSpy?.();
    const next = Math.max(floor, value + delta);
    if (next === value) return false;
    setValue(next);
    return true;
  }
  const stepRef = useRef(step);
  stepRef.current = step;

  return (
    <button
      data-testid="cell"
      onMouseDown={e => {
        if (e.button !== 0 && e.button !== 2) return;
        // Ctrl+click opens an edit in the real cells: a refusal, never a hold.
        if (e.ctrlKey) return;
        const delta = e.button === 2 ? -1 : 1;
        hold.start(() => stepRef.current(delta));
      }}
    >
      {value}
    </button>
  );
}

const cell = () => screen.getByTestId('cell');

/**
 * Timer ticks land React state updates, so they have to run inside act().
 *
 * Advance ONE tick per call. In a browser each repeat is its own macrotask and
 * React re-renders between them, which is what refreshes the ref the step reads
 * from. Draining several ticks inside a single advance() would run them all
 * against one render's closure — a test artifact, not the real timeline.
 */
function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe('useRepeatOnHold', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('steps once for a plain click and does not repeat after mouseup', () => {
    render(<Stepper />);

    fireEvent.mouseDown(cell(), { button: 0 });
    expect(cell()).toHaveTextContent('11');

    fireEvent.mouseUp(window);
    advance(1000);
    expect(cell()).toHaveTextContent('11');
  });

  it('keeps stepping while the button is held, off the newest value each tick', () => {
    render(<Stepper />);

    fireEvent.mouseDown(cell(), { button: 0 });
    expect(cell()).toHaveTextContent('11');

    // delay, then one step per interval — each off the value the last wrote,
    // which is the whole point of the ref indirection.
    advance(100);
    expect(cell()).toHaveTextContent('12');
    advance(50);
    expect(cell()).toHaveTextContent('13');
    advance(50);
    advance(50);
    advance(50);
    expect(cell()).toHaveTextContent('16');

    fireEvent.mouseUp(window);
    advance(500);
    expect(cell()).toHaveTextContent('16');
  });

  it('counts down on right-click and stops at the floor instead of spinning', () => {
    const onStepSpy = vi.fn();
    render(<Stepper floor={9} onStepSpy={onStepSpy} />);

    fireEvent.mouseDown(cell(), { button: 2 });
    expect(cell()).toHaveTextContent('9');

    // 9 is the floor: the next tick refuses, the repeat ends, and no further
    // step runs however long the button stays down.
    advance(100);
    expect(cell()).toHaveTextContent('9');
    const callsAtFloor = onStepSpy.mock.calls.length;
    advance(1000);
    expect(onStepSpy).toHaveBeenCalledTimes(callsAtFloor);
  });

  it('never arms when the gesture was refused', () => {
    render(<Stepper />);

    fireEvent.mouseDown(cell(), { button: 0, ctrlKey: true });
    advance(1000);
    expect(cell()).toHaveTextContent('10');
  });

  it('stops on Escape, on a lost window focus, and on unmount', () => {
    const { unmount, rerender } = render(<Stepper />);

    fireEvent.mouseDown(cell(), { button: 0 });
    fireEvent.keyDown(window, { key: 'Escape' });
    advance(1000);
    expect(cell()).toHaveTextContent('11');

    fireEvent.mouseDown(cell(), { button: 0 });
    fireEvent.blur(window);
    advance(1000);
    expect(cell()).toHaveTextContent('12');

    // A repeat must not outlive the row it is stepping.
    fireEvent.mouseDown(cell(), { button: 0 });
    rerender(<Stepper />);
    unmount();
    expect(() => advance(1000)).not.toThrow();
  });
});
