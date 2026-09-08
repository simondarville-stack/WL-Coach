/**
 * useDisplayPrefs — the coach's drawing preferences for the viewer, kept in
 * the browser.
 *
 * One key for the coach, not one per athlete: how thick a line is drawn is a
 * matter of the coach's eyes and screen, not of whose lift it is (the rail
 * composition, by contrast, IS per athlete — `useViewerPanels`). Read once on
 * mount, written through on every change, tolerant of anything older builds
 * or hand edits left behind (`lib/displayPrefs.parseDisplayPrefs`). Server-
 * side preferences are the production home for this; the key is namespaced
 * so the move is a find.
 */
import { useCallback, useState } from 'react';
import {
  DEFAULT_DISPLAY_PREFS,
  parseDisplayPrefs,
  type DisplayPrefs,
  type PlotLabels,
  type PlotPrefs,
  type StagePrefs,
} from '../lib/displayPrefs';

export const DISPLAY_PREFS_KEY = 'kinemos.viewer.display';

function readStored(): DisplayPrefs {
  try {
    const raw = window.localStorage.getItem(DISPLAY_PREFS_KEY);
    return raw ? parseDisplayPrefs(JSON.parse(raw)) : DEFAULT_DISPLAY_PREFS;
  } catch {
    return DEFAULT_DISPLAY_PREFS;
  }
}

function writeStored(prefs: DisplayPrefs): void {
  try {
    window.localStorage.setItem(DISPLAY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Quota or a denied store: the preference still holds for this tab.
  }
}

export interface DisplayPrefsApi {
  prefs: DisplayPrefs;
  setStage: (patch: Partial<StagePrefs>) => void;
  setPlot: (patch: Partial<PlotPrefs>) => void;
  setLabels: (patch: Partial<PlotLabels>) => void;
  /** Back to the defaults, for one surface or both. */
  reset: (which?: 'stage' | 'plot') => void;
}

export function useDisplayPrefs(): DisplayPrefsApi {
  const [prefs, setPrefs] = useState<DisplayPrefs>(readStored);

  const update = useCallback((fn: (current: DisplayPrefs) => DisplayPrefs) => {
    setPrefs(current => {
      const next = fn(current);
      writeStored(next);
      return next;
    });
  }, []);

  const setStage = useCallback(
    (patch: Partial<StagePrefs>) => update(c => ({ ...c, stage: { ...c.stage, ...patch } })),
    [update],
  );
  const setPlot = useCallback(
    (patch: Partial<PlotPrefs>) => update(c => ({ ...c, plot: { ...c.plot, ...patch } })),
    [update],
  );
  const setLabels = useCallback(
    (patch: Partial<PlotLabels>) =>
      update(c => ({ ...c, plot: { ...c.plot, labels: { ...c.plot.labels, ...patch } } })),
    [update],
  );
  const reset = useCallback(
    (which?: 'stage' | 'plot') =>
      update(c => ({
        stage: which === 'plot' ? c.stage : DEFAULT_DISPLAY_PREFS.stage,
        plot: which === 'stage' ? c.plot : DEFAULT_DISPLAY_PREFS.plot,
      })),
    [update],
  );

  return { prefs, setStage, setPlot, setLabels, reset };
}
