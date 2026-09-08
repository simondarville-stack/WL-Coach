/**
 * Playback is one render per frame. The panels that do not follow the frame
 * — the metrics, the calibration, the lift — must not be among what that
 * render touches, or a 60 fps clip stutters. This mounts the viewer with the
 * frame server stubbed, steps the frame, and counts.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryVideo } from '../lib/videoLibrary';
import { KinemosViewer } from '../KinemosViewer';

const frameServerState = vi.hoisted(() => ({ index: 0 }));
const renders = vi.hoisted(() => ({ metrics: 0, calibration: 0, lift: 0, timeline: 0 }));

vi.mock('../lib/videoLibrary', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/videoLibrary')>()),
  loadClipByKey: () => Promise.resolve(clipRow()),
}));

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

// Memoised like the real ones: the question is whether the viewer hands
// them the same props from one frame to the next.
vi.mock('../components/MetricsPanel', async () => {
  const { memo } = await import('react');
  return {
    MetricsPanel: memo(() => {
      renders.metrics++;
      return <div>metrics</div>;
    }),
  };
});
vi.mock('../components/CalibrationPanel', async () => {
  const { memo } = await import('react');
  return {
    CalibrationPanel: memo(() => {
      renders.calibration++;
      return <div>calibration</div>;
    }),
  };
});
vi.mock('../components/LiftPanel', async () => {
  const { memo } = await import('react');
  return {
    LiftPanel: memo(() => {
      renders.lift++;
      return <div>lift</div>;
    }),
  };
});
vi.mock('../components/AnalysisPanel', () => ({
  PhaseTimeline: () => {
    renders.timeline++;
    return <div>timeline</div>;
  },
  VelocityChart: () => <div>chart</div>,
}));

// One stable stub, as the real hook's callbacks are stable: a fresh `seek`
// each render would itself be a reason to re-render the plots.
const stable = vi.hoisted(() => ({
  seek: vi.fn(),
  step: vi.fn(),
  togglePlay: vi.fn(),
  setSpeed: vi.fn(),
  server: {
    timestamps: [0, 0.04, 0.08, 0.12],
    keyframeTimestamps: [0],
    frameCount: 4,
    durationS: 0.16,
    displayWidth: 480,
    displayHeight: 854,
    rotation: 0,
    averageFps: 25,
    isVfr: false,
    codec: 'avc',
    frameAt: vi.fn(),
    prefetch: vi.fn(),
    nearestIndex: (t: number) => Math.round(t / 0.04),
    close: vi.fn(),
  },
}));

vi.mock('../hooks/useFrameServer', () => ({
  PLAYBACK_SPEEDS: [0.1, 0.25, 0.5, 1],
  useFrameServer: () => ({
    status: 'ready',
    error: null,
    server: stable.server,
    frame: null,
    index: frameServerState.index,
    playing: false,
    speed: 0.25,
    seek: stable.seek,
    step: stable.step,
    togglePlay: stable.togglePlay,
    setSpeed: stable.setSpeed,
  }),
}));

function clipRow(): LibraryVideo {
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
    width: 1080,
    height: 1920,
    deviceMake: null,
    deviceModel: null,
    playbackUrl: '/api/kinemos/video/vid-1.mp4',
    isEmbed: false,
    thumbnailUrl: null,
    note: null,
    sessionId: null,
    eventId: null,
  };
}

function Viewer() {
  return (
    <MemoryRouter initialEntries={['/kinemos/analysis/direct/vid-1']}>
      <Routes>
        <Route path="/kinemos/analysis/:kind/:id" element={<KinemosViewer />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('KinemosViewer — what a frame step renders', () => {
  beforeEach(() => {
    localStorage.clear();
    frameServerState.index = 0;
    renders.metrics = 0;
    renders.calibration = 0;
    renders.lift = 0;
    renders.timeline = 0;
  });

  it('leaves the metrics, calibration and lift panels alone, and moves the timeline', async () => {
    const view = render(<Viewer />);
    await screen.findByText('Hang clean');
    // Every panel open, so each has a chance to render.
    fireEvent.click(screen.getByRole('radio', { name: 'Work' }));
    await screen.findByText('metrics');
    const before = { ...renders };
    expect(before.metrics).toBeGreaterThan(0);

    frameServerState.index = 1;
    view.rerender(<Viewer />);
    frameServerState.index = 2;
    view.rerender(<Viewer />);

    expect(renders.timeline).toBeGreaterThan(before.timeline);
    expect(renders.metrics).toBe(before.metrics);
    expect(renders.calibration).toBe(before.calibration);
    expect(renders.lift).toBe(before.lift);
  });
});
