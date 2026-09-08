import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabase: {} }));

import { isForeignScript } from '../errorLogger';

const ORIGIN = 'https://emosapp.com';

describe('isForeignScript', () => {
  it('keeps errors from our own bundles', () => {
    expect(isForeignScript('https://emosapp.com/assets/index-CbDL2DJM.js', ORIGIN)).toBe(false);
    expect(isForeignScript('/assets/AthleteApp-cRqRPR5n.js', ORIGIN)).toBe(false);
    expect(isForeignScript('blob:https://emosapp.com/2f1a-...', ORIGIN)).toBe(false);
  });

  it('drops errors thrown by scripts served from elsewhere', () => {
    expect(
      isForeignScript('https://static.cloudflareinsights.com/beacon.min.js/v3d52b47920f24c319d37e2661827c42b1787588026925', ORIGIN),
    ).toBe(true);
    expect(isForeignScript('chrome-extension://abcdef/content.js', ORIGIN)).toBe(true);
    expect(isForeignScript('https://emosapp.com.evil.example/x.js', ORIGIN)).toBe(true);
  });

  it('treats a muted report (no filename) as not foreign — that path has its own guard', () => {
    expect(isForeignScript('', ORIGIN)).toBe(false);
    expect(isForeignScript(undefined, ORIGIN)).toBe(false);
    expect(isForeignScript(null, ORIGIN)).toBe(false);
  });
});
