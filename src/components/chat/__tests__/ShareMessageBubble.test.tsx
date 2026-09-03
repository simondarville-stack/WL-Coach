/**
 * The share card says what was shared, in EMOS's own conventions: day-first
 * dates, comma decimals, no judgement.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShareMessageBubble } from '../ShareMessageBubble';
import type { KinemosShare } from '../../../lib/database.types';

const share: KinemosShare = {
  id: 'share-1',
  owner_id: 'env',
  analysis_id: 'analysis-1',
  channel: 'athlete',
  athlete_id: 'athlete-1',
  sender_coach_id: 'coach-1',
  message_id: 'message-1',
  recipient_coach_id: null,
  note: null,
  coach_read_at: null,
  asset_key: 'abc.jpg',
  summary: {
    athleteName: 'Caroline',
    exerciseName: 'Snatch',
    date: '2026-09-03',
    loadKg: 62.5,
    repIndex: 2,
    label: null,
    vmaxMs: 2.312,
    peakHeightCm: 133.5,
    grade: 'B',
    clipUrl: null,
  },
  created_at: '2026-09-03T14:02:00+00:00',
  athlete_read_at: null,
};

describe('ShareMessageBubble', () => {
  it('names the lift the European way and gives the numbers with comma decimals', () => {
    render(<ShareMessageBubble share={share} isOwn={false} theme="dark" />);
    expect(screen.getAllByText(/Snatch · 62,5 kg · 03\/09 · rep 2/).length).toBeGreaterThan(0);
    expect(screen.getByText('2,31 m/s')).toBeInTheDocument();
    expect(screen.getByText('134 cm')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByText(/Watch the clip/)).toBeNull();
  });

  it('reports the opening and offers the clip when there is one', () => {
    const onOpen = vi.fn();
    render(
      <ShareMessageBubble
        share={{ ...share, summary: { ...share.summary, clipUrl: '/api/kinemos/video/x.mp4' } }}
        isOwn={false}
        theme="light"
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open Snatch/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'share-1' }));
    expect(screen.getByText(/Watch the clip/)).toBeInTheDocument();
  });
});
