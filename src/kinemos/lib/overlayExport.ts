/**
 * overlayExport — the clip with the bar path burned in, as a video file.
 *
 * Design §9's third sharing target: "export (mp4 with burned-in overlay for
 * external use — seminars, socials)". Every frame of the tracked range is
 * drawn onto a canvas — the picture, the path as far as the bar has got, a
 * ring on the bar end, a caption, and a live readout when the caller gives
 * one — and handed to mediabunny's `CanvasSource`, which encodes through
 * WebCodecs and muxes. Timestamps and durations are the clip's own, frame by
 * frame, so a variable-frame-rate phone clip comes out at its real timing
 * rather than a nominal rate (design §6.3, the rule everything else here
 * follows).
 *
 * Codec: H.264 in MP4 when this browser can encode it, since that is what
 * plays everywhere the file is going; VP9 (then VP8) in WebM otherwise —
 * headless Chromium, for one, has no H.264 encoder. The caller gets told
 * which it was.
 *
 * The plate outline is NOT drawn: it is a calibration artefact, not part of
 * the lift, and the export is for people who do not need to know how the
 * numbers were made.
 */
import type { FrameServer } from '../engine/frameServer';
import type { KinemosTrackPoint } from '../../lib/database.types';

export interface OverlayExportInput {
  server: FrameServer;
  points: KinemosTrackPoint[];
  /** Bottom-left, on every frame: who, what, when. */
  caption?: string | null;
  /** Top-right, per frame: the number to show at that moment — the bar's
   *  velocity, say. Null for nothing. */
  readout?: ((t: number) => string | null) | null;
  /** Seconds of clip to keep either side of the track. */
  marginS?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface OverlayExportResult {
  blob: Blob;
  codec: 'avc' | 'vp9' | 'vp8';
  extension: 'mp4' | 'webm';
  frames: number;
  durationS: number;
}

const ACCENT = '#185FA5';

export async function exportOverlayVideo(input: OverlayExportInput): Promise<OverlayExportResult> {
  const { server, points } = input;
  if (points.length < 2) throw new Error('Nothing to export — the bar has not been tracked.');
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const margin = input.marginS ?? 0.5;
  const from = server.nearestIndex(sorted[0].t - margin);
  const to = server.nearestIndex(sorted[sorted.length - 1].t + margin);
  const total = to - from + 1;
  const width = server.displayWidth;
  const height = server.displayHeight;

  const {
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    WebMOutputFormat,
    getFirstEncodableVideoCodec,
  } = await import('mediabunny');

  const codec = (await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width, height })) as
    | 'avc'
    | 'vp9'
    | 'vp8'
    | null;
  if (!codec) throw new Error('This browser cannot encode video — the export needs WebCodecs with an H.264 or VP9 encoder.');
  const mp4 = codec === 'avc';
  const format = mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Export failed — no 2D context.');

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, {
    codec,
    quality: QUALITY_HIGH,
    // A key frame every second: the file scrubs well and stays small.
    keyFrameInterval: 1,
  });
  output.addVideoTrack(source, { frameRate: server.averageFps });
  await output.start();

  const unit = Math.max(1, height / 560);
  const t0 = server.timestamps[from];
  let frames = 0;
  for (let index = from; index <= to; index++) {
    const frame = await server.frameAt(index);
    const t = server.timestamps[index];
    const next = index + 1 < server.timestamps.length ? server.timestamps[index + 1] : t + 1 / Math.max(1, server.averageFps);
    ctx.drawImage(frame.canvas as CanvasImageSource, 0, 0, width, height);
    drawOverlay(ctx, sorted, t, unit, width, height, input.caption ?? null, input.readout?.(t) ?? null);
    await source.add(t - t0, Math.max(1e-3, next - t));
    frames++;
    input.onProgress?.(frames, total);
  }
  source.close();
  await output.finalize();
  const buffer = target.buffer;
  if (!buffer) throw new Error('Export failed — nothing was written.');
  const durationS = server.timestamps[to] - t0;
  return {
    blob: new Blob([buffer], { type: mp4 ? 'video/mp4' : 'video/webm' }),
    codec,
    extension: mp4 ? 'mp4' : 'webm',
    frames,
    durationS,
  };
}

/** The path as far as the bar has got at `t`, a ring on where it is, the
 *  caption and the readout. Pure drawing; the same look as a snapshot. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  sorted: readonly KinemosTrackPoint[],
  t: number,
  unit: number,
  width: number,
  height: number,
  caption: string | null,
  readout: string | null,
): void {
  // The samples up to now, plus the bar's position at t itself, between
  // two samples when t falls between them.
  let upto = 0;
  while (upto < sorted.length && sorted[upto].t <= t + 1e-6) upto++;
  const here = positionAt(sorted, t);
  if (upto > 1 || (upto > 0 && here)) {
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3 * unit;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < upto; i++) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, sorted[i].x, sorted[i].y);
    if (here && upto > 0) ctx.lineTo(here.x, here.y);
    ctx.stroke();
  }
  if (here) {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    ctx.arc(here.x, here.y, 8 * unit, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.font = `${Math.round(12 * unit)}px system-ui, sans-serif`;
  const padding = 6 * unit;
  if (caption) {
    const metrics = ctx.measureText(caption);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(padding, height - padding - 20 * unit, metrics.width + padding * 2, 20 * unit);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(caption, padding * 2, height - padding - 6 * unit);
  }
  if (readout) {
    ctx.font = `600 ${Math.round(14 * unit)}px system-ui, sans-serif`;
    const metrics = ctx.measureText(readout);
    const w = metrics.width + padding * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(width - padding - w, padding, w, 22 * unit);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(readout, width - padding - w + padding, padding + 16 * unit);
  }
}

/** Where the bar is at `t`: on a sample, between two, or nowhere (before the
 *  first or after the last). */
export function positionAt(sorted: readonly KinemosTrackPoint[], t: number): { x: number; y: number } | null {
  if (sorted.length === 0 || t < sorted[0].t - 1e-6 || t > sorted[sorted.length - 1].t + 1e-6) return null;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].t >= t) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const span = b.t - a.t;
      const f = span > 0 ? (t - a.t) / span : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  const last = sorted[sorted.length - 1];
  return { x: last.x, y: last.y };
}
