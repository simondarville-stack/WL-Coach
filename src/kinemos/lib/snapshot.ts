/**
 * snapshot — a frame with its overlays, as a shareable JPEG.
 *
 * Redraws the overlays onto a fresh canvas rather than rasterising the live
 * SVG. Serialising an SVG that references CSS custom properties
 * (`var(--color-accent)`) into an image loses every one of them — the exported
 * path would come out black or invisible, which is exactly the sort of thing
 * nobody notices until a coach has sent one to an athlete.
 *
 * Overlay geometry is display-space pixels, the same coordinates everything
 * else in the viewer speaks, so this is a straight redraw at 1:1.
 */
import type { PlateEllipse } from '../engine/calibration';
import type { KinemosTrackPoint } from '../../lib/database.types';

export interface SnapshotInput {
  frame: CanvasImageSource;
  width: number;
  height: number;
  points: KinemosTrackPoint[];
  currentT: number | null;
  ellipse: PlateEllipse | null;
  /** Burned into the corner so a snapshot that leaves EMOS still says which
   *  frame of which clip it is. */
  caption?: string | null;
}

const ACCENT = '#185FA5';
const PLATE = '#F2C14E';

export async function composeSnapshot(input: SnapshotInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = input.width;
  canvas.height = input.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Snapshot failed — no 2D context.');

  ctx.drawImage(input.frame, 0, 0, input.width, input.height);

  // Scale strokes with the frame so a 4K clip does not get hairlines and a
  // 480p one does not get slabs.
  const unit = Math.max(1, input.height / 560);

  if (input.points.length > 1) {
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3 * unit;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    input.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const p of input.points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * unit, 0, Math.PI * 2);
    ctx.fill();
  }

  const current =
    input.currentT === null
      ? null
      : (input.points.find(p => Math.abs(p.t - input.currentT!) < 1e-6) ?? null);
  if (current) {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    ctx.arc(current.x, current.y, 8 * unit, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (input.ellipse) {
    ctx.save();
    ctx.translate(input.ellipse.cx, input.ellipse.cy);
    ctx.rotate((input.ellipse.tiltDeg * Math.PI) / 180);
    ctx.strokeStyle = PLATE;
    ctx.lineWidth = 2 * unit;
    ctx.setLineDash([6 * unit, 4 * unit]);
    ctx.beginPath();
    ctx.ellipse(0, 0, input.ellipse.semiMinorPx, input.ellipse.semiMajorPx, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (input.caption) {
    ctx.font = `${Math.round(12 * unit)}px system-ui, sans-serif`;
    const metrics = ctx.measureText(input.caption);
    const padding = 6 * unit;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(
      padding,
      input.height - padding - 20 * unit,
      metrics.width + padding * 2,
      20 * unit,
    );
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(input.caption, padding * 2, input.height - padding - 6 * unit);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Snapshot failed — could not encode.'))),
      'image/jpeg',
      0.9,
    );
  });
}
