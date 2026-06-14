/**
 * WeekMetricsSettings — popover the coach uses to pick which metric
 * inputs the athlete sees in the selected week.
 *
 * Three built-in toggles (RAW / Bodyweight / VAS) plus a per-athlete
 * pool of custom metric definitions (number or text). Definitions
 * persist across weeks; the per-week row only stores which IDs are
 * enabled. Adding / editing / archiving a definition does NOT
 * automatically enable it for the week — the coach checks the box.
 *
 * Default behaviour when no config exists yet for the week:
 *   RAW + Bodyweight = on   (matches the pre-feature UI)
 *   VAS              = off
 *   Custom metrics   = none enabled
 */
import { useCallback, useEffect, useState } from 'react';
import { Settings, Plus, Trash2, X, Pencil, Check } from 'lucide-react';
import { Button } from '../../ui';
import type {
  AthleteMetricDefinition,
  AthleteWeekMetricsConfig,
} from '../../../lib/database.types';
import {
  archiveMetricDefinition,
  createMetricDefinition,
  fetchMetricDefinitions,
  fetchWeekMetricsConfig,
  updateMetricDefinition,
  upsertWeekMetricsConfig,
} from '../../../lib/trainingLogService';
import { getOwnerId } from '../../../lib/ownerContext';
import { METRIC_TRACKING_DEFAULTS } from '../../../lib/trainingLogModel';

/** Supabase errors are plain objects, not Error instances, so the usual
 *  `e instanceof Error` branch falls through to String(e) = "[object
 *  Object]". Pull every useful field out so the popover can show
 *  something actionable (most often "relation does not exist" when the
 *  migration hasn't been applied yet, or an RLS violation). */
function describeError(e: unknown): string {
  // Always echo to the console too — even with the popover message,
  // the full structured object (stack, supabase code) is more useful
  // when filed in a bug report.
  console.error('[WeekMetricsSettings]', e);
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.message === 'string') parts.push(obj.message);
    if (typeof obj.details === 'string') parts.push(obj.details);
    if (typeof obj.hint === 'string') parts.push(`hint: ${obj.hint}`);
    if (typeof obj.code === 'string') parts.push(`code ${obj.code}`);
    if (parts.length) return parts.join(' · ');
    try { return JSON.stringify(obj); } catch { /* noop */ }
  }
  return String(e);
}

interface WeekMetricsSettingsProps {
  athleteId: string;
  weekStart: string;
  /** Optional callback so the caller can react to config saves
   *  (e.g. close a dialog, surface a toast). */
  onChange?: (config: AthleteWeekMetricsConfig) => void;
  /** Overview layout view-preference (device-local, not athlete data):
   *  whether the daily-metric tables show all 7 weekdays vs only days with
   *  a logged session. Owned by the parent so the overview re-renders. */
  showAllWeekdays?: boolean;
  onShowAllWeekdaysChange?: (value: boolean) => void;
}

interface PanelState {
  loaded: boolean;
  definitions: AthleteMetricDefinition[];
  config: {
    trackRaw: boolean;
    trackBodyweight: boolean;
    trackVas: boolean;
    enabledIds: Set<string>;
  };
}

const DEFAULT_PANEL: PanelState['config'] = {
  trackRaw: METRIC_TRACKING_DEFAULTS.track_raw,
  trackBodyweight: METRIC_TRACKING_DEFAULTS.track_bodyweight,
  trackVas: METRIC_TRACKING_DEFAULTS.track_vas,
  enabledIds: new Set(),
};

export function WeekMetricsSettings({
  athleteId,
  weekStart,
  onChange,
  showAllWeekdays,
  onShowAllWeekdaysChange,
}: WeekMetricsSettingsProps) {
  const ownerId = getOwnerId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>({
    loaded: false,
    definitions: [],
    config: { ...DEFAULT_PANEL, enabledIds: new Set() },
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<'number' | 'text'>('number');
  const [newUnit, setNewUnit] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editUnit, setEditUnit] = useState('');

  // Close on Escape key, matching ImageLightbox pattern. (UF-21 / H1)
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [defs, config] = await Promise.all([
          fetchMetricDefinitions(athleteId),
          fetchWeekMetricsConfig(athleteId, weekStart),
        ]);
        if (cancelled) return;
        setState({
          loaded: true,
          definitions: defs,
          config: config
            ? {
                trackRaw: config.track_raw,
                trackBodyweight: config.track_bodyweight,
                trackVas: config.track_vas,
                enabledIds: new Set(config.enabled_custom_metric_ids),
              }
            : { ...DEFAULT_PANEL, enabledIds: new Set() },
        });
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      }
    })();
    return () => { cancelled = true; };
  }, [open, athleteId, weekStart]);

  const persist = async (overrides?: Partial<PanelState['config']>) => {
    setSaving(true);
    setError(null);
    try {
      const cfg = { ...state.config, ...overrides };
      const saved = await upsertWeekMetricsConfig({
        athleteId,
        ownerId,
        weekStart,
        trackRaw: cfg.trackRaw,
        trackBodyweight: cfg.trackBodyweight,
        trackVas: cfg.trackVas,
        enabledCustomMetricIds: Array.from(cfg.enabledIds),
      });
      setState(s => ({ ...s, config: cfg }));
      onChange?.(saved);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleBuiltin = (key: 'trackRaw' | 'trackBodyweight' | 'trackVas') => {
    void persist({ [key]: !state.config[key] });
  };

  const toggleCustom = (defId: string) => {
    const next = new Set(state.config.enabledIds);
    if (next.has(defId)) next.delete(defId);
    else next.add(defId);
    void persist({ enabledIds: next });
  };

  const handleAdd = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setSaving(true);
    setError(null);
    try {
      const def = await createMetricDefinition({
        athleteId,
        ownerId,
        label,
        valueType: newType,
        unit: newUnit.trim() || null,
      });
      // Automatically enable the brand-new metric for this week —
      // otherwise creating it would feel like nothing happened.
      const nextIds = new Set(state.config.enabledIds);
      nextIds.add(def.id);
      setState(s => ({
        ...s,
        definitions: [...s.definitions, def],
        config: { ...s.config, enabledIds: nextIds },
      }));
      await persist({ enabledIds: nextIds });
      setNewLabel('');
      setNewUnit('');
      setShowAddForm(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (def: AthleteMetricDefinition) => {
    setEditingId(def.id);
    setEditLabel(def.label);
    setEditUnit(def.unit ?? '');
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    const label = editLabel.trim();
    if (!label) return;
    setSaving(true);
    try {
      const updated = await updateMetricDefinition(editingId, {
        label,
        unit: editUnit.trim() || null,
      });
      setState(s => ({
        ...s,
        definitions: s.definitions.map(d => (d.id === updated.id ? updated : d)),
      }));
      setEditingId(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (def: AthleteMetricDefinition) => {
    if (!window.confirm(`Archive "${def.label}"? Past data is preserved; the metric just won't appear for new weeks.`)) return;
    setSaving(true);
    try {
      await archiveMetricDefinition(def.id);
      const nextIds = new Set(state.config.enabledIds);
      nextIds.delete(def.id);
      setState(s => ({
        ...s,
        definitions: s.definitions.filter(d => d.id !== def.id),
        config: { ...s.config, enabledIds: nextIds },
      }));
      if (state.config.enabledIds.has(def.id)) {
        await persist({ enabledIds: nextIds });
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
        title="Configure which metrics to track this week"
      >
        <Settings size={11} />
        Metrics
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900">Metrics this week</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            {!state.loaded && (
              <div className="text-gray-500 italic py-4 text-center">Loading…</div>
            )}

            {state.loaded && (
              <>
                <div className="space-y-1.5 mb-3">
                  <ToggleRow
                    label="RAW readiness (1–3 scale)"
                    checked={state.config.trackRaw}
                    onChange={() => toggleBuiltin('trackRaw')}
                    disabled={saving}
                  />
                  <ToggleRow
                    label="Bodyweight"
                    checked={state.config.trackBodyweight}
                    onChange={() => toggleBuiltin('trackBodyweight')}
                    disabled={saving}
                  />
                  <ToggleRow
                    label="VAS pain (0–10)"
                    checked={state.config.trackVas}
                    onChange={() => toggleBuiltin('trackVas')}
                    disabled={saving}
                  />
                </div>

                <div className="border-t border-gray-100 pt-2 mb-2">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">
                      Custom
                    </span>
                    <button
                      onClick={() => setShowAddForm(s => !s)}
                      className="text-[10px] text-[color:var(--color-accent)] hover:text-[color:var(--color-accent-hover)] inline-flex items-center gap-0.5"
                    >
                      <Plus size={10} />
                      Add metric
                    </button>
                  </div>

                  {state.definitions.length === 0 && !showAddForm && (
                    <div className="text-gray-400 italic text-[11px] py-1">
                      None yet. Add one for things like Mood, Hydration, Pain area, etc.
                    </div>
                  )}

                  <div className="space-y-1">
                    {state.definitions.map(def => (
                      <div key={def.id} className="flex items-center gap-1.5">
                        {editingId === def.id ? (
                          <div className="flex-1 flex items-center gap-1">
                            <input
                              value={editLabel}
                              onChange={e => setEditLabel(e.target.value)}
                              className="flex-1 min-w-0 border border-gray-300 rounded px-1.5 py-0.5 text-[11px]"
                              placeholder="Label"
                            />
                            <input
                              value={editUnit}
                              onChange={e => setEditUnit(e.target.value)}
                              className="w-12 border border-gray-300 rounded px-1.5 py-0.5 text-[11px]"
                              placeholder="unit"
                            />
                            <button
                              onClick={handleEditSave}
                              className="text-emerald-600 hover:text-emerald-700 p-0.5"
                              aria-label="Save"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-gray-400 hover:text-gray-700 p-0.5"
                              aria-label="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <label className="flex-1 flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={state.config.enabledIds.has(def.id)}
                                onChange={() => toggleCustom(def.id)}
                                disabled={saving}
                              />
                              <span className="text-gray-700 truncate">{def.label}</span>
                              <span className="text-gray-400 text-[10px]">
                                {def.value_type}
                                {def.unit ? ` · ${def.unit}` : ''}
                              </span>
                            </label>
                            <button
                              onClick={() => beginEdit(def)}
                              className="text-gray-400 hover:text-[color:var(--color-accent)] p-0.5"
                              aria-label="Edit"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              onClick={() => handleArchive(def)}
                              className="text-gray-400 hover:text-[color:var(--color-danger-text)] p-0.5"
                              aria-label="Archive"
                            >
                              <Trash2 size={11} />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  {showAddForm && (
                    <div className="mt-2 p-2 border border-gray-200 rounded bg-gray-50 space-y-1.5">
                      <input
                        value={newLabel}
                        onChange={e => setNewLabel(e.target.value)}
                        placeholder="Metric name (e.g. Lower back pain)"
                        className="w-full border border-gray-300 rounded px-2 py-1 text-[11px]"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <select
                          value={newType}
                          onChange={e => setNewType(e.target.value as 'number' | 'text')}
                          className="border border-gray-300 rounded px-1.5 py-1 text-[11px] flex-shrink-0"
                        >
                          <option value="number">Number</option>
                          <option value="text">Text</option>
                        </select>
                        <input
                          value={newUnit}
                          onChange={e => setNewUnit(e.target.value)}
                          placeholder="unit (optional)"
                          className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-[11px]"
                        />
                      </div>
                      <div className="flex gap-1.5 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setShowAddForm(false); setNewLabel(''); setNewUnit(''); }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleAdd}
                          disabled={saving || !newLabel.trim()}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {onShowAllWeekdaysChange && (
                  <div className="border-t border-gray-100 pt-2">
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">
                      Overview layout
                    </div>
                    <ToggleRow
                      label="Show all weekdays (Mon–Sun)"
                      checked={!!showAllWeekdays}
                      onChange={() => onShowAllWeekdaysChange(!showAllWeekdays)}
                    />
                    <div className="text-[10px] text-gray-400 mt-0.5 leading-snug">
                      Off: only days with a logged session. Metrics always sit
                      under the weekday they were submitted on. Applies to all athletes.
                    </div>
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="mt-2 px-2 py-1 bg-red-50 border border-red-200 rounded text-red-700 text-[11px]">
                {error}
              </div>
            )}
            {saving && (
              <div className="mt-2 text-gray-500 italic text-[11px]">Saving…</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="text-gray-700">{label}</span>
    </label>
  );
}
