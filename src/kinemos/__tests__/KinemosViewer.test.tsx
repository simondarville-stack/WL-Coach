/**
 * Render coverage for the study room.
 *
 * Decoding is WebCodecs and cannot run under jsdom, so the frame server is
 * stubbed here and verified for real in the browser instead
 * (`verify/frame-server.html`). What these tests cover is the part jsdom CAN
 * answer honestly: that the tree mounts, that a clip which cannot be analysed
 * is refused with a reason rather than opened onto a black stage, and that the
 * rail says which unit its numbers are in.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryVideo } from '../lib/videoLibrary';
import { KinemosViewer } from '../KinemosViewer';

const clip = vi.hoisted(() => ({ value: null as LibraryVideo | null }));
const frameServerState = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'error' | 'opening',
  error: null as string | null,
}));

vi.mock('../lib/videoLibrary', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/videoLibrary')>()),
  loadClipByKey: () => Promise.resolve(clip.value),
}));

// Nothing has ever been analysed in these tests: the viewer must render a
// blank rep perfectly well, because that is what opening a fresh clip is.
vi.mock('../lib/analysisService', () => ({
  listReps: () => Promise.resolve([]),
  loadBundle: () => Promise.resolve(null),
  ensureAnalysis: vi.fn(),
  saveTrack: vi.fn(),
  saveCalibration: vi.fn(),
  clearCalibration: vi.fn(),
  addAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
}));

vi.mock('../hooks/useFrameServer', () => ({
  PLAYBACK_SPEEDS: [0.1, 0.25, 0.5, 1],
  useFrameServer: () => ({
    status: frameServerState.status,
    error: frameServerState.error,
    server:
      frameServerState.status === 'ready'
        ? {
            timestamps: [0, 0.04, 0.08],
            keyframeTimestamps: [0],
            frameCount: 3,
            durationS: 0.12,
            displayWidth: 480,
            displayHeight: 270,
            rotation: 0,
            averageFps: 25,
            isVfr: false,
            codec: 'avc',
            frameAt: vi.fn(),
            prefetch: vi.fn(),
            nearestIndex: vi.fn(),
            close: vi.fn(),
          }
        : null,
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

function libraryVideo(overrides: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    key: 'direct:vid-1',
    source: 'direct',
    sourceId: 'vid-1',
    athleteId: 'a-1',
    athleteName: 'Jon Herskind',
    exerciseName: 'Hang clean',
    date: '2026-08-26',
    sortedAt: '2026-08-26T17:42:00Z',
    loadKg: 130,
    loadIsTopSet: false,
    durationS: 3.6,
    fps: 60,
    width: 1920,
    height: 1080,
    deviceMake: null,
    deviceModel: null,
    playbackUrl: '/api/kinemos/video/vid-1.mp4',
    isEmbed: false,
    thumbnailUrl: null,
    note: null,
    sessionId: null,
    eventId: null,
    ...overrides,
  };
}

function renderViewer() {
  return render(
    <MemoryRouter initialEntries={['/kinemos/analysis/direct/vid-1']}>
      <Routes>
        <Route path="/kinemos/analysis/:kind/:id" element={<KinemosViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The rail is progressive disclosure by panel: most of it is collapsed on a
 *  fresh screen, and a test that wants a panel's content opens it the way a
 *  coach does — by its header. */
function openPanel(title: RegExp) {
  const header = screen
    .getAllByRole('button', { expanded: false })
    .find(b => title.test(b.textContent ?? ''));
  if (!header) throw new Error(`No collapsed panel titled ${title}`);
  fireEvent.click(header);
}

describe('KinemosViewer', () => {
  beforeEach(() => {
    clip.value = libraryVideo();
    frameServerState.status = 'ready';
    frameServerState.error = null;
    localStorage.clear();
  });

  it('opens on the lift and its velocity curve, and says how much of the rail is open', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
    expect(screen.getByText('2 of 7 panels open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /This lift · rep 1/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Tracking & correction/ })).toHaveAttribute('aria-expanded', 'false');
    // The bar-path column is always on screen, whatever the rail shows.
    expect(screen.getByRole('radiogroup', { name: 'Plot' })).toBeInTheDocument();
  });

  it('a depth opens every panel at once; a hand toggle makes the layout the coach’s own', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
    fireEvent.click(screen.getByRole('radio', { name: 'Work' }));
    expect(screen.getByText('7 of 7 panels open')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Work' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Calibration/ }));
    expect(screen.getByText('6 of 7 panels open')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Work' })).toHaveAttribute('aria-checked', 'false');
  });

  it('Share opens the notes panel rather than a dialog', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
    expect(screen.getByRole('button', { name: /Notes & sharing/ })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('button', { name: /Notes & sharing/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('SHARE')).toBeInTheDocument();
  });

  it('mounts with the clip’s context in the header', async () => {
    renderViewer();
    expect(await screen.findByText('Hang clean')).toBeInTheDocument();
    expect(screen.getByText(/Jon Herskind/)).toBeInTheDocument();
    // European date, comma-free integer load — DISPLAY_CONVENTIONS.
    expect(screen.getByText(/130 kg/)).toBeInTheDocument();
    expect(screen.getByText(/26\/08/)).toBeInTheDocument();
  });

  it('refuses to grade an uncalibrated clip, and says why', async () => {
    renderViewer();
    // The header carries the glanceable verdict...
    expect(await screen.findByText('NOT GRADED')).toBeInTheDocument();
    // ...and the rail says what is missing, rather than showing a letter with
    // nothing behind it.
    openPanel(/Tracking & correction/);
    expect(screen.getAllByText('ungraded').length).toBeGreaterThan(0);
    expect(screen.getByText(/no scale/i)).toBeInTheDocument();
  });

  it('explains why there are no velocities yet', async () => {
    renderViewer();
    expect(await screen.findByText(/Calibrate against a plate to get velocities/i)).toBeInTheDocument();
  });

  it('offers the bar mass, and says what it is for', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
    openPanel(/All metrics/);
    expect(screen.getByText('BAR MASS')).toBeInTheDocument();
    expect(screen.getByText(/Power needs a mass/i)).toBeInTheDocument();
  });

  it('offers tracking, and says what it needs first', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
    openPanel(/Tracking & correction/);
    // Nothing marked yet, so there is no anchor to track from — the button is
    // there but disabled, with the reason stated rather than implied.
    const button = screen.getByRole('button', { name: /Track the bar from here/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Mark the bar end once/i)).toBeInTheDocument();
  });

  it('lets the coach state how the clip was filmed — half the error budget', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
    openPanel(/Tracking & correction/);
    expect(screen.getByText('HOW IT WAS FILMED')).toBeInTheDocument();
  });

  it('offers every tool in the rail', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
    for (const label of [
      /drag to pan/i,
      /Calibrate against a plate/i,
      /Mark the bar end/i,
      /Measure a distance/i,
      /Measure an angle/i,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('says distances are in pixels until a plate is outlined', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
    // Collapsed, the panel still says so in its headline...
    expect(screen.getByText('not calibrated')).toBeInTheDocument();
    // ...and open, it says what to do about it.
    openPanel(/Calibration/);
    expect(screen.getByText(/Not calibrated/)).toBeInTheDocument();
    expect(screen.getByText(/distances read in pixels/i)).toBeInTheDocument();
  });

  it('opens a streaming embed on its player and says why there is nothing to measure', async () => {
    // P8 plan §4: no frames to step through, so the Stream player stands in
    // for the stage and the sentence says where reps come from for such a
    // clip — with none stored here, that there are none.
    clip.value = libraryVideo({ isEmbed: true, playbackUrl: 'https://stream.example/embed' });
    renderViewer();
    expect(await screen.findByText(/streams from Cloudflare and has no stored reps/i)).toBeInTheDocument();
    expect(screen.getByTitle('Hang clean')).toHaveAttribute('src', 'https://stream.example/embed');
  });

  it('surfaces a decoder failure as the frame server worded it', async () => {
    frameServerState.status = 'error';
    frameServerState.error = 'This browser cannot decode hevc frame by frame.';
    renderViewer();
    expect(await screen.findByText(/cannot decode hevc/i)).toBeInTheDocument();
  });

  it('reports a clip that is no longer in the library', async () => {
    clip.value = null;
    renderViewer();
    expect(await screen.findByText(/not in the library any more/i)).toBeInTheDocument();
  });
});
