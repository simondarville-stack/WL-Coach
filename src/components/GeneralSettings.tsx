import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';

export function GeneralSettings() {
  const { settings, loading, saving, fetchSettings, updateSettings } = useSettings();

  const [rawAverageDays, setRawAverageDays] = useState(7);
  const [gridLoadIncrement, setGridLoadIncrement] = useState(5);
  const [gridClickIncrement, setGridClickIncrement] = useState(1);
  const [bodyweightMaDays, setBodyweightMaDays] = useState(7);
  const [showStressMetric, setShowStressMetric] = useState(false);
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>(['sets', 'reps', 'tonnage']);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (settings) {
      setRawAverageDays(settings.raw_average_days);
      setGridLoadIncrement(settings.grid_load_increment);
      setGridClickIncrement(settings.grid_click_increment);
      setBodyweightMaDays(settings.bodyweight_ma_days ?? 7);
      setShowStressMetric(settings.show_stress_metric ?? false);
      setVisibleMetrics(settings.visible_summary_metrics ?? ['sets', 'reps', 'tonnage']);
    }
  }, [settings]);

  async function toggleRawScoring() {
    if (!settings) return;
    try {
      await updateSettings(settings.id, { raw_enabled: !settings.raw_enabled });
    } catch {
      // error logged in hook
    }
  }

  async function updateRawAverageDays() {
    if (!settings) return;
    try {
      await updateSettings(settings.id, { raw_average_days: rawAverageDays });
    } catch {
      // error logged in hook
    }
  }

  async function updateGridSettings() {
    if (!settings) return;
    try {
      await updateSettings(settings.id, { grid_load_increment: gridLoadIncrement, grid_click_increment: gridClickIncrement });
    } catch {
      // error logged in hook
    }
  }

  async function updateBodyweightMaDays() {
    if (!settings) return;
    try {
      await updateSettings(settings.id, { bodyweight_ma_days: bodyweightMaDays });
    } catch {
      // error logged in hook
    }
  }

  async function toggleMetric(key: string) {
    if (!settings) return;
    const next = visibleMetrics.includes(key)
      ? visibleMetrics.filter(m => m !== key)
      : [...visibleMetrics, key];
    setVisibleMetrics(next);
    await updateSettings(settings.id, { visible_summary_metrics: next });
  }

  async function toggleStressMetric(value: boolean) {
    if (!settings) return;
    setShowStressMetric(value);
    await updateSettings(settings.id, { show_stress_metric: value });
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-gray-400 text-sm"><div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />Loading settings...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-base font-medium mb-4 text-gray-900">General Settings</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900 mb-1">RAW Scoring</h2>
            <p className="text-sm text-gray-600">
              Enable athletes to record Readiness and Wellbeing scores with their training logs
            </p>
          </div>

          <button
            onClick={toggleRawScoring}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              settings?.raw_enabled ? 'bg-blue-600' : 'bg-gray-300'
            } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings?.raw_enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {settings?.raw_enabled && (
          <>
            <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <h3 className="text-sm font-medium text-blue-900 mb-2">About RAW Scoring</h3>
              <p className="text-sm text-blue-800">
                RAW scoring helps athletes assess their readiness before training across four pillars: Sleep, Physical condition, Mood, and Nutrition. Based on their scores, the system provides volume adjustment recommendations.
              </p>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <label className="block text-sm font-medium text-gray-700 mb-2">RAW Average Days</label>
              <p className="text-sm text-gray-600 mb-3">
                Number of days to calculate the rolling RAW average in the coach dashboard
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={rawAverageDays}
                  onChange={(e) => setRawAverageDays(Math.max(1, Math.min(30, parseInt(e.target.value) || 7)))}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600">days</span>
                {rawAverageDays !== settings.raw_average_days && (
                  <button
                    onClick={updateRawAverageDays}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl mt-6">
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-1">Grid Input Mode</h2>
          <p className="text-sm text-gray-600 mb-4">Configure settings for the grid-based prescription editor</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Load Increment (kg)</label>
            <p className="text-sm text-gray-600 mb-3">
              Auto-increment for new column load when adding columns in grid mode
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0.5"
                max="50"
                step="0.5"
                value={gridLoadIncrement}
                onChange={(e) => setGridLoadIncrement(Math.max(0.5, Math.min(50, parseFloat(e.target.value) || 5)))}
                className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">kg</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Click Increment</label>
            <p className="text-sm text-gray-600 mb-3">
              Value change per click on load/reps/sets cells (left-click increases, right-click decreases)
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0.5"
                max="10"
                step="0.5"
                value={gridClickIncrement}
                onChange={(e) => setGridClickIncrement(Math.max(0.5, Math.min(10, parseFloat(e.target.value) || 1)))}
                className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {(gridLoadIncrement !== settings?.grid_load_increment || gridClickIncrement !== settings?.grid_click_increment) && (
            <button
              onClick={updateGridSettings}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              Save Grid Settings
            </button>
          )}
        </div>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl mt-6">
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-1">Bodyweight Tracking</h2>
          <p className="text-sm text-gray-600 mb-4">Configure the moving average window for bodyweight trend calculations</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Moving average window (days)</label>
          <p className="text-sm text-gray-600 mb-3">
            Used for the dashboard bodyweight card and trend calculation
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="3"
              max="30"
              value={bodyweightMaDays}
              onChange={(e) => setBodyweightMaDays(Math.max(3, Math.min(30, parseInt(e.target.value) || 7)))}
              className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">days</span>
            {bodyweightMaDays !== (settings?.bodyweight_ma_days ?? 7) && (
              <button
                onClick={updateBodyweightMaDays}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Save
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl mt-6">
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-1">Layout preferences</h2>
          <p className="text-sm text-gray-600 mb-4">Choose how exercise and day dialogs open in the weekly planner</p>
        </div>
        <div className="flex gap-3">
          {([
            {
              value: 'center' as const,
              label: 'Centered dialog',
              preview: (
                <div className="w-full h-10 bg-gray-100 rounded relative flex items-center justify-center">
                  <div className="absolute inset-0 bg-black/10 rounded" />
                  <div className="relative w-14 h-7 bg-white border border-gray-300 rounded shadow-sm" />
                </div>
              ),
            },
            {
              value: 'sidebar' as const,
              label: 'Side panel',
              preview: (
                <div className="w-full h-10 bg-gray-100 rounded relative flex items-center justify-end overflow-hidden">
                  <div className="absolute inset-0 bg-black/10 rounded" />
                  <div className="relative w-10 h-full bg-white border-l border-gray-300" />
                </div>
              ),
            },
          ] as const).map(({ value, label, preview }) => {
            const active = (settings?.dialog_mode ?? 'center') === value;
            return (
              <button
                key={value}
                onClick={async () => {
                  if (!settings) return;
                  await updateSettings(settings.id, { dialog_mode: value });
                }}
                className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${
                  active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {preview}
                <p className={`text-xs font-medium mt-2 ${active ? 'text-blue-700' : 'text-gray-700'}`}>{label}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl mt-6">
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-1">Weekly Planner Display</h2>
          <p className="text-sm text-gray-600 mb-4">Control which metrics are shown in the week summary</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Visible summary metrics</label>
            <div className="flex flex-wrap gap-3">
              {(['sets', 'reps', 'tonnage'] as const).map(key => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visibleMetrics.includes(key)}
                    onChange={() => void toggleMetric(key)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="capitalize text-gray-700">{key}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-700">Show stress metric</p>
              <p className="text-xs text-gray-500 mt-0.5">sum(reps × (load/PR)²) — requires athlete PRs</p>
            </div>
            <button
              onClick={() => void toggleStressMetric(!showStressMetric)}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                showStressMetric ? 'bg-blue-600' : 'bg-gray-300'
              } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  showStressMetric ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
