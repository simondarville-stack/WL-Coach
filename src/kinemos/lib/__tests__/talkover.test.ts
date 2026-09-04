import { describe, expect, it } from 'vitest';
import { formatTalkoverLength, talkoverMimeType } from '../talkover';

describe('talkover', () => {
  it('reads a length as minutes and seconds', () => {
    expect(formatTalkoverLength(0)).toBe('0:00');
    expect(formatTalkoverLength(42.4)).toBe('0:42');
    expect(formatTalkoverLength(125)).toBe('2:05');
  });

  it('has no recording type where the browser has no recorder', () => {
    // jsdom has no MediaRecorder; the viewer says so instead of failing.
    expect(talkoverMimeType()).toBeNull();
  });
});
