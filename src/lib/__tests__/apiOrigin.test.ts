/**
 * The bundle runs from more than one host, and only one of them has the
 * worker. These pin the rule that decides whether an /api URL stays relative
 * or is sent to the configured origin.
 */
import { describe, expect, it } from 'vitest';
import { apiUrl, resolveApiOrigin } from '../apiOrigin';

describe('resolveApiOrigin', () => {
  it('keeps an absolute origin and drops a trailing slash', () => {
    expect(resolveApiOrigin('https://emosapp.com')).toBe('https://emosapp.com');
    expect(resolveApiOrigin('https://emosapp.com/')).toBe('https://emosapp.com');
    expect(resolveApiOrigin('  http://127.0.0.1:8787  ')).toBe('http://127.0.0.1:8787');
  });

  it('treats unset, empty and non-origin values as "relative"', () => {
    expect(resolveApiOrigin(undefined)).toBe('');
    expect(resolveApiOrigin('')).toBe('');
    expect(resolveApiOrigin('emosapp.com')).toBe('');
    expect(resolveApiOrigin('https://emosapp.com/api')).toBe('');
  });
});

describe('apiUrl', () => {
  it('is relative when no origin is configured — the dev proxy and the worker host', () => {
    expect(apiUrl('/api/kinemos/video/x.jpg', '')).toBe('/api/kinemos/video/x.jpg');
  });

  it('is absolute to the worker origin when one is configured — hosts with no worker', () => {
    expect(apiUrl('/api/kinemos/video/x.jpg', 'https://emosapp.com')).toBe(
      'https://emosapp.com/api/kinemos/video/x.jpg',
    );
  });
});
