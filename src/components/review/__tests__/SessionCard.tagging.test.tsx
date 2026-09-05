/**
 * Tagging on the review reel's session card: `#` lists what the session
 * holds, a tap on a row, a set column or a chip arms it, a set is a path
 * under its exercise, and what is sent is the text plus the tags whose
 * tokens are still in it.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionCard } from '../ReviewCards';
import type { TrainingLogSet } from '../../../lib/database.types';
import type { ReviewSessionItem, SessionReviewExercise } from '../../../lib/reviewFeedService';

const set = (n: number, over: Partial<TrainingLogSet> = {}): TrainingLogSet => ({
  id: `set-${n}`,
  owner_id: null,
  log_exercise_id: 'le-1',
  set_number: n,
  planned_load: null,
  planned_reps: null,
  performed_load: 80,
  performed_reps: 3,
  performed_text: null,
  rpe: null,
  status: 'completed',
  notes: null,
  created_at: '',
  updated_at: '',
  ...over,
});

const exercise = (id: string, name: string, sets: TrainingLogSet[] = []): SessionReviewExercise => ({
  id,
  name,
  status: 'completed',
  sets,
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
  exercises: [
    exercise('le-1', 'Snatch', [set(1), set(2, { performed_load: 85, performed_reps: 2 })]),
    exercise('le-2', 'Back Squat'),
  ],
  coachComments: [],
} as unknown as ReviewSessionItem;

const snatch = { kind: 'exercise', logExerciseId: 'le-1', label: 'Snatch' };
const snatch1 = { ...snatch, setNumber: 1 };
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

const optionLabels = () => screen.getAllByRole('option').map(o => o.textContent);

describe('SessionCard tagging', () => {
  it('lists the session on #, and Enter puts the pick into the draft', () => {
    const { box } = renderCard();
    fireEvent.change(box, { target: { value: '#' } });
    // Exercises, the metric chip, then the session fields — the card's order.
    expect(optionLabels()).toEqual(['Snatch', 'Back Squat', 'BW82,5 kg', 'RPE8', 'Duration70 min']);

    fireEvent.change(box, { target: { value: '#sq' } });
    expect(optionLabels()).toEqual(['Back Squat']);

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('#Back Squat ');
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove #Back Squat' })).toBeInTheDocument();
  });

  it('a set is a path: #Snatch/ lists the sets, → drills in, ← backs out', () => {
    const { box } = renderCard();
    fireEvent.change(box, { target: { value: '#sn' } });
    expect(optionLabels()).toEqual(['Snatch']);
    expect(screen.getByRole('button', { name: 'Sets of Snatch' })).toBeInTheDocument();

    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(box.value).toBe('#Snatch/');
    expect(optionLabels()).toEqual(['Snatchwhole exercise', 'Snatch/180 × 3', 'Snatch/285 × 2']);

    fireEvent.keyDown(box, { key: 'ArrowLeft' });
    expect(box.value).toBe('#Snatch');
    expect(optionLabels()).toEqual(['Snatch']);

    fireEvent.change(box, { target: { value: '#Snatch/2' } });
    expect(optionLabels()).toEqual(['Snatch/285 × 2']);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('#Snatch/2 ');
    expect(screen.getByRole('button', { name: 'Remove #Snatch/2' })).toBeInTheDocument();
  });

  it('tags from a tap on the card — a row, a set column, a chip — and sends text plus tags', async () => {
    const { onComment, box } = renderCard();
    fireEvent.click(screen.getByTitle('Tag #Snatch in your comment'));
    fireEvent.click(screen.getByTitle('Tag #Snatch/1 in your comment'));
    fireEvent.click(screen.getByTitle('Tag #BW in your comment'));
    expect(box.value).toBe('#Snatch #Snatch/1 #BW ');

    fireEvent.change(box, { target: { value: '#Snatch #Snatch/1 #BW bar drifted, weight fine' } });
    fireEvent.click(screen.getByTitle('Send comment'));
    await waitFor(() => expect(onComment).toHaveBeenCalledTimes(1));
    expect(onComment).toHaveBeenCalledWith('#Snatch #Snatch/1 #BW bar drifted, weight fine', [
      snatch,
      snatch1,
      bw,
    ]);
    await waitFor(() => expect(box.value).toBe(''));
    expect(screen.getByText(/Sent: #Snatch #Snatch\/1 #BW bar drifted/)).toBeInTheDocument();
  });

  it('drops a tag whose token was deleted; a chip × removes only its own token', async () => {
    const { onComment, box } = renderCard();
    fireEvent.click(screen.getByTitle('Tag #Snatch/1 in your comment'));
    fireEvent.click(screen.getByTitle('Tag #Snatch in your comment'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove #Snatch' }));
    expect(box.value).toBe('#Snatch/1 ');

    fireEvent.change(box, { target: { value: 'no tags left' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(onComment).toHaveBeenCalledWith('no tags left', []));
  });

  it('a quick reaction carries an armed tag, and stands alone otherwise', async () => {
    const { onComment, box } = renderCard(undefined, ['👍']);
    fireEvent.click(screen.getByTitle('Tag #Snatch/1 in your comment'));
    fireEvent.click(screen.getByRole('button', { name: '👍' }));
    await waitFor(() => expect(onComment).toHaveBeenCalledWith('#Snatch/1 👍', [snatch1]));
    await waitFor(() => expect(box.value).toBe(''));

    fireEvent.change(box, { target: { value: 'writing something' } });
    fireEvent.click(screen.getByRole('button', { name: '👍' }));
    await waitFor(() => expect(onComment).toHaveBeenCalledWith('👍', []));
    // A reaction sent beside a draft leaves the draft alone.
    expect(box.value).toBe('writing something');
  });
});
