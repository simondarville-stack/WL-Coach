/**
 * talkover — the coach talking through a lift, recorded.
 *
 * Design §9: "record microphone + screen (viewer canvas) while scrubbing —
 * MediaRecorder-based — producing a share-ready clip of the coach talking
 * through the lift. Stored audio is fine; no speech-to-text requirement."
 *
 * The picture is not the screen: it is a canvas of its own that mirrors what
 * the stage shows — the frame under the playhead and the bar path as far as
 * the bar has got — redrawn every animation frame while the coach scrubs,
 * steps and talks. That keeps the recording the size of the clip, free of
 * chrome, and identical to what a snapshot or an export draws. The
 * microphone rides along when the browser grants it; refused, the talkover
 * is silent video and the caller is told, rather than failing.
 *
 * What the browser's MediaRecorder writes is what is stored: WebM (VP8 or
 * VP9 with Opus) from Chrome and Firefox, MP4 from Safari. No transcoding
 * — a talkover is watched by the athlete on a phone in the same family of
 * browsers, and the file names its own type.
 */
import type { KinemosTrackPoint } from '../../lib/database.types';
import { drawOverlay } from './overlayExport';

export interface TalkoverSource {
  width: number;
  height: number;
  /** The frame under the playhead, as the stage has it right now. */
  getFrame(): CanvasImageSource | null;
  /** The playhead, s. */
  getT(): number | null;
  getPoints(): readonly KinemosTrackPoint[];
  caption: string | null;
}

export interface TalkoverRecording {
  blob: Blob;
  mimeType: string;
  durationS: number;
  withAudio: boolean;
}

export interface TalkoverController {
  /** Whether the microphone is in the recording. */
  readonly withAudio: boolean;
  /** performance.now() at the first recorded frame. */
  readonly startedAt: number;
  stop(): Promise<TalkoverRecording>;
}

/** The container/codec pairs asked of MediaRecorder, best first. */
const MIME_PREFERENCE = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

export function talkoverMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_PREFERENCE.find(m => MediaRecorder.isTypeSupported(m)) ?? null;
}

/**
 * Start recording. Resolves once the recorder is running; the coach then
 * scrubs and talks, and `stop()` hands back the file.
 */
export async function startTalkover(
  source: TalkoverSource,
  options: { fps?: number; audio?: boolean } = {},
): Promise<TalkoverController> {
  const mimeType = talkoverMimeType();
  if (!mimeType) throw new Error('This browser cannot record — MediaRecorder is missing.');
  const fps = options.fps ?? 30;

  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Recording failed — no 2D context.');
  const unit = Math.max(1, source.height / 560);

  // The microphone, when granted. A refusal is a silent talkover, not an
  // error: the picture of the lift with the coach's cursor on it is still
  // worth having.
  let mic: MediaStream | null = null;
  if (options.audio !== false && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      mic = null;
    }
  }

  const videoStream = canvas.captureStream(fps);
  const stream = new MediaStream([...videoStream.getVideoTracks(), ...(mic ? mic.getAudioTracks() : [])]);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let raf = 0;
  let last: CanvasImageSource | null = null;
  const paint = () => {
    const frame = source.getFrame() ?? last;
    if (frame) {
      last = frame;
      ctx.drawImage(frame, 0, 0, source.width, source.height);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, source.width, source.height);
    }
    const t = source.getT();
    const sorted = [...source.getPoints()].sort((a, b) => a.t - b.t);
    if (t !== null) drawOverlay(ctx, sorted, t, unit, source.width, source.height, source.caption, null);
    raf = requestAnimationFrame(paint);
  };
  paint();

  recorder.start(1000);
  const startedAt = performance.now();

  return {
    withAudio: mic !== null,
    startedAt,
    stop: () =>
      new Promise<TalkoverRecording>((resolve, reject) => {
        recorder.onstop = () => {
          cancelAnimationFrame(raf);
          for (const track of stream.getTracks()) track.stop();
          mic?.getTracks().forEach(track => track.stop());
          const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
          resolve({
            blob,
            mimeType,
            durationS: (performance.now() - startedAt) / 1000,
            withAudio: mic !== null,
          });
        };
        recorder.onerror = () => reject(new Error('The recording failed.'));
        if (recorder.state === 'inactive') recorder.onstop(new Event('stop'));
        else recorder.stop();
      }),
  };
}

/** "0:42" — how a talkover's length reads in a list. */
export function formatTalkoverLength(durationS: number): string {
  const s = Math.max(0, Math.round(durationS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
