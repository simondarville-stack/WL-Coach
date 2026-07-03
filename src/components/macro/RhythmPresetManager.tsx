/**
 * RhythmPresetManager — coach CRUD for fill-guide rhythm presets.
 *
 * Edits a local draft of the whole preset list and persists to
 * general_settings.rhythm_presets on Save (NULL column = app defaults, same
 * convention as week types / phase presets). The fill guide's inline chips
 * edit a per-fill working copy and never reach this list — presets change
 * only here.
 *
 * Every preset row shows a sparkline (solid = load %, dotted = reps %) so
 * undulating vs step vs flat is recognisable at a glance.
 */
import { useMemo, useRef, useState } from 'react';
import { Copy, Plus, Trash2, X } from 'lucide-react';
import type { RhythmPreset, RhythmStep, WeekTypeConfig } from '../../lib/database.types';

interface RhythmPresetManagerProps {
  presets: RhythmPreset[];
  weekTypes: WeekTypeConfig[];
  onSave: (presets: RhythmPreset[]) => Promise<void>;
  onClose: () => void;
}

const inputCls =
  'border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';

/** Mini wave preview: solid = load %, dotted = reps %, sampled over 8 steps. */
function RhythmSparkline({ preset, weekTypes }: { preset: RhythmPreset; weekTypes: WeekTypeConfig[] }) {
  const N = 8, W = 104, H = 20;
  const { load, reps } = useMemo(() => {
    const load: number[] = [], reps: number[] = [];
    for (let i = 0; i < N; i++) {
      let step: RhythmStep = { load: 100, reps: 100 };
      if (preset.mode === 'weektype') {
        const abbr = weekTypes.length > 0 ? weekTypes[i % weekTypes.length].abbreviation : '';
        step = preset.mult?.[abbr] ?? step;
      } else if (preset.pattern && preset.pattern.length > 0) {
        step = preset.pattern[i % preset.pattern.length];
      }
      load.push(step.load);
      reps.push(step.reps);
    }
    return { load, reps };
  }, [preset, weekTypes]);

  const all = [...load, ...reps];
  const min = Math.min(...all), max = Math.max(...all);
  const range = (max - min) || 1;
  const x = (i: number) => 2 + i * (W - 4) / (N - 1);
  const y = (v: number) => 2 + (max - v) / range * (H - 4);
  const line = (arr: number[]) => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return (
    <svg width={W} height={H} className="block opacity-90">
      <polyline points={line(reps)} fill="none" stroke="#94a3b8" strokeWidth={1} strokeDasharray="2 2" />
      <polyline points={line(load)} fill="none" stroke="var(--color-accent)" strokeWidth={1.4} />
    </svg>
  );
}

export function RhythmPresetManager({ presets, weekTypes, onSave, onClose }: RhythmPresetManagerProps) {
  const [draft, setDraft] = useState<RhythmPreset[]>(() => JSON.parse(JSON.stringify(presets)) as RhythmPreset[]);
  const [selectedId, setSelectedId] = useState<string>(presets[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  const selected = draft.find(p => p.id === selectedId) ?? draft[0];

  const updateSelected = (patch: Partial<RhythmPreset>) => {
    setDraft(prev => prev.map(p => (p.id === selected?.id ? { ...p, ...patch } : p)));
  };

  const addPreset = () => {
    const p: RhythmPreset = {
      id: crypto.randomUUID(),
      name: 'New rhythm',
      mode: 'pattern',
      pattern: [{ load: 100, reps: 100 }],
      stampTypes: null,
    };
    setDraft(prev => [...prev, p]);
    setSelectedId(p.id);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const copy = JSON.parse(JSON.stringify(selected)) as RhythmPreset;
    copy.id = crypto.randomUUID();
    copy.name = `${selected.name} (copy)`;
    setDraft(prev => [...prev, copy]);
    setSelectedId(copy.id);
  };

  const deleteSelected = () => {
    if (!selected || draft.length <= 1) return;
    const next = draft.filter(p => p.id !== selected.id);
    setDraft(next);
    setSelectedId(next[0].id);
  };

  const setPatternStep = (i: number, key: 'load' | 'reps', value: number) => {
    if (!selected?.pattern) return;
    updateSelected({ pattern: selected.pattern.map((st, j) => (j === i ? { ...st, [key]: value } : st)) });
  };
  const setStamp = (i: number, abbr: string) => {
    if (!selected?.pattern) return;
    const stamps: (string | null)[] = selected.stampTypes
      ? [...selected.stampTypes]
      : selected.pattern.map(() => null);
    stamps[i] = abbr || null;
    updateSelected({ stampTypes: stamps.some(Boolean) ? stamps : null });
  };
  const addStep = () => {
    if (!selected?.pattern) return;
    updateSelected({
      pattern: [...selected.pattern, { load: 100, reps: 100 }],
      stampTypes: selected.stampTypes ? [...selected.stampTypes, null] : selected.stampTypes,
    });
  };
  const removeStep = () => {
    if (!selected?.pattern || selected.pattern.length <= 1) return;
    const stamps = selected.stampTypes ? selected.stampTypes.slice(0, -1) : null;
    updateSelected({
      pattern: selected.pattern.slice(0, -1),
      stampTypes: stamps && stamps.some(Boolean) ? stamps : null,
    });
  };
  const setMult = (abbr: string, key: 'load' | 'reps', value: number) => {
    if (!selected) return;
    updateSelected({
      mult: { ...selected.mult, [abbr]: { ...(selected.mult?.[abbr] ?? { load: 100, reps: 100 }), [key]: value } },
    });
  };

  const wtColor = (abbr: string) => weekTypes.find(t => t.abbreviation === abbr)?.color ?? '#94a3b8';

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // ── movable window (same pattern as the fill guide) ─────────────────────────
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const off = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    const move = (ev: PointerEvent) =>
      setPos({ x: Math.max(4, ev.clientX - off.dx), y: Math.max(4, ev.clientY - off.dy) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!selected) return null;

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-[480px] bg-white rounded-lg shadow-2xl border border-gray-300"
      style={pos ? { left: pos.x, top: pos.y } : { left: '50%', top: 120, transform: 'translateX(-50%)' }}
    >
      <div
        className="flex items-center justify-between px-3.5 py-2 border-b border-gray-200 bg-gray-50 rounded-t-lg cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onHeaderPointerDown}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)]">
          Rhythm presets
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="Close without saving">
          <X size={14} />
        </button>
      </div>

      <div className="flex gap-3 px-3.5 py-2.5">
        {/* Preset list */}
        <div className="w-[170px] flex-shrink-0 border-r border-gray-100 pr-2.5">
          {draft.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`w-full text-left px-1.5 py-1 rounded mb-0.5 ${p.id === selected.id ? 'bg-[var(--color-accent-muted)]' : 'hover:bg-gray-50'}`}
            >
              <span className={`block text-[11px] leading-tight truncate ${p.id === selected.id ? 'font-semibold text-[color:var(--color-accent)]' : 'text-[color:var(--color-text-secondary)]'}`}>
                {p.name}
              </span>
              <RhythmSparkline preset={p} weekTypes={weekTypes} />
            </button>
          ))}
          <div className="flex gap-1 mt-1.5">
            <button onClick={addPreset} className="p-1 rounded border border-gray-300 text-gray-500 hover:bg-gray-50" title="New preset"><Plus size={12} /></button>
            <button onClick={duplicateSelected} className="p-1 rounded border border-gray-300 text-gray-500 hover:bg-gray-50" title="Duplicate"><Copy size={12} /></button>
            <button onClick={deleteSelected} disabled={draft.length <= 1} className="p-1 rounded border border-gray-300 text-gray-500 hover:text-red-600 hover:bg-gray-50 disabled:opacity-30" title="Delete"><Trash2 size={12} /></button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 min-w-0 text-xs space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="w-[40px] text-[11px] text-[color:var(--color-text-secondary)]">Name</label>
            <input
              type="text"
              value={selected.name}
              onChange={e => updateSelected({ name: e.target.value })}
              className={`${inputCls} flex-1`}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-[40px] text-[11px] text-[color:var(--color-text-secondary)]">Mode</label>
            <div className="inline-flex border border-gray-300 rounded overflow-hidden">
              <button
                onClick={() => updateSelected({
                  mode: 'weektype',
                  mult: selected.mult ?? Object.fromEntries(weekTypes.map(t => [t.abbreviation, { load: 100, reps: 100 }])),
                })}
                className={`px-2.5 py-0.5 text-[11px] ${selected.mode === 'weektype' ? 'bg-[var(--color-accent)] text-white' : 'bg-white text-gray-600'}`}
              >
                Week-type
              </button>
              <button
                onClick={() => updateSelected({
                  mode: 'pattern',
                  pattern: selected.pattern ?? [{ load: 100, reps: 100 }],
                })}
                className={`px-2.5 py-0.5 text-[11px] ${selected.mode === 'pattern' ? 'bg-[var(--color-accent)] text-white' : 'bg-white text-gray-600'}`}
              >
                Pattern
              </button>
            </div>
          </div>
          <div className="text-[9px] text-[color:var(--color-text-tertiary)]">
            top = load % · bottom = reps % of trend{selected.mode === 'pattern' ? ' · 3rd = week-type stamp (— = leave alone)' : ' · follows the types on the weeks'}
          </div>

          <div className="flex flex-wrap gap-1">
            {selected.mode === 'weektype'
              ? weekTypes.map(t => {
                  const m = selected.mult?.[t.abbreviation] ?? { load: 100, reps: 100 };
                  return (
                    <div key={t.abbreviation} className="flex flex-col items-center border rounded px-0.5 py-0.5 bg-gray-50" style={{ borderColor: t.color }}>
                      <input type="number" value={m.load}
                        onChange={e => setMult(t.abbreviation, 'load', parseFloat(e.target.value) || 100)}
                        className="no-spin w-[44px] text-center text-[11px] font-bold bg-transparent outline-none" />
                      <input type="number" value={m.reps}
                        onChange={e => setMult(t.abbreviation, 'reps', parseFloat(e.target.value) || 100)}
                        className="no-spin w-[44px] text-center text-[10px] text-gray-500 bg-transparent outline-none border-t border-dotted border-gray-300" />
                      <span className="text-[8px] font-bold text-white rounded px-1" style={{ backgroundColor: t.color }}>{t.name}</span>
                    </div>
                  );
                })
              : (
                <>
                  {(selected.pattern ?? []).map((st, i) => {
                    const stampAbbr = selected.stampTypes?.[i] ?? '';
                    return (
                      <div key={i} className="flex flex-col items-center border rounded px-0.5 py-0.5 bg-gray-50" style={{ borderColor: stampAbbr ? wtColor(stampAbbr) : '#cbd5e1' }}>
                        <input type="number" value={st.load}
                          onChange={e => setPatternStep(i, 'load', parseFloat(e.target.value) || 100)}
                          className="no-spin w-[44px] text-center text-[11px] font-bold bg-transparent outline-none" />
                        <input type="number" value={st.reps}
                          onChange={e => setPatternStep(i, 'reps', parseFloat(e.target.value) || 100)}
                          className="no-spin w-[44px] text-center text-[10px] text-gray-500 bg-transparent outline-none border-t border-dotted border-gray-300" />
                        <select
                          value={stampAbbr ?? ''}
                          onChange={e => setStamp(i, e.target.value)}
                          className="w-[46px] text-[9px] text-gray-500 bg-transparent outline-none text-center"
                          title="Week type to stamp onto this step's weeks"
                        >
                          <option value="">—</option>
                          {weekTypes.map(t => <option key={t.abbreviation} value={t.abbreviation}>{t.abbreviation}</option>)}
                        </select>
                      </div>
                    );
                  })}
                  <button onClick={addStep} className="w-6 border border-dashed border-gray-300 rounded text-gray-400 hover:text-gray-600" title="Add step">+</button>
                  {(selected.pattern?.length ?? 0) > 1 && (
                    <button onClick={removeStep} className="w-6 border border-dashed border-gray-300 rounded text-gray-400 hover:text-gray-600" title="Remove last step">−</button>
                  )}
                </>
              )}
          </div>

          <div className="text-[9px] text-[color:var(--color-text-tertiary)] pt-0.5">
            Saved to your coach settings. Tweaks made inside the fill guide affect that fill only and never write back here.
          </div>

          <div className="flex items-center gap-2 pt-1.5 border-t border-gray-100">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 rounded text-white text-[11.5px] font-medium bg-[var(--color-accent)] disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save presets'}
            </button>
            <button onClick={onClose} className="px-3 py-1 rounded border border-gray-300 text-[11.5px] text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
