/**
 * useViewerPanels — which of the viewer's rail panels are open.
 *
 * The rail is progressive disclosure by panel (docs/KINEMOS_VIEWER_LAYOUT.md):
 * the screen opens simple and the coach opens depth as they need it, and a
 * collapsed panel still carries its headline value. Three named depths set
 * every panel at once; the moment a coach toggles one panel by hand the
 * composition is theirs and no preset is "selected" any more — a preset is a
 * layout, not a mode, and a hand-composed screen is not one of the three.
 *
 * The composition is remembered per athlete, in localStorage: a coach reads
 * one lifter's tracking every session and another's history, and the screen
 * should come back the way they left it. Server-side preferences are the
 * production home for this; the key is namespaced so the move is a find.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

export type PanelKey = 'lift' | 'velocity' | 'metrics' | 'tracking' | 'calibration' | 'history' | 'notes';

export type ViewerDepth = 'look' | 'read' | 'work';

/** Every panel, in the order the rail draws them. */
export const PANEL_KEYS: readonly PanelKey[] = [
  'lift',
  'velocity',
  'metrics',
  'tracking',
  'calibration',
  'history',
  'notes',
];

export type PanelOpenState = Record<PanelKey, boolean>;

/**
 * What each depth opens. COACH-CONFIG candidate: the three names and their
 * contents are the wireframe's, and a club may want a fourth ("Correct":
 * tracking and calibration only) once the layout settles.
 */
export const DEPTH_PRESETS: Record<ViewerDepth, PanelOpenState> = {
  look: {
    lift: true,
    velocity: false,
    metrics: false,
    tracking: false,
    calibration: false,
    history: false,
    notes: false,
  },
  read: {
    lift: true,
    velocity: true,
    metrics: true,
    tracking: false,
    calibration: false,
    history: true,
    notes: false,
  },
  work: {
    lift: true,
    velocity: true,
    metrics: true,
    tracking: true,
    calibration: true,
    history: true,
    notes: true,
  },
};

export const DEPTH_LABELS: Record<ViewerDepth, string> = { look: 'Look', read: 'Read', work: 'Work' };

/** What a fresh screen opens with: the lift and its velocity curve. */
export const DEFAULT_OPEN: PanelOpenState = {
  lift: true,
  velocity: true,
  metrics: false,
  tracking: false,
  calibration: false,
  history: false,
  notes: false,
};

const STORAGE_PREFIX = 'kinemos.viewer.panels.';

function storageKey(athleteId: string | null): string {
  return `${STORAGE_PREFIX}${athleteId ?? 'no-athlete'}`;
}

/** The depth whose preset this composition is, if it is one of them. */
export function depthOf(open: PanelOpenState): ViewerDepth | null {
  for (const depth of Object.keys(DEPTH_PRESETS) as ViewerDepth[]) {
    const preset = DEPTH_PRESETS[depth];
    if (PANEL_KEYS.every(k => preset[k] === open[k])) return depth;
  }
  return null;
}

function readStored(athleteId: string | null): PanelOpenState | null {
  try {
    const raw = localStorage.getItem(storageKey(athleteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    // Strict about shape: a key added later reads as its default rather than
    // as `undefined`, which would render a panel neither open nor closed.
    const next = { ...DEFAULT_OPEN };
    for (const k of PANEL_KEYS) if (typeof record[k] === 'boolean') next[k] = record[k] as boolean;
    return next;
  } catch {
    return null;
  }
}

function writeStored(athleteId: string | null, open: PanelOpenState): void {
  try {
    localStorage.setItem(storageKey(athleteId), JSON.stringify(open));
  } catch {
    // Storage full or unavailable: the composition still holds for this tab.
  }
}

export interface ViewerPanels {
  open: PanelOpenState;
  /** The preset in force, or null once the coach has composed by hand. */
  depth: ViewerDepth | null;
  openCount: number;
  toggle: (key: PanelKey) => void;
  /** Open a panel without closing anything — for a jump from elsewhere on
   *  the screen (the header's Share button, a flagged frame). */
  show: (key: PanelKey) => void;
  setDepth: (depth: ViewerDepth) => void;
}

export function useViewerPanels(athleteId: string | null): ViewerPanels {
  const [open, setOpen] = useState<PanelOpenState>(() => readStored(athleteId) ?? DEFAULT_OPEN);

  // The clip — and so the athlete — arrives after the first render. Re-read
  // the composition when it does, so it is the athlete's, not the default's.
  useEffect(() => {
    const stored = readStored(athleteId);
    if (stored) setOpen(stored);
  }, [athleteId]);

  const update = useCallback(
    (next: (current: PanelOpenState) => PanelOpenState) => {
      setOpen(current => {
        const value = next(current);
        writeStored(athleteId, value);
        return value;
      });
    },
    [athleteId],
  );

  const toggle = useCallback((key: PanelKey) => update(current => ({ ...current, [key]: !current[key] })), [update]);
  const show = useCallback(
    (key: PanelKey) => update(current => (current[key] ? current : { ...current, [key]: true })),
    [update],
  );
  const setDepth = useCallback((depth: ViewerDepth) => update(() => ({ ...DEPTH_PRESETS[depth] })), [update]);

  // Derived, not stored: the depth is whatever the composition happens to
  // equal, so a coach who hand-opens their way back to "Read" sees Read lit.
  const depth = useMemo(() => depthOf(open), [open]);
  const openCount = useMemo(() => PANEL_KEYS.filter(k => open[k]).length, [open]);

  return { open, depth, openCount, toggle, show, setDepth };
}
