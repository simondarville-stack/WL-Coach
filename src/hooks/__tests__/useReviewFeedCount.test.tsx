/**
 * The review badge has to be right before the Review tab is ever opened.
 *
 * `fetchReviewFeedCounts` returns a flat zero for an empty athlete list, and
 * in the coach mobile app nothing filled the athlete store until the Review
 * *screen* mounted — so the badge read 0 no matter how many clips were
 * waiting, and only started working once the coach had already gone looking.
 */
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReviewFeedCount } from '../useReviewFeedCount';
import { useAthleteStore } from '../../store/athleteStore';
import type { Athlete } from '../../lib/database.types';

const athlete = (id: string) => ({ id, name: id, owner_id: 'owner' }) as Athlete;

const accessible = vi.hoisted(() => ({ value: [] as Athlete[] }));
const counted = vi.hoisted(() => ({ calls: [] as string[][] }));

vi.mock('../../lib/accessScope', () => ({
  fetchAccessibleAthletes: () =>
    Promise.resolve({ athletes: accessible.value, accessById: {}, hostNameById: {} }),
}));

vi.mock('../../lib/reviewFeedService', () => ({
  fetchReviewFeedCounts: (_ownerId: string, athleteIds: string[]) => {
    counted.calls.push(athleteIds);
    // Mirrors the real service: no athletes, nothing to count.
    const total = athleteIds.length === 0 ? 0 : athleteIds.length * 2;
    return Promise.resolve({ videos: total, threads: 0, sessions: 0, total });
  },
}));

function Host({ onCount }: { onCount: (n: number) => void }) {
  onCount(useReviewFeedCount());
  return null;
}

/** Render the hook and report the latest count it produced. */
async function mount() {
  const seen: number[] = [];
  render(<Host onCount={n => seen.push(n)} />);
  await act(async () => {});
  await act(async () => {});
  return seen;
}

beforeEach(() => {
  counted.calls = [];
  accessible.value = [];
  useAthleteStore.setState({ athletes: [], athletesLoaded: false, athletesLoading: false });
});

describe('useReviewFeedCount', () => {
  it('loads the athlete list itself rather than waiting for a screen to do it', async () => {
    accessible.value = [athlete('a1'), athlete('a2'), athlete('a3')];

    const seen = await mount();

    // The badge is non-zero without anything else having mounted — this is the
    // regression: it used to sit at 0 until the Review screen filled the store.
    expect(seen[seen.length - 1]).toBe(6);
    expect(counted.calls.some(ids => ids.length === 3)).toBe(true);
  });

  it('counts zero, without erroring, for a coach with no athletes', async () => {
    accessible.value = [];

    const seen = await mount();

    expect(seen[seen.length - 1]).toBe(0);
  });

  it('reuses an already-loaded store instead of refetching', async () => {
    // The desktop shell fills the store on boot; the badge must not undo or
    // duplicate that work.
    useAthleteStore.setState({
      athletes: [athlete('a1'), athlete('a2')],
      athletesLoaded: true,
    });

    const seen = await mount();

    expect(seen[seen.length - 1]).toBe(4);
    expect(counted.calls.every(ids => ids.length === 0 || ids.length === 2)).toBe(true);
  });
});
