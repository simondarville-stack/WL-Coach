import { describe, it, expect } from 'vitest';
import {
  historyPageWindow,
  REVIEW_HISTORY_PAGE_DAYS,
} from '../reviewFeedService';

/** Fixed clock so the assertions are about the arithmetic, not the day. */
const NOW = Date.parse('2026-08-29T12:00:00.000Z');
const DAY = 86_400_000;
const daysBack = (iso: string) => Math.round((NOW - Date.parse(iso)) / DAY);

describe('historyPageWindow', () => {
  it('page 0 covers the current lookback window, open-ended at now', () => {
    const w = historyPageWindow(7, 0, NOW);
    expect(daysBack(w.windowFromIso)).toBe(7);
    // No upper bound: page 0 runs up to the present moment.
    expect(w.windowToIso).toBeUndefined();
  });

  it('each later page reaches one chunk further back', () => {
    const p1 = historyPageWindow(7, 1, NOW);
    expect(daysBack(p1.windowFromIso)).toBe(7 + REVIEW_HISTORY_PAGE_DAYS);
    expect(daysBack(p1.windowToIso!)).toBe(7);

    const p2 = historyPageWindow(7, 2, NOW);
    expect(daysBack(p2.windowFromIso)).toBe(7 + 2 * REVIEW_HISTORY_PAGE_DAYS);
    expect(daysBack(p2.windowToIso!)).toBe(7 + REVIEW_HISTORY_PAGE_DAYS);
  });

  it('pages tile the timeline with no gap or overlap', () => {
    // Each page must end exactly where the previous one began, or an item
    // falling on the boundary would be shown twice or not at all.
    for (const lookback of [7, 14, 30]) {
      for (let page = 1; page < 6; page++) {
        const prev = historyPageWindow(lookback, page - 1, NOW);
        const cur = historyPageWindow(lookback, page, NOW);
        expect(cur.windowToIso).toBe(prev.windowFromIso);
      }
    }
  });

  it('respects the caller lookback as the history starting edge', () => {
    // With a 30-day queue window, history starts at 30 days back, not 7.
    expect(daysBack(historyPageWindow(30, 0, NOW).windowFromIso)).toBe(30);
    expect(daysBack(historyPageWindow(30, 1, NOW).windowToIso!)).toBe(30);
  });
});
