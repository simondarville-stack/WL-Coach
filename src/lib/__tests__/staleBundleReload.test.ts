import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabase: {} }));

import {
  isDifferentBuild,
  parseVersionManifest,
  resumedAfterLongAbsence,
  RESUME_CHECK_AFTER_HIDDEN_MS,
} from '../staleBundleReload';

describe('parseVersionManifest', () => {
  it('accepts the shape the build emits', () => {
    expect(parseVersionManifest({ version: '0.93.2', sha: 'abc1234', builtAt: '2026-09-07T12:00:00Z' }))
      .toEqual({ version: '0.93.2', sha: 'abc1234', builtAt: '2026-09-07T12:00:00Z' });
  });

  it('rejects anything else — including the SPA fallback page parsed as nonsense', () => {
    expect(parseVersionManifest(null)).toBeNull();
    expect(parseVersionManifest('<!doctype html>')).toBeNull();
    expect(parseVersionManifest({ version: 1, sha: 'x' })).toBeNull();
    expect(parseVersionManifest({ version: '0.1.0' })).toBeNull();
  });

  it('tolerates a missing builtAt', () => {
    expect(parseVersionManifest({ version: '0.1.0', sha: 'abc' })?.builtAt).toBe('');
  });
});

describe('isDifferentBuild', () => {
  const local = { version: '0.93.2', sha: 'abc1234' };

  it('stays put with no manifest', () => {
    expect(isDifferentBuild(null, local)).toBe(false);
  });

  it('stays put on the same build', () => {
    expect(isDifferentBuild({ version: '0.93.2', sha: 'abc1234', builtAt: '' }, local)).toBe(false);
  });

  it('reloads on a redeploy of the same version (SHA differs)', () => {
    expect(isDifferentBuild({ version: '0.93.2', sha: 'def5678', builtAt: '' }, local)).toBe(true);
  });

  it('reloads on a new version', () => {
    expect(isDifferentBuild({ version: '0.94.0', sha: 'def5678', builtAt: '' }, local)).toBe(true);
  });

  it('falls back to the version string when either SHA is unknown', () => {
    expect(isDifferentBuild({ version: '0.93.2', sha: 'unknown', builtAt: '' }, local)).toBe(false);
    expect(isDifferentBuild({ version: '0.94.0', sha: 'unknown', builtAt: '' }, local)).toBe(true);
    expect(isDifferentBuild({ version: '0.93.2', sha: 'def5678', builtAt: '' }, { ...local, sha: 'unknown' })).toBe(false);
  });
});

describe('resumedAfterLongAbsence', () => {
  it('never fires without a recorded hide', () => {
    expect(resumedAfterLongAbsence(null, 1_000_000)).toBe(false);
  });

  it('ignores a short app switch', () => {
    expect(resumedAfterLongAbsence(1_000_000, 1_000_000 + 30_000)).toBe(false);
  });

  it('fires once the threshold has passed', () => {
    expect(resumedAfterLongAbsence(1_000_000, 1_000_000 + RESUME_CHECK_AFTER_HIDDEN_MS)).toBe(true);
  });
});
