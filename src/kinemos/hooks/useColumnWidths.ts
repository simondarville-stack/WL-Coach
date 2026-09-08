/**
 * useColumnWidths — how wide the viewer's clip and bar-path columns are.
 *
 * The wireframe's widths (392 px for a portrait clip, 600 for a landscape
 * one, 322 for the bar path) are the defaults; a drag on a column splitter
 * overrides them and the override is remembered in localStorage, separately
 * for portrait and landscape clips, since the two want different numbers. A
 * reset clears the override rather than storing the default, so a later
 * change to the default reaches a coach who never dragged.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface ColumnWidths {
  video: number;
  path: number;
  /** Whether either column has been dragged off its default. */
  custom: boolean;
  setVideo: (width: number) => void;
  setPath: (width: number) => void;
  resetVideo: () => void;
  resetPath: () => void;
}

/** What a column may be dragged to. The floors keep the transport's buttons
 *  and the plot's tick labels legible; the ceilings keep the rail on screen. */
export const VIDEO_WIDTH_RANGE = { min: 280, max: 960 } as const;
export const PATH_WIDTH_RANGE = { min: 220, max: 640 } as const;
export const DEFAULT_PATH_WIDTH = 322;

const STORAGE_PREFIX = 'kinemos.viewer.columns.';

interface Stored {
  video?: number;
  path?: number;
}

function read(key: string): Stored {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Stored = {};
    const v = (parsed as Stored).video;
    const p = (parsed as Stored).path;
    if (typeof v === 'number' && Number.isFinite(v)) out.video = v;
    if (typeof p === 'number' && Number.isFinite(p)) out.path = p;
    return out;
  } catch {
    return {};
  }
}

function write(key: string, value: Stored): void {
  try {
    if (value.video === undefined && value.path === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or denied: the widths still hold for this screen.
  }
}

const clamp = (value: number, range: { min: number; max: number }) =>
  Math.round(Math.min(range.max, Math.max(range.min, value)));

export function useColumnWidths(portrait: boolean, defaultVideo: number): ColumnWidths {
  const key = `${STORAGE_PREFIX}${portrait ? 'portrait' : 'landscape'}`;
  const [stored, setStored] = useState<Stored>(() => read(key));

  // A clip of the other orientation opens on the same screen: switch sets.
  useEffect(() => {
    setStored(read(key));
  }, [key]);

  const update = useCallback(
    (patch: Stored | ((current: Stored) => Stored)) => {
      setStored(current => {
        const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
        write(key, next);
        return next;
      });
    },
    [key],
  );

  const setVideo = useCallback((width: number) => update({ video: clamp(width, VIDEO_WIDTH_RANGE) }), [update]);
  const setPath = useCallback((width: number) => update({ path: clamp(width, PATH_WIDTH_RANGE) }), [update]);
  const resetVideo = useCallback(() => update(current => ({ path: current.path })), [update]);
  const resetPath = useCallback(() => update(current => ({ video: current.video })), [update]);

  return useMemo(
    () => ({
      video: stored.video !== undefined ? clamp(stored.video, VIDEO_WIDTH_RANGE) : defaultVideo,
      path: stored.path !== undefined ? clamp(stored.path, PATH_WIDTH_RANGE) : DEFAULT_PATH_WIDTH,
      custom: stored.video !== undefined || stored.path !== undefined,
      setVideo,
      setPath,
      resetVideo,
      resetPath,
    }),
    [stored, defaultVideo, setVideo, setPath, resetVideo, resetPath],
  );
}
