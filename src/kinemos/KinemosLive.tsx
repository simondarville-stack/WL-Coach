/**
 * KinemosLive — the bar's speed, now, on the platform.
 *
 * **Design §13 open question 4 — the live-mode product shape — answered:
 * a VBT-unit readout, not live path drawing.** The design left the choice
 * open between the two. It is not close, and the reasons are about where a
 * coach's eyes are rather than about what is technically possible:
 *
 *   1. **A coach watching a screen is not watching the lifter.** A bar path
 *      drawn live is information that can only be consumed by looking away
 *      at the exact moment you should not. A number that appears AFTER the
 *      rep is read in the gap that already exists between reps.
 *   2. **The bar path is a review artefact and KinEMOS already does it
 *      properly.** Two paths overlaid, phase-aligned, with a delta table, is
 *      an argument; one path drawn live at 30 fps is a squiggle.
 *   3. **Live has one job the recorded viewer cannot do: the cue.** "Stop
 *      when the bar has slowed 10 % from your best" is a decision that has
 *      to be taken between reps or not at all — and the velocity-loss
 *      machinery P5a built is exactly what answers it.
 *
 * So this screen is a big number, a set list, and a stop cue. Everything
 * else — paths, phases, comparison, grades — is what the clip is for
 * afterwards.
 *
 * **How it tracks without a click per frame.** The plate is found once with
 * OpenCV, its colour is sampled there, and every frame after that the
 * plate-coloured patch nearest the last position is found
 * (`engine/plateColour.ts`, from P3g). That is a few milliseconds a frame —
 * template correlation and Hough circles are not — and it is immune to the
 * plate spinning, which live footage does constantly.
 *
 * **What live mode does NOT claim.** Nothing here is stored, and nothing is
 * graded. A phone propped against a water bottle, uncalibrated for lens and
 * unchecked for camera angle, is an everyday-tier measurement at best; the
 * numbers are for the decision between sets, and the clip a coach films
 * alongside is what gets analysed properly. The screen says so rather than
 * implying an authority it has not earned.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Circle, Video, VideoOff } from 'lucide-react';
import { Button, StandardPage } from '../components/ui';
import { DEFAULT_PLATE_DIAMETER_CM, calibrateFromEllipse, type PlateEllipse } from './engine/calibration';
import { liveInit, liveStatus, liveStep, type LiveRep, type LiveState } from './engine/liveReps';
import { findColourBlob, sampleSpotColour, type PlateColourModel } from './engine/plateColour';
import { repAtLossCutoff, velocityLoss } from './engine/loadVelocity';
import { findPlate } from './cv/plate';
import { grayFromRgba } from './engine/tracker';
import { num } from './lib/viewerFormat';

type Status = 'idle' | 'starting' | 'finding' | 'live' | 'error';

/** The cue, in the coach's own terms. COACH-CONFIG candidate. */
const DEFAULT_CUTOFF_PCT = 10;

export function KinemosLive() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const stateRef = useRef<LiveState | null>(null);
  const colourRef = useRef<PlateColourModel | null>(null);
  const lastRef = useRef<{ x: number; y: number; radiusPx: number } | null>(null);

  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [reps, setReps] = useState<LiveRep[]>([]);
  const [above, setAbove] = useState(0);
  const [plateCm, setPlateCm] = useState(DEFAULT_PLATE_DIAMETER_CM);
  const [cutoffPct, setCutoffPct] = useState(DEFAULT_CUTOFF_PCT);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    stateRef.current = null;
    colourRef.current = null;
    lastRef.current = null;
    setStatus('idle');
  }, []);

  useEffect(() => stop, [stop]);

  /**
   * Open the camera, find the plate on the first steady frame, learn its
   * colour, and start following it.
   */
  const start = useCallback(async () => {
    setMessage(null);
    setReps([]);
    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The back camera where there is a choice, and the highest rate the
        // device will give: velocity is a difference, and the frame rate is
        // the denominator.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, frameRate: { ideal: 60 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('No video element.');
      video.srcObject = stream;
      await video.play();

      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvasRef.current = canvas;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('No 2D context.');

      setStatus('finding');
      setMessage('Point the camera along the bar and keep the plate in shot, still, for a moment.');
      const grab = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      };
      // Try a few frames: the first one off a camera is often still
      // exposing.
      let found: PlateEllipse | null = null;
      for (let attempt = 0; attempt < 12 && !found; attempt++) {
        const image = grab();
        const gray = grayFromRgba(image.data, image.width, image.height);
        const hit = await findPlate(gray, {
          minRadiusPx: Math.max(8, Math.round(canvas.height * 0.04)),
          maxRadiusPx: Math.round(canvas.height * 0.3),
        });
        if (hit && hit.support >= 0.5) found = hit.ellipse;
        else await new Promise(r => setTimeout(r, 250));
      }
      if (!found) {
        throw new Error(
          'No plate found. Live mode needs a whole plate in shot, side on, with the camera roughly level with it.',
        );
      }

      const image = grab();
      const colour = sampleSpotColour(
        { data: image.data, width: image.width, height: image.height },
        { x: found.cx, y: found.cy },
        found.semiMajorPx * 0.6,
      );
      if (!colour) {
        throw new Error(
          'The plate has no colour to follow — live mode needs a coloured bumper. A black plate can still be filmed and analysed afterwards.',
        );
      }
      colourRef.current = colour;
      lastRef.current = { x: found.cx, y: found.cy, radiusPx: found.semiMajorPx };
      stateRef.current = liveInit(calibrateFromEllipse(found, plateCm));

      setStatus('live');
      setMessage(null);

      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        const model = colourRef.current;
        const last = lastRef.current;
        const state = stateRef.current;
        if (!model || !last || !state || video.readyState < 2) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const blob = findColourBlob(
          { data: frame.data, width: frame.width, height: frame.height },
          model,
          {
            near: last,
            // Generous: at 3 m/s the bar covers a plate radius in about a
            // tenth of a second, and a dropped frame must not lose it.
            searchRadiusPx: last.radiusPx * 2.5,
            radiusPx: last.radiusPx,
            step: 2,
            minFill: 0.25,
          },
        );
        if (!blob) return;
        lastRef.current = { ...last, x: blob.x, y: blob.y };
        const out = liveStep(state, { t: performance.now() / 1000, x: blob.x, y: blob.y });
        stateRef.current = out.state;
        setAbove(liveStatus(out.state).aboveCm);
        if (out.rep) setReps(current => [...current, out.rep as LiveRep]);
      };
      tick();
    } catch (e) {
      stop();
      setStatus('error');
      setMessage(
        e instanceof Error
          ? e.message
          : 'The camera could not be opened. Live mode needs permission and a secure connection.',
      );
    }
  }, [plateCm, stop]);

  const velocities = reps.map(r => r.peakVelocityMs);
  const loss = velocityLoss(velocities);
  const cutoffRep = repAtLossCutoff(velocities, cutoffPct);
  const latest = reps[reps.length - 1] ?? null;
  const stopNow = cutoffRep !== null && cutoffRep === reps.length;

  return (
    <StandardPage>
      <div style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', flex: 1 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <Link to="/kinemos" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-text-secondary)', fontSize: 'var(--text-label)' }}>
            <ChevronLeft size={14} />
            Library
          </Link>
          <h1 style={{ margin: 0, fontSize: 'var(--text-section)', fontWeight: 600 }}>Live</h1>
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
            velocity between sets — nothing is stored
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 'var(--space-sm)' }}>
            {status === 'live' || status === 'finding' ? (
              <Button size="sm" variant="secondary" onClick={stop}>
                <VideoOff size={13} />
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={() => void start()} disabled={status === 'starting'}>
                <Video size={13} />
                {status === 'starting' ? 'Opening the camera…' : 'Start'}
              </Button>
            )}
          </span>
        </header>

        <div style={{ display: 'flex', gap: 'var(--space-lg)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* The number, at the size it has to be to read from a platform. */}
          <section
            style={{
              flex: '1 1 320px',
              minWidth: 280,
              padding: 'var(--space-lg)',
              borderRadius: 'var(--radius-md)',
              background: stopNow ? 'var(--color-danger-bg)' : 'var(--color-bg-primary)',
              border: '1px solid var(--color-border-secondary)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 'var(--text-micro)', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
              {latest ? `REP ${latest.index}` : 'PEAK VELOCITY'}
            </div>
            <div style={{ fontSize: 72, lineHeight: 1.05, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {latest ? num(latest.peakVelocityMs, 2) : '—'}
            </div>
            <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
              {latest ? `m/s · ${num(latest.riseCm, 0)} cm` : 'm/s'}
            </div>
            {loss && (
              <div style={{ marginTop: 'var(--space-sm)', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
                {`${num(loss.worstLossPct, 0)} % down from ${num(loss.bestMs, 2)} on rep ${loss.bestIndex + 1}`}
              </div>
            )}
            {stopNow && (
              <div style={{ marginTop: 'var(--space-sm)', fontWeight: 600, color: 'var(--color-danger-text)' }}>
                {`That is ${cutoffPct} % — the set has done its work.`}
              </div>
            )}
            {status === 'live' && !latest && (
              <div style={{ marginTop: 'var(--space-sm)', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                {`Following the plate. Bar ${num(above, 0)} cm up.`}
              </div>
            )}
          </section>

          <section style={{ flex: '1 1 320px', minWidth: 280 }}>
            <video
              ref={videoRef}
              muted
              playsInline
              style={{
                width: '100%',
                borderRadius: 'var(--radius-md)',
                background: '#000',
                aspectRatio: '16 / 9',
                objectFit: 'cover',
              }}
            />
            <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-sm)', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Circle size={12} />
                Plate
                <input
                  type="number"
                  value={plateCm}
                  onChange={e => setPlateCm(Number(e.target.value))}
                  disabled={status === 'live'}
                  className="emos-input"
                  style={{ width: 68, height: 26, fontSize: 'var(--text-caption)' }}
                />
                cm
              </label>
              <label style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Stop at
                <input
                  type="number"
                  value={cutoffPct}
                  onChange={e => setCutoffPct(Number(e.target.value))}
                  className="emos-input"
                  style={{ width: 60, height: 26, fontSize: 'var(--text-caption)' }}
                />
                % loss
              </label>
            </div>
          </section>
        </div>

        {message && (
          <p style={{ margin: 0, fontSize: 'var(--text-label)', color: status === 'error' ? 'var(--color-danger-text)' : 'var(--color-text-secondary)', maxWidth: '70ch' }}>
            {message}
          </p>
        )}

        {reps.length > 0 && (
          <table style={{ borderCollapse: 'collapse', fontSize: 'var(--text-label)', maxWidth: 420 }}>
            <thead>
              <tr style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-micro)', textAlign: 'left' }}>
                <th style={{ padding: '2px 12px 2px 0' }}>REP</th>
                <th style={{ padding: '2px 12px 2px 0', textAlign: 'right' }}>M/S</th>
                <th style={{ padding: '2px 12px 2px 0', textAlign: 'right' }}>CM</th>
                <th style={{ padding: '2px 0', textAlign: 'right' }}>VS BEST</th>
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
              {reps.map(r => {
                const best = loss?.bestMs ?? r.peakVelocityMs;
                const down = ((best - r.peakVelocityMs) / best) * 100;
                return (
                  <tr key={r.index}>
                    <td style={{ padding: '2px 12px 2px 0' }}>{r.index}</td>
                    <td style={{ padding: '2px 12px 2px 0', textAlign: 'right', fontWeight: 600 }}>{num(r.peakVelocityMs, 2)}</td>
                    <td style={{ padding: '2px 12px 2px 0', textAlign: 'right' }}>{num(r.riseCm, 0)}</td>
                    <td style={{ padding: '2px 0', textAlign: 'right', color: down >= cutoffPct ? 'var(--color-danger-text)' : 'var(--color-text-secondary)' }}>
                      {down < 0.5 ? '—' : `−${num(down, 0)} %`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <p style={{ margin: 0, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', maxWidth: '70ch' }}>
          Live numbers are for the decision between sets. They are not stored, not graded, and not
          corrected for the lens or the camera angle — a phone propped against a bottle is an
          everyday-tier measurement. Film the set as well and analyse it properly afterwards.
        </p>
      </div>
    </StandardPage>
  );
}
