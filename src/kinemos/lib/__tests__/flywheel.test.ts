import { describe, expect, it } from 'vitest';
import { isGranted } from '../flywheel';

describe('isGranted', () => {
  it('is false with no grant', () => {
    expect(isGranted({ granted_at: null, revoked_at: null })).toBe(false);
    expect(isGranted({ granted_at: null, revoked_at: '2026-01-01T00:00:00Z' })).toBe(false);
  });

  it('is true once given and never withdrawn', () => {
    expect(isGranted({ granted_at: '2026-01-01T00:00:00Z', revoked_at: null })).toBe(true);
  });

  it('is false after a withdrawal', () => {
    expect(isGranted({ granted_at: '2026-01-01T00:00:00Z', revoked_at: '2026-06-01T00:00:00Z' })).toBe(false);
  });

  it('is true again when consent is given back', () => {
    // The dates are both kept, so which came last is the question — a
    // boolean could not answer it.
    expect(isGranted({ granted_at: '2026-07-01T00:00:00Z', revoked_at: '2026-06-01T00:00:00Z' })).toBe(true);
  });
});
