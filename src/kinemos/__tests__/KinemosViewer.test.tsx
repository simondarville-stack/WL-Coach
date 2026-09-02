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
import { render, screen } from '@testing-library/react';
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

describe('KinemosViewer', () => {
  beforeEach(() => {
    clip.value = libraryVideo();
    frameServerState.status = 'ready';
    frameServerState.error = null;
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
    expect(screen.getByText('ungraded')).toBeInTheDocument();
    expect(screen.getByText(/no scale/i)).toBeInTheDocument();
  });

  it('explains why there are no velocities yet', async () => {
    renderViewer();
    expect(await screen.findByText(/Calibrate against a plate to get velocities/i)).toBeInTheDocument();
  });

  it('offers the bar mass, and says what it is for', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
    expect(screen.getByText('BAR MASS')).toBeInTheDocument();
    expect(screen.getByText(/Power needs a mass/i)).toBeInTheDocument();
  });

  it('offers tracking, and says what it needs first', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
    // Nothing marked yet, so there is no anchor to track from — the button is
    // there but disabled, with the reason stated rather than implied.
    const button = screen.getByRole('button', { name: /Track the bar from here/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Mark the bar end once/i)).toBeInTheDocument();
  });

  it('lets the coach state how the clip was filmed — half the error budget', async () => {
    renderViewer();
    await screen.findByText('Hang clean');
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
    expect(await screen.findByText(/Not calibrated/)).toBeInTheDocument();
    expect(screen.getByText(/distances read in pixels/i)).toBeInTheDocument();
  });

  it('refuses a streaming embed with the reason, not a black stage', async () => {
    clip.value = libraryVideo({ isEmbed: true, playbackUrl: 'https://stream.example/embed' });
    renderViewer();
    expect(await screen.findByText(/streaming embed/i)).toBeInTheDocument();
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
