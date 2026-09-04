/**
 * opencv — the one place OpenCV.js is loaded from.
 *
 * P2 built the tracker without OpenCV, measured it, and was right to: for a
 * coach-anchored plate, normalised cross-correlation on a fixed template beats
 * every general-purpose tracker in the library (verify/tracker-bench.py). What
 * OpenCV earns its place for is the work AROUND the tracker — finding the
 * plate without a click, snapping a drawn outline to the plate's real edge at
 * sub-pixel, and undoing a handheld camera's motion — all of which need edge
 * detection, ellipse fitting and optical flow that would be a project each to
 * write and prove by hand.
 *
 * The cost is 13 MB of WASM-in-JS. So it is never in the initial bundle: this
 * module loads it on first use, once, through a dynamic import that Vite
 * splits into its own chunk, and everything in `src/kinemos/cv/*` goes through
 * `loadOpenCv()`. The engine (`src/kinemos/engine/*`) stays pure TypeScript
 * and never imports from here; the cv layer produces plain numbers the engine
 * already understands — a `PlateEllipse`, a list of points.
 */

/** The OpenCV.js namespace. Typed loosely at the boundary: the package's
 *  declarations lag the build (its README says so), and the handful of calls
 *  this layer makes are each checked at runtime in `loadOpenCv`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any;

let loading: Promise<CV> | null = null;

/** Functions this layer relies on. Checked once, so a build that lacks one
 *  fails loudly at load rather than mysteriously mid-lift. */
const REQUIRED = [
  'Mat',
  'matFromArray',
  'GaussianBlur',
  'HoughCircles',
  'Canny',
  'fitEllipse',
  'cornerMinEigenVal',
  'calcOpticalFlowPyrLK',
] as const;

/**
 * Load OpenCV.js, once. Resolves to the namespace with the runtime ready.
 *
 * Works in both places the cv layer runs: the browser (Vite chunk) and vitest
 * under Node (the package's own Emscripten loader). The package exposes either
 * a thenable module or one that signals `onRuntimeInitialized`; both are
 * handled, as its README prescribes.
 */
/**
 * The raw module object, before the runtime is awaited.
 *
 * Two routes, because the package is CommonJS and its export is a thenable:
 * under Node (vitest) an ESM `import()` of it fails — the interop exposes
 * `then` on the module namespace and the promise machinery trips over it — so
 * `require` is used there; in the browser Vite pre-bundles it and the
 * thenable arrives as the default export. The Node specifier is kept out of
 * the browser bundle with a variable and `@vite-ignore`.
 */
async function importModule(): Promise<CV> {
  // jsdom gives vitest a `window`, so the runtime is the tell, not the DOM.
  const isNode = typeof process !== 'undefined' && !!process.versions?.node;
  if (isNode) {
    const nodeModule = 'node:module';
    const { createRequire } = (await import(/* @vite-ignore */ nodeModule)) as {
      createRequire: (url: string) => (id: string) => CV;
    };
    return createRequire(import.meta.url)('@techstark/opencv-js');
  }
  const ns = (await import('@techstark/opencv-js')) as { default?: CV } & CV;
  return ns.default ?? ns;
}

export function loadOpenCv(): Promise<CV> {
  if (!loading) {
    loading = (async () => {
      const mod: CV = await importModule();
      let cv: CV;
      if (mod && mod.Mat) {
        cv = mod;
      } else if (mod && typeof mod.then === 'function') {
        // Emscripten's MODULARIZE build: a thenable that resolves once the
        // WASM runtime is up.
        cv = await mod;
      } else if (mod && typeof mod === 'object') {
        await new Promise<void>(resolve => {
          if (mod.Mat) resolve();
          else mod.onRuntimeInitialized = () => resolve();
        });
        cv = mod;
      } else {
        throw new Error('OpenCV.js module has no runtime');
      }
      const missing = REQUIRED.filter(name => typeof cv[name] !== 'function' && typeof cv[name] !== 'object');
      if (missing.length > 0) {
        throw new Error(`OpenCV.js build lacks: ${missing.join(', ')}`);
      }
      return cv;
    })().catch(err => {
      // A failed load must not poison every later call.
      loading = null;
      throw err;
    });
  }
  return loading;
}

/** Whether OpenCV has already been loaded — for a surface that wants to say
 *  "this will take a moment the first time" honestly. */
export function isOpenCvLoaded(): boolean {
  return loading !== null;
}

/** A greyscale image as the engine passes it around (see engine/tracker.ts). */
export interface GrayLike {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * A `GrayLike` as an 8-bit single-channel Mat. The caller owns it — every Mat
 * here is created and deleted by hand, because OpenCV.js allocates in WASM
 * memory the garbage collector cannot see.
 */
export function matFromGray(cv: CV, gray: GrayLike): CV {
  const bytes = new Uint8Array(gray.width * gray.height);
  const d = gray.data;
  // The tracker's grey is 0–255 already (grayFromRgba); an image built some
  // other way may not be, so clamp rather than assume.
  for (let i = 0; i < bytes.length; i++) {
    const v = d[i];
    bytes[i] = v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
  }
  return cv.matFromArray(gray.height, gray.width, cv.CV_8UC1, bytes);
}
