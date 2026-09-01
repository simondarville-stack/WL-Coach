/**
 * The library's filter semantics, which are easy to get subtly wrong:
 * "unattached only" and "this athlete" are different questions, and a null
 * date must not silently pass a date-bounded filter.
 */
import { describe, expect, it } from 'vitest';
import { applyFilters, type LibraryVideo } from '../videoLibrary';

function video(over: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    key: 'log:1',
    source: 'log',
    sourceId: '1',
    athleteId: 'a1',
    athleteName: 'Jon',
    exerciseName: 'Snatch',
    date: '2026-08-30',
    sortedAt: '2026-08-30T10:00:00Z',
    loadKg: 100,
    loadIsTopSet: false,
    durationS: null,
    fps: null,
    width: null,
    height: null,
    playbackUrl: 'https://example.test/clip.mp4',
    isEmbed: false,
    thumbnailUrl: null,
    note: null,
    sessionId: 's1',
    eventId: null,
    ...over,
  };
}

describe('applyFilters', () => {
  it('returns everything when no filter is set', () => {
    const rows = [video(), video({ key: 'log:2', source: 'event' })];
    expect(applyFilters(rows, {})).toHaveLength(2);
  });

  it('filters by source', () => {
    const rows = [video(), video({ key: 'event:1', source: 'event' })];
    expect(applyFilters(rows, { source: 'event' }).map(r => r.key)).toEqual(['event:1']);
  });

  it('filters by athlete', () => {
    const rows = [video(), video({ key: 'log:2', athleteId: 'a2' })];
    expect(applyFilters(rows, { athleteId: 'a2' }).map(r => r.key)).toEqual(['log:2']);
  });

  it('unattachedOnly keeps exactly the clips with no athlete', () => {
    // The seminar-clip case: footage that belongs to no athlete is
    // first-class, and it is otherwise impossible to find in a long list.
    const rows = [video(), video({ key: 'direct:1', source: 'direct', athleteId: null })];
    expect(applyFilters(rows, { unattachedOnly: true }).map(r => r.key)).toEqual(['direct:1']);
  });

  it('matches exercise names case-insensitively', () => {
    expect(applyFilters([video()], { exerciseName: 'snatch' })).toHaveLength(1);
    expect(applyFilters([video()], { exerciseName: 'Clean' })).toHaveLength(0);
  });

  it('excludes a clip with no exercise when filtering by exercise', () => {
    expect(applyFilters([video({ exerciseName: null })], { exerciseName: 'Snatch' })).toHaveLength(0);
  });

  it('applies inclusive date bounds', () => {
    const rows = [
      video({ key: 'a', date: '2026-08-29' }),
      video({ key: 'b', date: '2026-08-30' }),
      video({ key: 'c', date: '2026-08-31' }),
    ];
    expect(applyFilters(rows, { from: '2026-08-30', to: '2026-08-31' }).map(r => r.key)).toEqual([
      'b',
      'c',
    ]);
  });

  it('drops undated clips from a bounded range rather than letting them through', () => {
    const rows = [video({ key: 'dated' }), video({ key: 'undated', date: null })];
    expect(applyFilters(rows, { from: '2026-01-01' }).map(r => r.key)).toEqual(['dated']);
  });

  it('combines filters', () => {
    const rows = [
      video({ key: 'a', athleteId: 'a1', source: 'log' }),
      video({ key: 'b', athleteId: 'a1', source: 'direct' }),
      video({ key: 'c', athleteId: 'a2', source: 'direct' }),
    ];
    expect(applyFilters(rows, { athleteId: 'a1', source: 'direct' }).map(r => r.key)).toEqual(['b']);
  });
});
