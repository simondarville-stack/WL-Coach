import { describe, it, expect } from 'vitest';
import { gestureDelta, roundStep, SHIFT_STEP_MULTIPLIER, stepHint } from '../stepGesture';

const LEFT = { button: 0, shiftKey: false };
const RIGHT = { button: 2, shiftKey: false };
const SHIFT_LEFT = { button: 0, shiftKey: true };
const SHIFT_RIGHT = { button: 2, shiftKey: true };

describe('gestureDelta', () => {
  it('reads left as up and right as down', () => {
    expect(gestureDelta(LEFT)).toBe(1);
    expect(gestureDelta(RIGHT)).toBe(-1);
  });

  it('multiplies by 5 under Shift, in both directions', () => {
    expect(gestureDelta(SHIFT_LEFT)).toBe(SHIFT_STEP_MULTIPLIER);
    expect(gestureDelta(SHIFT_RIGHT)).toBe(-SHIFT_STEP_MULTIPLIER);
  });

  it('scales by the coach’s click increment on load cells', () => {
    expect(gestureDelta(LEFT, 2.5)).toBe(2.5);
    expect(gestureDelta(RIGHT, 2.5)).toBe(-2.5);
    // Shift on a 2,5 kg increment is a 12,5 kg jump — one plate a side plus a
    // half, which is why the multiplier is worth having on load at all.
    expect(gestureDelta(SHIFT_LEFT, 2.5)).toBe(12.5);
  });

  it('defaults to a step of 1, so counts stay whole', () => {
    // Reps, sets and combo entries pass no base: whatever the coach sets the
    // load increment to, a rep is a rep.
    expect(gestureDelta(LEFT)).toBe(1);
    expect(gestureDelta(SHIFT_LEFT)).toBe(5);
    expect(Number.isInteger(gestureDelta(SHIFT_RIGHT))).toBe(true);
  });

  it('treats the middle button as an increase, like every non-right button', () => {
    expect(gestureDelta({ button: 1, shiftKey: false })).toBe(1);
  });
});

describe('roundStep', () => {
  it('keeps a fractional increment from drifting into float noise', () => {
    expect(roundStep(0.1 + 0.2)).toBe(0.3);
    expect(roundStep(117.3 + 2.5)).toBe(119.8);
  });

  it('leaves whole and half values exactly as they are', () => {
    expect(roundStep(120)).toBe(120);
    expect(roundStep(117.5)).toBe(117.5);
  });
});

describe('stepHint', () => {
  it('advertises the whole grammar so every tooltip says the same thing', () => {
    expect(stepHint()).toContain(`Shift ×${SHIFT_STEP_MULTIPLIER}`);
    expect(stepHint()).toContain('hold to repeat');
    expect(stepHint('kg')).toContain('kg');
  });
});
