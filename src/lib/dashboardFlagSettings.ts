// Coach-configurable settings that drive the v2 dashboard's attention flags.
//
// Persisted in localStorage so we don't need a Supabase migration to ship the
// configurability story. If a richer multi-device sync is wanted later, swap
// the load/save to write a JSON column on general_settings — the consumer
// shape (DashboardFlagSettings) does not have to change.

import { useEffect, useState } from 'react';

export type DashboardFlagId =
  | 'raw-drop'
  | 'this-week-gap'
  | 'next-week-gap'
  | 'compliance'
  | 'missed-recent';

export interface DashboardFlagSettings {
  /** Master switch per flag — turn the rule off entirely. */
  enabled: Record<DashboardFlagId, boolean>;
  /** RAW average drops below this value (out of 12). */
  rawDropThreshold: number;
  /** Also flag RAW when the trend is monotonically declining across the
   *  last three entries, even if the average is above the threshold. */
  rawDropTrendEnabled: boolean;
  /** Compliance (%) below which we surface a flag. */
  complianceThreshold: number;
  /** Days since last training that triggers "no training X+ d". */
  missedRecentDays: number;
  /** "No plan next week" only triggers when next week starts within this
   *  many days. Pre-emptive flagging earlier than that is noise. */
  nextWeekGapDaysBeforeWindow: number;
}

export const DEFAULT_DASHBOARD_FLAGS: DashboardFlagSettings = {
  enabled: {
    'raw-drop':       true,
    'this-week-gap':  true,
    'next-week-gap':  true,
    'compliance':     true,
    'missed-recent':  true,
  },
  rawDropThreshold: 8,
  rawDropTrendEnabled: true,
  complianceThreshold: 85,
  missedRecentDays: 5,
  nextWeekGapDaysBeforeWindow: 3,
};

const STORAGE_KEY = 'emos_v2_dashboard_flag_settings';
const SETTINGS_EVENT = 'emos:dashboard-flag-settings-changed';

function isValidFlagId(id: string): id is DashboardFlagId {
  return id === 'raw-drop' || id === 'this-week-gap' || id === 'next-week-gap'
      || id === 'compliance' || id === 'missed-recent';
}

export function loadDashboardFlagSettings(): DashboardFlagSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DASHBOARD_FLAGS;
    const parsed = JSON.parse(raw);
    // Merge defensively — never trust the shape, always backfill defaults.
    const enabled: Record<DashboardFlagId, boolean> = { ...DEFAULT_DASHBOARD_FLAGS.enabled };
    if (parsed?.enabled && typeof parsed.enabled === 'object') {
      Object.entries(parsed.enabled).forEach(([k, v]) => {
        if (isValidFlagId(k) && typeof v === 'boolean') enabled[k] = v;
      });
    }
    const numberOr = (v: unknown, def: number) =>
      typeof v === 'number' && Number.isFinite(v) ? v : def;
    return {
      enabled,
      rawDropThreshold: numberOr(parsed.rawDropThreshold, DEFAULT_DASHBOARD_FLAGS.rawDropThreshold),
      rawDropTrendEnabled: typeof parsed.rawDropTrendEnabled === 'boolean'
        ? parsed.rawDropTrendEnabled
        : DEFAULT_DASHBOARD_FLAGS.rawDropTrendEnabled,
      complianceThreshold: numberOr(parsed.complianceThreshold, DEFAULT_DASHBOARD_FLAGS.complianceThreshold),
      missedRecentDays: numberOr(parsed.missedRecentDays, DEFAULT_DASHBOARD_FLAGS.missedRecentDays),
      nextWeekGapDaysBeforeWindow: numberOr(
        parsed.nextWeekGapDaysBeforeWindow,
        DEFAULT_DASHBOARD_FLAGS.nextWeekGapDaysBeforeWindow,
      ),
    };
  } catch {
    return DEFAULT_DASHBOARD_FLAGS;
  }
}

export function saveDashboardFlagSettings(next: DashboardFlagSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
  } catch {
    // localStorage may be unavailable (private mode etc.) — fail silently;
    // the in-memory state is still correct for the current tab.
  }
}

/** Subscribes to changes so all dashboards on the same tab pick up an edit
 *  immediately, and other tabs catch up on the next mount. */
export function useDashboardFlagSettings(): [
  DashboardFlagSettings,
  (next: DashboardFlagSettings) => void,
] {
  const [settings, setSettings] = useState<DashboardFlagSettings>(() => loadDashboardFlagSettings());

  useEffect(() => {
    const onChange = () => setSettings(loadDashboardFlagSettings());
    window.addEventListener(SETTINGS_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const update = (next: DashboardFlagSettings) => {
    setSettings(next);
    saveDashboardFlagSettings(next);
  };
  return [settings, update];
}

export const FLAG_DEFINITIONS: { id: DashboardFlagId; label: string; description: string }[] = [
  { id: 'raw-drop',      label: 'RAW dropping',      description: 'Athletes whose RAW average has dropped below the threshold or is trending down.' },
  { id: 'this-week-gap', label: 'No plan this week', description: 'Athletes without a planned training week for the current week.' },
  { id: 'next-week-gap', label: 'No plan next week', description: 'Athletes without a planned training week for next week — only flagged when next week is close enough to start.' },
  { id: 'compliance',    label: 'Low compliance',    description: 'Athletes whose most recent weekly compliance has dropped below the threshold.' },
  { id: 'missed-recent', label: 'No recent training', description: 'Athletes who haven\'t logged a training in the configured number of days.' },
];
