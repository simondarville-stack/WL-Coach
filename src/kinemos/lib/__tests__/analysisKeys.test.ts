/**
 * The library key ↔ polymorphic source reference round trip.
 *
 * Worth its own tests because it is the seam between two identifier schemes:
 * the library's single string key (`log:<uuid>`) and the analysis rows'
 * (source_kind, source_id) pair. A mis-split here would silently attach an
 * analysis to the wrong clip.
 */
import { describe, expect, it } from 'vitest';
import { clipKeyOf, parseClipKey } from '../analysisService';

describe('parseClipKey', () => {
  it('splits each of the library’s three sources', () => {
    expect(parseClipKey('log:11111111-1111-4111-8111-111111111111')).toEqual({
      kind: 'log',
      id: '11111111-1111-4111-8111-111111111111',
    });
    expect(parseClipKey('event:abc')).toEqual({ kind: 'event', id: 'abc' });
    expect(parseClipKey('direct:abc')).toEqual({ kind: 'direct', id: 'abc' });
  });

  it('rejects a kind that is not one of the three', () => {
    expect(parseClipKey('stream:abc')).toBeNull();
  });

  it('rejects a key with no id', () => {
    expect(parseClipKey('log:')).toBeNull();
    expect(parseClipKey('log')).toBeNull();
    expect(parseClipKey('')).toBeNull();
  });

  it('keeps an id that itself contains a colon intact', () => {
    // Stream-backed ids look like `stream:<uid>` elsewhere in the app; only the
    // FIRST colon separates the kind.
    expect(parseClipKey('log:stream:xyz')).toEqual({ kind: 'log', id: 'stream:xyz' });
  });

  it('round-trips with clipKeyOf', () => {
    const key = clipKeyOf('direct', 'abc');
    expect(key).toBe('direct:abc');
    expect(parseClipKey(key)).toEqual({ kind: 'direct', id: 'abc' });
  });
});
