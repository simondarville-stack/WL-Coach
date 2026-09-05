/**
 * Tagging on the review reel's session card: `@` lists what the session
 * holds, a tap on a row or chip arms it, and what is sent is the text plus
 * the tags whose tokens are still in it.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionCard } from '../ReviewCards';
import type { ReviewSessionItem, SessionReviewExercise } from '../../../lib/reviewFeedService';

const exercise = (id: string, name: string): SessionReviewExercise => ({
  id,
  name,
  status: 'completed',
  sets: [],
  performedRaw: '',
  performedNotes: '',
  unit: 'kg',
  isCombo: false,
  comboMembers: [],
  gpp: null,
  noteText: null,
  offPlan: false,
  techniqueRating: null,
});

const item = {
  kind: 'session',
  key: 'session:s1',
  seenKey: 's1',
  timestamp: '2026-09-03T18:00:00+00:00',
  athleteId: 'a1',
  session: {
    id: 's1',
    date: '2026-09-03',
    session_label: null,
    session_rpe: 8,
    duration_minutes: 70,
    session_notes: '',
  },
  metrics: [{ key: 'bw', label: 'BW', value: '82,5 kg' }],
  exercises: [exercise('le-1', 'Snatch'), exercise('le-2', 'Back Squat')],
  coachComments: [],
} as unknown as ReviewSessionItem;

const snatch = { kind: 'exercise', logExerciseId: 'le-1', label: 'Snatch' };
const bw = { kind: 'metric', key: 'bw', label: 'BW', value: '82,5 kg' };

function renderCard(onComment = vi.fn(async () => undefined), reactions: string[] = []) {
  render(
    <SessionCard
      item={item}
      athlete={undefined}
      seen={false}
      onComment={onComment}
      reactions={reactions}
    />,
  );
  const box = screen.getByPlaceholderText(/Comment/) as HTMLTextAreaElement;
  return { onComment, box };
}

describe('SessionCard tagging', () => {
  it('lists the session on @, and Enter puts the pick into the draft', () => {
    const { box } = renderCard();
    fireEvent.change(box, { target: { value: '@' } });
    // Exercises, the metric chip, then the session fields — the card's order.
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
      'Snatch',
      'Back Squat',
      'BW82,5 kg',
      'RPE8',
      'Duration70 min',
    ]);

    fireEvent.change(box, { target: { value: '@sq' } });
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Back Squat']);

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('@Back Squat ');
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove @Back Squat' })).toBeInTheDocument();
  });

  it('tags from a tap on the card and sends text plus the tags in it', async () => {
    const { onComment, box } = renderCard();
    fireEvent.click(screen.getByTitle('Tag @Snatch in your comment'));
    fireEvent.click(screen.getByTitle('Tag @BW in your comment'));
    expect(box.value).toBe('@Snatch @BW ');

    fireEvent.change(box, { target: { value: '@Snatch @BW bar drifted, weight fine' } });
    fireEvent.click(screen.getByTitle('Send comment'));
    await waitFor(() => expect(onComment).toHaveBeenCalledTimes(1));
    expect(onComment).toHaveBeenCalledWith('@Snatch @BW bar drifted, weight fine', [snatch, bw]);
    await waitFor(() => expect(box.value).toBe(''));
    expect(screen.getByText(/Sent: @Snatch @BW bar drifted/)).toBeInTheDocument();
  });

  it('drops a tag whose token was deleted, and a chip × removes the token', async () => {
    const { onComment, box } = renderCard();
    fireEvent.click(screen.getByTitle('Tag @Back Squat in your comment'));
    fireEvent.click(screen.getByTitle('Tag @Snatch in your comment'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove @Back Squat' }));
    expect(box.value).toBe('@Snatch ');

    fireEvent.change(box, { target: { value: 'no tags left' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(onComment).toHaveBeenCalledWith('no tags left', []));
  });

  it('a quick reaction carries an armed tag, and stands alone otherwise', async () => {
    const { onComment, box } = renderCard(undefined, ['👍']);
    fireEvent.click(screen.getByTitle('Tag @Snatch in your comment'));
    fireEvent.click(screen.getByRole('button', { name: '👍' }));
    await waitFor(() => expect(onComment).toHaveBeenCalledWith('@Snatch 👍', [snatch]));
    await waitFor(() => expect(box.value).toBe(''));

    fireEvent.change(box, { target: { value: 'writing something' } });
    fireEvent.click(screen.getByRole('button', { name: '👍' }));
    await waitFor(() => expect(onComment).toHaveBeenCalledWith('👍', []));
    // A reaction sent beside a draft leaves the draft alone.
    expect(box.value).toBe('writing something');
  });
});
