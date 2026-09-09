/**
 * Key handling is the part of the storage layer that has to be exactly right:
 * the worker validates keys against the same shape, so a client that builds a
 * key the worker rejects fails at upload time with no useful message, and a
 * poster key that drifts from its clip key orphans one of the two objects on
 * delete.
 */
import { describe, expect, it } from 'vitest';
import { isWorkerResponse, kinemosObjectUrl, newClipKey, posterKeyFor } from '../kinemosStorage';

/** The worker's KINEMOS_KEY regex, copied deliberately: if these two ever
 *  disagree, uploads break, and the copy is what makes that a test failure
 *  rather than a production one. */
const WORKER_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|webm|mov|jpg)$/;

describe('newClipKey', () => {
  it('keeps a container the worker serves a real content-type for', () => {
    expect(newClipKey('lift.mp4')).toMatch(/\.mp4$/);
    expect(newClipKey('lift.webm')).toMatch(/\.webm$/);
    expect(newClipKey('IMG_0042.MOV')).toMatch(/\.mov$/);
  });

  it('falls back to mp4 for unknown or missing extensions', () => {
    // A camera hand-off can arrive with no extension at all, and the clip
    // editor outputs MP4 regardless — so mp4 is the safe default rather than
    // a key ending in a stray dot.
    expect(newClipKey('clip')).toMatch(/\.mp4$/);
    expect(newClipKey('clip.avi')).toMatch(/\.mp4$/);
  });

  it('produces keys the worker will accept', () => {
    for (const name of ['a.mp4', 'b.webm', 'c.mov', 'no-extension']) {
      expect(newClipKey(name)).toMatch(WORKER_KEY);
    }
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newClipKey('lift.mp4')));
    expect(keys.size).toBe(50);
  });
});

describe('posterKeyFor', () => {
  it('shares the clip UUID so the pair cannot drift', () => {
    const clip = newClipKey('lift.mp4');
    const poster = posterKeyFor(clip);
    expect(poster).toBe(clip.replace(/\.mp4$/, '.jpg'));
    expect(poster).toMatch(WORKER_KEY);
  });

  it('works for every container', () => {
    for (const name of ['a.mp4', 'b.webm', 'c.mov']) {
      expect(posterKeyFor(newClipKey(name))).toMatch(/\.jpg$/);
    }
  });
});

describe('kinemosObjectUrl', () => {
  it('addresses the worker route (relative: no VITE_API_ORIGIN in test builds)', () => {
    expect(kinemosObjectUrl('0508e555-7384-460c-9c0f-c1ec02144553.mp4')).toBe(
      '/api/kinemos/video/0508e555-7384-460c-9c0f-c1ec02144553.mp4',
    );
  });
});

describe('isWorkerResponse', () => {
  // A host with no worker (the Netlify rollback deploy) answers a PUT to
  // /api/... with the SPA's index.html and a 200. `res.ok` would take that for
  // a stored object and the row would keep a key that points at nothing.
  const withType = (type: string | null) => ({
    headers: { get: (name: string) => (name === 'content-type' ? type : null) } as unknown as Headers,
  });

  it("accepts the worker's JSON answer", () => {
    expect(isWorkerResponse(withType('application/json'))).toBe(true);
    expect(isWorkerResponse(withType('application/json; charset=utf-8'))).toBe(true);
  });

  it('rejects the SPA fallback and anything untyped', () => {
    expect(isWorkerResponse(withType('text/html; charset=utf-8'))).toBe(false);
    expect(isWorkerResponse(withType(null))).toBe(false);
  });
});
