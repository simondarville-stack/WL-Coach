/**
 * useUploadAnalysis — run KinEMOS on a clip the athlete just uploaded, on
 * the athlete's phone, behind the Today screen (P8 plan).
 *
 * The hook owns a queue and a line of text. `enqueue` is called after
 * `uploadLogVideo` has returned — the row exists, the strip's spinner has
 * cleared — with the same `File` that went up. Clips are analysed one at a
 * time (two decoders on one phone is how a tab is killed, P5 plan §5); a
 * second upload waits behind the first. Nothing here can reach the upload:
 * every step is inside a `try` that swallows, and the pipeline itself is a
 * dynamic `import()` made only once a clip is queued, so mediabunny, the
 * engine and OpenCV stay out of the athlete bundle until then.
 *
 * Leaving the screen unmounts the hook, which sets a flag the pipeline
 * reads on every frame (`shouldStop`) — the run ends with nothing stored.
 * Scrolling unmounts nothing. A queued clip lost to a reload is simply an
 * unanalysed clip, as it was before this existed; holding file bytes past
 * the page is the one thing a phone should not do.
 *
 * The gate (`canAnalyseOnDevice`) is read per clip, not once: a phone can
 * be unplugged between two uploads.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { canAnalyseOnDevice, readDeviceState, type DeviceState } from '../../../kinemos/lib/deviceGate';
import {
  ANALYSING_LINE,
  OUTCOME_LINE_MS,
  analyseOnUploadEnabled,
  describeUploadOutcome,
} from '../../../kinemos/lib/uploadAnalysis';
import type { AnalyseArrivalOptions, ArrivalOutcome, ArrivalTarget } from '../../../kinemos/lib/arrivals';

export interface UploadAnalysisJob {
  /** The bytes that were uploaded — trimmed by the editor if the athlete trimmed. */
  file: File;
  /** The `training_log_videos` row the reps are stored against. */
  videoId: string;
  /** The logged load, when there is one (`massForUpload`). */
  massKg: number | null;
}

export type UploadAnalyser = (target: ArrivalTarget, options: AnalyseArrivalOptions) => Promise<ArrivalOutcome>;

export interface UploadAnalysisDeps {
  /** Loads the pipeline. Default: a dynamic import of `lib/arrivals`. */
  loadAnalyser?: () => Promise<UploadAnalyser>;
  /** Reads the device. Default: `readDeviceState`. */
  readDevice?: () => Promise<DeviceState>;
  /** The preference. Default: `analyseOnUploadEnabled`. */
  enabled?: () => boolean;
}

export interface UploadAnalysis {
  enqueue: (job: UploadAnalysisJob) => void;
  /** What to show, or null for nothing. */
  line: string | null;
}

const defaultLoadAnalyser = async (): Promise<UploadAnalyser> => {
  const mod = await import('../../../kinemos/lib/arrivals');
  return mod.analyseArrival;
};

export function useUploadAnalysis(ownerId: string | null, deps: UploadAnalysisDeps = {}): UploadAnalysis {
  const [line, setLine] = useState<string | null>(null);
  const queue = useRef<UploadAnalysisJob[]>([]);
  const running = useRef(false);
  /** Set once, on unmount; read by the pipeline on every frame. */
  const cancelled = useRef(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs, not deps: the pump reads the latest values mid-run and the
  // callers must never be re-created because a dep object was.
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  const show = useCallback((text: string | null) => {
    if (cancelled.current) return;
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    setLine(text);
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length > 0 && !cancelled.current) {
        const job = queue.current.shift()!;
        try {
          const d = depsRef.current;
          const state = await (d.readDevice ?? readDeviceState)();
          if (cancelled.current) break;
          if (!canAnalyseOnDevice(state).ok) continue;
          show(ANALYSING_LINE);
          const analyse = await (d.loadAnalyser ?? defaultLoadAnalyser)();
          if (cancelled.current) break;
          const outcome = await analyse(
            {
              source: 'log',
              sourceId: job.videoId,
              label: 'Your lift',
              file: job.file,
              massKg: job.massKg,
              massSource: job.massKg == null ? null : 'logged',
            },
            { ownerId: ownerRef.current, shouldStop: () => cancelled.current },
          );
          if (cancelled.current) break;
          const text = describeUploadOutcome(outcome);
          show(text);
          if (text) {
            clearTimer.current = setTimeout(() => {
              clearTimer.current = null;
              if (!cancelled.current) setLine(null);
            }, OUTCOME_LINE_MS);
          }
        } catch {
          // Nothing the athlete can act on; the coach sees `—` in the library.
          show(null);
        }
      }
    } finally {
      running.current = false;
    }
  }, [show]);

  const enqueue = useCallback(
    (job: UploadAnalysisJob) => {
      try {
        if (!(depsRef.current.enabled ?? analyseOnUploadEnabled)()) return;
        queue.current.push(job);
        void pump();
      } catch {
        /* never into the upload */
      }
    },
    [pump],
  );

  return { enqueue, line };
}
