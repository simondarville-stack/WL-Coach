import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useKeyboardOpen } from '../useKeyboardOpen';

function Probe() {
  return <span data-testid="state">{useKeyboardOpen() ? 'open' : 'closed'}</span>;
}
const state = () => screen.getByTestId('state').textContent;

/** Minimal stand-in for the VisualViewport the phone browsers expose. */
function fakeViewport(height: number) {
  const listeners = new Set<() => void>();
  const vv = {
    height,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    resizeTo(next: number) {
      vv.height = next;
      listeners.forEach(fn => fn());
    },
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  return vv;
}

describe('useKeyboardOpen', () => {
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  });

  it('stays closed where VisualViewport is unavailable', () => {
    // The bottom nav must never vanish on a browser that cannot report this.
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    render(<Probe />);
    expect(state()).toBe('closed');
  });

  it('opens when the viewport loses a keyboard-sized chunk', () => {
    const vv = fakeViewport(window.innerHeight);
    render(<Probe />);
    expect(state()).toBe('closed');

    act(() => vv.resizeTo(window.innerHeight - 300));
    expect(state()).toBe('open');

    act(() => vv.resizeTo(window.innerHeight));
    expect(state()).toBe('closed');
  });

  it('ignores a collapsing URL bar', () => {
    // Browser chrome hiding on scroll shrinks the visual viewport too. Reading
    // that as a keyboard would make the nav flicker on every scroll.
    const vv = fakeViewport(window.innerHeight);
    render(<Probe />);

    act(() => vv.resizeTo(window.innerHeight - 90));
    expect(state()).toBe('closed');
  });
});
