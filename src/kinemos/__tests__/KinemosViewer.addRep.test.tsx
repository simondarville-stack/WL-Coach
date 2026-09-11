/**
 * "+ rep" on a set the tracker cut wrongly: the new, empty rep offers to
 * track on from where the previous rep ended to the end of the clip, and the
 * reps found land on the new indices. Decoding is stubbed as in
 * KinemosViewer.test.tsx; the set tracker is stubbed here so the test can
 * say what it was asked to track.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryVideo } from '../lib/videoLibrary';
import { KinemosViewer } from '../KinemosViewer';

const FRAME = 0.04;
const FRAME_COUNT = 60;
const timestamps = Array.from({ length: FRAME_COUNT }, (_, i) => Number((i * FRAME).toFixed(4)));

const trackSet = vi.hoisted(() => vi.fn());
const persistRep = vi.hoisted(() => vi.fn());

vi.mock('../lib/videoLibrary', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/videoLibrary')>()),
  loadClipByKey: () =>
    Promise.resolve<LibraryVideo>({
      key: 'direct:vid-1',
      source: 'direct',
      sourceId: 'vid-1',
      athleteId: 'a-1',
      athleteName: 'Jon Herskind',
      exerciseName: 'Hang clean',
      exerciseId: null,
      liftModelId: null,
      liftModelHow: null,
      date: '2026-08-26',
      sortedAt: '2026-08-26T17:42:00Z',
      loadKg: 130,
      loadIsTopSet: false,
      durationS: 2.4,
      fps: 25,
      width: 480,
      height: 270,
      deviceMake: null,
      deviceModel: null,
      playbackUrl: '/api/kinemos/video/vid-1.mp4',
      isEmbed: false,
      thumbnailUrl: null,
      note: null,
      sessionId: null,
      eventId: null,
    }),
}));

// Rep 1 exists with a short track and a plate outline; rep 2 does not exist yet.
vi.mock('../lib/analysisService', () => ({
  listReps: () => Promise.resolve([{ rep_index: 1, metrics: null }]),
  loadBundle: (_kind: string, _id: string, repIndex: number) =>
    Promise.resolve(
      repIndex === 1
        ? {
            analysis: {
              id: 'an-1', owner_id: null, source_kind: 'direct', source_id: 'vid-1', rep_index: 1, label: null,
              frame_width: 480, frame_height: 270, rotation: 0, mass_kg: null, mass_source: null, status: 'draft',
              notes: null, phase_boundaries: null, phase_set_id: 'default', lift_model_id: null, front_view: null, metrics: null, camera: null,
              is_reference: false, is_model: false, model_label: null, created_at: '', updated_at: '',
            },
            calibration: {
              id: 'cal-1', owner_id: null, analysis_id: 'an-1', frame_index: 1, frame_t: 0.04,
              ellipse_cx: 240, ellipse_cy: 200, semi_major_px: 30, semi_minor_px: 28, tilt_deg: 0,
              plate_diameter_cm: 45, cm_per_px_v: null, cm_per_px_h: null, viewing_angle_deg: null,
              confidence: null, distortion_source: 'none', stabilised: false, created_at: '',
            },
            track: {
              id: 'tr-1', owner_id: null, analysis_id: 'an-1', kind: 'bar_end',
              points: [
                { t: 0.04, x: 240, y: 200 },
                { t: 0.08, x: 241, y: 170 },
                { t: 0.12, x: 242, y: 140 },
              ],
              tracker_tier: 'assisted', correction_count: 0, filter_settings: null, created_at: '', updated_at: '',
            },
            annotations: [],
          }
        : null,
    ),
  ensureAnalysis: vi.fn(),
  saveTrack: vi.fn(),
  saveCalibration: vi.fn(),
  clearCalibration: vi.fn(),
  addAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
}));

vi.mock('../lib/shareService', () => ({
  listSharesForAnalysis: () => Promise.resolve([]),
  createShare: vi.fn(),
  createClubShare: vi.fn(),
  deleteShare: vi.fn(),
  fetchAthleteOwnerId: vi.fn(),
}));

vi.mock('../lib/setTracker', () => ({ trackSet }));
// The activity scan opens a second, thumbnail-sized frame server on the clip
// URL; there is no clip here.
vi.mock('../lib/activityScan', () => ({
  scanActivity: vi.fn().mockResolvedValue(null),
  windowLabel: () => '',
}));
vi.mock('../lib/autoAnalyse', () => ({ persistRep }));

vi.mock('../hooks/useFrameServer', () => ({
  PLAYBACK_SPEEDS: [0.1, 0.25, 0.5, 1],
  useFrameServer: () => ({
    status: 'ready',
    error: null,
    server: {
      timestamps,
      keyframeTimestamps: [0],
      frameCount: FRAME_COUNT,
      durationS: FRAME_COUNT * FRAME,
      displayWidth: 480,
      displayHeight: 270,
      rotation: 0,
      averageFps: 25,
      isVfr: false,
      codec: 'avc',
      frameAt: vi.fn(),
      prefetch: vi.fn(),
      nearestIndex: (t: number) => {
        let best = 0;
        for (let i = 1; i < timestamps.length; i++) if (Math.abs(timestamps[i] - t) < Math.abs(timestamps[best] - t)) best = i;
        return best;
      },
      close: vi.fn(),
    },
    frame: null,
    index: 0,
    playing: false,
    speed: 0.25,
    seek: vi.fn(),
    step: vi.fn(),
    togglePlay: vi.fn(),
    setSpeed: vi.fn(),
  }),
}));

function renderViewer() {
  return render(
    <MemoryRouter initialEntries={['/kinemos/analysis/direct/vid-1']}>
      <Routes>
        <Route path="/kinemos/analysis/:kind/:id" element={<KinemosViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('KinemosViewer · "+ rep" offers to track the rest of the clip', () => {
  beforeEach(() => {
    localStorage.clear();
    trackSet.mockReset();
    persistRep.mockReset();
  });

  it('remembers where rep 1 ended, and tracks from there to the end as rep 2', async () => {
    const restPoints = [
      { t: 0.8, x: 240, y: 200 },
      { t: 0.84, x: 241, y: 160 },
      { t: 0.88, x: 242, y: 120 },
    ];
    trackSet.mockResolvedValue({
      points: restPoints,
      tracked: restPoints.length,
      lowConfidenceIndices: [],
      reps: [
        {
          rep: 1,
          segment: { from: 0, to: 2, liftOffT: 0.8, apexT: 0.88, catchT: 0.88, riseCm: 80 },
          points: restPoints,
          ellipse: { cx: 240, cy: 200, semiMajorPx: 30, semiMinorPx: 28, tiltDeg: 0 },
          calibration: {
            cmPerPxV: 0.75, cmPerPxH: 0.8, viewingAngleDeg: 0, tiltDeg: 0, rollDeg: 0,
            plateDiameterCm: 45, confidence: 'ok', reason: null,
          },
          ownCalibration: true,
          lowConfidenceIndices: [],
        },
      ],
      joins: [],
      lostAtEnd: false,
      colour: null,
    });
    persistRep.mockResolvedValue('an-2');

    renderViewer();
    await screen.findByText('Hang clean');
    // Rep 1's track has arrived when its pill is on screen with the rep count.
    await screen.findByRole('button', { name: /Rep 1/ });
    await waitFor(() => expect(screen.getByTitle('Add a rep')).toBeInTheDocument());

    // Nothing to track on from before a rep is added.
    expect(screen.queryByRole('button', { name: 'Track the rest of the clip' })).toBeNull();

    fireEvent.click(screen.getByTitle('Add a rep'));

    const offer = await screen.findByRole('button', { name: 'Track the rest of the clip' });
    // The last stored point of rep 1 is at 0,12 s — frame 3 of 60.
    expect(screen.getByText(/From 0,1 s \(the end of rep 1\) to the end of the clip/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /This lift · rep 2/ })).toBeInTheDocument();

    fireEvent.click(offer);

    await screen.findByText(/1 rep found after rep 1, from 0,1 s to the end of the clip\./);
    expect(trackSet).toHaveBeenCalledTimes(1);
    const [, anchor, options] = trackSet.mock.calls[0];
    expect(anchor).toEqual({ index: 3, x: 242, y: 140 });
    expect(options.range).toEqual({ from: 3, to: FRAME_COUNT - 1 });
    // The rep found is stored as rep 2 — the rep that was just added.
    expect(persistRep).toHaveBeenCalledTimes(1);
    expect(persistRep.mock.calls[0][0]).toMatchObject({ repIndex: 2, sourceId: 'vid-1', points: restPoints });
    // The offer is spent; the new rep now has a track.
    expect(screen.queryByRole('button', { name: 'Track the rest of the clip' })).toBeNull();
  }, 20000);

  it('says so when nothing after that point is a lift', async () => {
    trackSet.mockResolvedValue({ points: [], tracked: 0, lowConfidenceIndices: [], reps: [], joins: [], lostAtEnd: false, colour: null });
    renderViewer();
    await screen.findByText('Hang clean');
    await waitFor(() => expect(screen.getByTitle('Add a rep')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Add a rep'));
    fireEvent.click(await screen.findByRole('button', { name: 'Track the rest of the clip' }));
    await screen.findByText(/could not get hold of the bar at 0,1 s/);
    expect(persistRep).not.toHaveBeenCalled();
    // The offer stays, so the coach can scrub and try again from a better frame.
    expect(screen.getByRole('button', { name: 'Track the rest of the clip' })).toBeInTheDocument();
  }, 20000);
});
