/**
 * Clip-edit geometry probe.
 *
 * Synthesises a phone-style clip — landscape-coded pixels with a rotation
 * flag in the container, exactly what a phone held upright produces — pushes
 * it through `applyClipEdit` with the edits an athlete can make, and measures
 * what comes out: the declared size, and the shape of a circle drawn in the
 * source. A circle that comes back as an ellipse is a stretched clip.
 *
 * Each output is also run through `checkEditedClip`, the gate the editor
 * applies before upload, and a deliberately squeezed file — the whole frame
 * forced into the crop's box, the failure once uploaded — is fed to the same
 * gate to show it refuses one. Both renderers are exercised.
 *
 * Open under `npm run dev` at /verify/clip-edit-probe.html; the Playwright
 * driver (`verify/shoot-clip-edit-probe.mjs`) reads `window.__probe`.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
} from 'mediabunny';
import { applyClipEdit, outputDimensions, type ClipEdit } from '../src/lib/videoClipEdit';
import { checkEditedClip, type ClipGeometryVerdict } from '../src/lib/clipGeometryCheck';

declare global {
  interface Window {
    __probe?: unknown;
  }
}

const logEl = document.getElementById('log')!;
function log(line: string) {
  logEl.textContent += line + '\n';
  console.log(line);
}

// Chromium builds without proprietary codecs can encode H.264 (OpenH264) but
// not decode it, which would leave the output unmeasurable. Steer mediabunny
// to a codec this browser can also play back. Geometry is codec-independent.
const realSupported = VideoEncoder.isConfigSupported.bind(VideoEncoder);
VideoEncoder.isConfigSupported = async (config: VideoEncoderConfig) => {
  if (/^(avc|hvc|hev)/.test(config.codec)) return { supported: false, config };
  return realSupported(config);
};

type Rotation = 0 | 90 | 180 | 270;

/** Draw the display-space scene: portrait W×H, circle in the middle, coloured
 *  corners so which region survived a crop can be read off. */
function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, W, H);
  const s = Math.round(Math.min(W, H) * 0.18);
  ctx.fillStyle = '#2040ff'; ctx.fillRect(0, 0, s, s); // TL blue
  ctx.fillStyle = '#20c040'; ctx.fillRect(W - s, 0, s, s); // TR green
  ctx.fillStyle = '#f0e020'; ctx.fillRect(0, H - s, s, s); // BL yellow
  ctx.fillStyle = '#e020e0'; ctx.fillRect(W - s, H - s, s, s); // BR magenta
  // A little motion so the encoder has something to do.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round((W - 40) * t), Math.round(H * 0.85), 40, 20);
  ctx.fillStyle = '#e02020';
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

/** Make an MP4 whose coded frame is codedW×codedH and whose container says
 *  "rotate by `rotation`" — the scene is drawn so it is upright after that. */
async function makeSource(codedW: number, codedH: number, rotation: Rotation, seconds = 2): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = codedW;
  canvas.height = codedH;
  const ctx = canvas.getContext('2d')!;
  const [dispW, dispH] = rotation % 180 === 0 ? [codedW, codedH] : [codedH, codedW];

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec: 'vp9', bitrate: QUALITY_MEDIUM });
  output.addVideoTrack(source, { rotation, frameRate: 30 });
  await output.start();
  const fps = 30;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Undo the container rotation: draw the display scene rotated the other
    // way, so applying `rotation` clockwise on playback shows it upright.
    if (rotation === 90) {
      ctx.translate(0, codedH);
      ctx.rotate(-Math.PI / 2);
    } else if (rotation === 270) {
      ctx.translate(codedW, 0);
      ctx.rotate(Math.PI / 2);
    } else if (rotation === 180) {
      ctx.translate(codedW, codedH);
      ctx.rotate(Math.PI);
    }
    drawScene(ctx, dispW, dispH, i / (n - 1));
    ctx.restore();
    await source.add(i / fps, 1 / fps);
  }
  source.close();
  await output.finalize();
  const buf = output.target.buffer!;
  return new File([buf], `src-${codedW}x${codedH}-r${rotation}.mp4`, { type: 'video/mp4' });
}

/**
 * The failure as uploaded: the crop's box, the whole frame squeezed into it.
 * Built by asking mediabunny for the crop's *size* with `fill` and no crop —
 * a stand-in for whatever the device did, with the same visible result.
 */
async function makeSqueezed(file: File, edit: ClipEdit): Promise<File> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video track');
  const out = outputDimensions(edit, track.displayWidth, track.displayHeight);
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: edit.start, end: edit.end },
    video: { width: out.width, height: out.height, fit: 'fill' },
    showWarnings: false,
  });
  await conversion.execute();
  return new File([output.target.buffer!], 'squeezed.mp4', { type: 'video/mp4' });
}

interface Measure {
  name: string;
  bytes: number;
  /** What the browser reports — this is what the ScrubPlayer lays out on. */
  videoWidth: number;
  videoHeight: number;
  /** Container / codec view via mediabunny. */
  coded: string;
  rotation: number;
  display: string;
  squarePixel: string;
  /** Circle bounding box in browser pixels; ratio 1,00 means round. */
  circle: { w: number; h: number; ratio: number } | null;
  corners: string;
  /** The editor's pre-upload gate, run on this output. */
  verdict?: ClipGeometryVerdict;
  error?: string;
}

function colourName(r: number, g: number, b: number): string {
  if (r > 160 && g < 90 && b < 90) return 'red';
  if (b > 160 && r < 90 && g < 120) return 'blue';
  if (g > 140 && r < 90 && b < 120) return 'green';
  if (r > 180 && g > 180 && b < 90) return 'yellow';
  if (r > 160 && b > 160 && g < 90) return 'magenta';
  if (r > 200 && g > 200 && b > 200) return 'white';
  if (Math.abs(r - 128) < 40 && Math.abs(g - 128) < 40 && Math.abs(b - 128) < 40) return 'grey';
  return `rgb(${r},${g},${b})`;
}

async function measure(name: string, file: File): Promise<Measure> {
  const m: Measure = {
    name, bytes: file.size, videoWidth: 0, videoHeight: 0, coded: '?', rotation: -1,
    display: '?', squarePixel: '?', circle: null, corners: '?',
  };
  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (track) {
      m.coded = `${await track.getCodedWidth()}×${await track.getCodedHeight()}`;
      m.rotation = await track.getRotation();
      m.display = `${await track.getDisplayWidth()}×${await track.getDisplayHeight()}`;
      m.squarePixel = `${await track.getSquarePixelWidth()}×${await track.getSquarePixelHeight()}`;
    }
  } catch (e) {
    m.error = `probe: ${(e as Error).message}`;
  }
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise<void>((res, rej) => {
      video.onloadeddata = () => res();
      video.onerror = () => rej(new Error('video element could not decode'));
      setTimeout(() => rej(new Error('metadata timeout')), 10000);
    });
    m.videoWidth = video.videoWidth;
    m.videoHeight = video.videoHeight;
    await new Promise<void>(res => {
      video.onseeked = () => res();
      video.currentTime = Math.min(0.4, video.duration / 2);
    });
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, c.width, c.height);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        if (data[i] > 160 && data[i + 1] < 90 && data[i + 2] < 90) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= 0) {
      const w = maxX - minX + 2, h = maxY - minY + 2;
      m.circle = { w, h, ratio: Math.round((w / h) * 1000) / 1000 };
    }
    const px = (fx: number, fy: number) => {
      const i = (Math.round(fy * (c.height - 1)) * c.width + Math.round(fx * (c.width - 1))) * 4;
      return colourName(data[i], data[i + 1], data[i + 2]);
    };
    m.corners = `TL=${px(0.04, 0.04)} TR=${px(0.96, 0.04)} BL=${px(0.04, 0.96)} BR=${px(0.96, 0.96)}`;
  } catch (e) {
    m.error = (m.error ? m.error + '; ' : '') + (e as Error).message;
  } finally {
    URL.revokeObjectURL(url);
  }
  return m;
}

const EDITS: { label: string; edit: ClipEdit }[] = [
  { label: 'trim only (head cut → transcode)', edit: { start: 0.5, end: 1.5, crop: null, maxEdge: null } },
  { label: 'crop full width × 70% height', edit: { start: 0, end: 2, crop: { x: 0, y: 0.15, w: 1, h: 0.7 }, maxEdge: null } },
  { label: 'crop 80% box + 1080p cap', edit: { start: 0, end: 2, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, maxEdge: 1920 } },
  { label: '720p cap only', edit: { start: 0, end: 2, crop: null, maxEdge: 1280 } },
];

const SOURCES: { label: string; codedW: number; codedH: number; rotation: Rotation }[] = [
  { label: 'phone upright (coded 1920×1080, rotate 90)', codedW: 1920, codedH: 1080, rotation: 90 },
  { label: 'phone upright other way (rotate 270)', codedW: 1920, codedH: 1080, rotation: 270 },
  { label: 'control: pixels already portrait (rotate 0)', codedW: 1080, codedH: 1920, rotation: 0 },
];

const RENDERERS = ['default', 'conservative'] as const;

function failed(name: string, e: unknown): Measure {
  return {
    name, bytes: 0, videoWidth: 0, videoHeight: 0, coded: '?', rotation: -1,
    display: '?', squarePixel: '?', circle: null, corners: '?', error: (e as Error).message,
  };
}

async function main() {
  const results: { source: string; measures: Measure[] }[] = [];
  for (const s of SOURCES) {
    log(`\n=== ${s.label} ===`);
    const file = await makeSource(s.codedW, s.codedH, s.rotation);
    const measures: Measure[] = [await measure('SOURCE', file)];
    log(JSON.stringify(measures[0]));
    for (const renderer of RENDERERS) {
      for (const { label, edit } of EDITS) {
        const name = `${renderer.padEnd(12)} ${label}`;
        try {
          const out = await applyClipEdit(file, edit, { renderer });
          const m = await measure(name, out);
          m.verdict = await checkEditedClip(file, out, edit);
          measures.push(m);
          log(JSON.stringify(m));
        } catch (e) {
          const m = failed(name, e);
          measures.push(m);
          log(JSON.stringify(m));
        }
      }
    }
    // The gate must refuse the failure it exists for.
    const cropEdit = EDITS[1].edit;
    try {
      const bad = await makeSqueezed(file, cropEdit);
      const m = await measure('SQUEEZED (must be refused)', bad);
      m.verdict = await checkEditedClip(file, bad, cropEdit);
      measures.push(m);
      log(JSON.stringify(m));
    } catch (e) {
      measures.push(failed('SQUEEZED (must be refused)', e));
    }
    results.push({ source: s.label, measures });
  }
  window.__probe = results;
  log('\nDONE');
}

void main().catch(e => {
  log('FATAL ' + (e as Error).stack);
  window.__probe = { fatal: String(e) };
});
