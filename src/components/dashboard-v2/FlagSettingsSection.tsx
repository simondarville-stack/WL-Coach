// Settings card for the v2 dashboard's attention flags. Mounted into the
// existing General Settings page so coaches can tweak thresholds and
// disable individual flag rules. Backed by localStorage via
// dashboardFlagSettings (no schema migration required to ship).

import { useEffect, useId, useRef } from 'react';
import {
  DEFAULT_DASHBOARD_FLAGS,
  FLAG_DEFINITIONS,
  useDashboardFlagSettings,
  type DashboardFlagId,
  type DashboardFlagSettings,
} from '../../lib/dashboardFlagSettings';

function NumberField({
  label, suffix, value, min, max, step = 1, onChange, disabled,
}: {
  label: string;
  suffix?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className={`text-sm ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>
        {label}
      </label>
      <div className="inline-flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          value={value}
          min={min} max={max} step={step}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
          className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right tabular-nums disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {suffix && <span className="text-xs text-gray-500 w-12">{suffix}</span>}
      </div>
    </div>
  );
}

function Toggle({
  on, onChange, disabled,
}: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        on ? 'bg-blue-600' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      aria-pressed={on}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          on ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export function FlagSettingsSection() {
  const [settings, setSettings] = useDashboardFlagSettings();
  const sectionRef = useRef<HTMLDivElement>(null);

  // Scroll into view + flash highlight when navigated to via the
  // /settings#dashboard-flags hash, so the "Configure flags" link from the
  // dashboard lands the coach exactly on this card.
  useEffect(() => {
    if (window.location.hash !== '#dashboard-flags') return;
    const el = sectionRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('ring-2', 'ring-blue-300');
    const id = setTimeout(() => el.classList.remove('ring-2', 'ring-blue-300'), 1600);
    return () => clearTimeout(id);
  }, []);

  const setEnabled = (id: DashboardFlagId, v: boolean) => {
    setSettings({ ...settings, enabled: { ...settings.enabled, [id]: v } });
  };
  const setField = <K extends keyof DashboardFlagSettings>(k: K, v: DashboardFlagSettings[K]) => {
    setSettings({ ...settings, [k]: v });
  };

  const resetDefaults = () => setSettings(DEFAULT_DASHBOARD_FLAGS);

  return (
    <div
      id="dashboard-flags"
      ref={sectionRef}
      className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl mb-6 transition-shadow"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-1">Dashboard flags</h2>
          <p className="text-sm text-gray-600">
            Pick which attention rules surface on the v2 dashboard, and how strict each one is.
          </p>
        </div>
        <button
          type="button"
          onClick={resetDefaults}
          className="text-xs text-gray-500 hover:text-blue-600 underline-offset-2 hover:underline whitespace-nowrap"
        >
          Reset defaults
        </button>
      </div>

      <div className="mt-5 divide-y divide-gray-100">
        {FLAG_DEFINITIONS.map(def => {
          const on = settings.enabled[def.id];
          return (
            <div key={def.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-gray-900">{def.label}</span>
                  <span className="text-xs text-gray-500">{def.description}</span>
                </div>
                <Toggle on={on} onChange={(v) => setEnabled(def.id, v)} />
              </div>
              {def.id === 'raw-drop' && (
                <div className="mt-3 pl-1 space-y-2.5">
                  <NumberField
                    label="Flag when RAW average falls below"
                    suffix="/ 12"
                    value={settings.rawDropThreshold}
                    min={1} max={12} step={0.5}
                    disabled={!on}
                    onChange={(v) => setField('rawDropThreshold', v)}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <label className={`text-sm ${!on ? 'text-gray-400' : 'text-gray-700'}`}>
                      Also flag a 3-entry declining trend
                    </label>
                    <Toggle
                      on={settings.rawDropTrendEnabled}
                      onChange={(v) => setField('rawDropTrendEnabled', v)}
                      disabled={!on}
                    />
                  </div>
                </div>
              )}
              {def.id === 'next-week-gap' && (
                <div className="mt-3 pl-1">
                  <NumberField
                    label="Only flag when next week starts within"
                    suffix="days"
                    value={settings.nextWeekGapDaysBeforeWindow}
                    min={0} max={14} step={1}
                    disabled={!on}
                    onChange={(v) => setField('nextWeekGapDaysBeforeWindow', v)}
                  />
                </div>
              )}
              {def.id === 'compliance' && (
                <div className="mt-3 pl-1">
                  <NumberField
                    label="Flag when most-recent weekly compliance is below"
                    suffix="%"
                    value={settings.complianceThreshold}
                    min={0} max={100} step={1}
                    disabled={!on}
                    onChange={(v) => setField('complianceThreshold', v)}
                  />
                </div>
              )}
              {def.id === 'missed-recent' && (
                <div className="mt-3 pl-1">
                  <NumberField
                    label="Flag when last training was"
                    suffix="days+ ago"
                    value={settings.missedRecentDays}
                    min={1} max={30} step={1}
                    disabled={!on}
                    onChange={(v) => setField('missedRecentDays', v)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] text-gray-400">
        Stored locally in your browser. Changes take effect on the dashboard immediately.
      </p>
    </div>
  );
}
