/**
 * MacroFillGuide — the movable fill-guide popup.
 *
 * Computes a live FillWritePlan from its inputs (via buildFillPlan → the pure
 * engine) and pushes the preview up so MacroTableV2 can ghost the pending
 * cells. Nothing touches the database until Apply; the parent executes the
 * plan (with an undo snapshot) so the table stays the single source of truth.
 *
 * The rhythm chips edit a WORKING COPY of the selected preset — per-fill
 * tweaks never write back to the coach's saved presets (that's the future
 * rhythm manager's job).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type {
  MacroTarget,
  MacroTrackedExerciseWithExercise,
  MacroWeek,
  RhythmPreset,
  WeekTypeConfig,
} from '../../lib/database.types';
import { stampAllowed } from '../../lib/macroFillGuide';
import {
  buildFillPlan,
  FILL_TARGET_ALL,
  FILL_TARGET_SREPS,
  type FillGuideInputs,
  type FillGuidePreview,
  type FillWritePlan,
} from './fillGuidePlan';

interface MacroFillGuideProps {
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  weekTypes: WeekTypeConfig[];
  rhythmPresets: RhythmPreset[];
  onPreviewChange: (preview: FillGuidePreview | null) => void;
  onApply: (plan: FillWritePlan, inputs: FillGuideInputs) => Promise<void>;
  onUpdateReference: (trackedExId: string, referenceKg: number | null) => Promise<void>;
  onEditPresets?: () => void;
  /** Registers a setter the chart's ◆ anchor handles use to drive the guide's
   *  from/to values while dragging (kg in, converted to the active unit). */
  registerAnchorSetter?: (fn: ((which: 'from' | 'to', kg: number) => void) | null) => void;
  onClose: () => void;
}

const inputCls =
  'no-spin border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';
const labelCls = 'w-[86px] flex-shrink-0 text-[11px] text-[color:var(--color-text-secondary)]';

export function MacroFillGuide({
  macroWeeks,
  trackedExercises,
  targets,
  weekTypes,
  rhythmPresets,
  onPreviewChange,
  onApply,
  onUpdateReference,
  onEditPresets,
  registerAnchorSetter,
  onClose,
}: MacroFillGuideProps) {
  const lastWeek = macroWeeks.length > 0 ? Math.max(...macroWeeks.map(w => w.week_number)) : 1;

  const [target, setTarget] = useState<string>(trackedExercises[0]?.id ?? FILL_TARGET_SREPS);
  const [unit, setUnit] = useState<'kg' | 'pct'>('kg');
  const [fromWeek, setFromWeek] = useState(1);
  const [toWeek, setToWeek] = useState(lastWeek);
  const [fromValue, setFromValue] = useState(100);
  const [toValue, setToValue] = useState(140);
  const [fillReps, setFillReps] = useState(true);
  const [repsFrom, setRepsFrom] = useState(28);
  const [repsTo, setRepsTo] = useState(12);
  const [mirror, setMirror] = useState(true);
  const [mirrorPct, setMirrorPct] = useState(20);
  const [overwrite, setOverwrite] = useState(false);
  const [stamp, setStamp] = useState(true);
  const [loadRoundingKg, setLoadRoundingKg] = useState(2.5);
  const [rhythm, setRhythm] = useState<RhythmPreset>(() =>
    JSON.parse(JSON.stringify(rhythmPresets[0])) as RhythmPreset,
  );
  const [applying, setApplying] = useState(false);

  const isGeneral = target === FILL_TARGET_SREPS;
  const isAll = target === FILL_TARGET_ALL;
  const selectedTe = trackedExercises.find(te => te.id === target);
  const effectiveUnit: 'kg' | 'pct' = isAll ? 'pct' : unit;

  // Reference (single exercise, % mode) — draft persisted on blur.
  const [refDraft, setRefDraft] = useState<string>('');
  useEffect(() => {
    setRefDraft(selectedTe?.reference_kg != null ? String(selectedTe.reference_kg) : '');
  }, [selectedTe?.id, selectedTe?.reference_kg]);
  const referenceKg = refDraft.trim() === '' ? null : parseFloat(refDraft);

  const inputs: FillGuideInputs = useMemo(() => ({
    target,
    unit: effectiveUnit,
    fromWeek,
    fromValue,
    toWeek,
    toValue,
    fillReps: !isGeneral && fillReps,
    repsFrom,
    repsTo,
    mirror: !isGeneral && mirror,
    mirrorPct,
    overwrite,
    stamp,
    loadRoundingKg,
    rhythm,
  }), [target, effectiveUnit, fromWeek, fromValue, toWeek, toValue, fillReps, repsFrom,
       repsTo, mirror, mirrorPct, overwrite, stamp, loadRoundingKg, rhythm, isGeneral]);

  const plan = useMemo(() => {
    // Single-exercise % mode resolves against the DRAFT reference so the
    // preview tracks what the coach is typing before it's persisted.
    const exList = !isAll && !isGeneral && effectiveUnit === 'pct'
      ? trackedExercises.map(te =>
          te.id === target
            ? { ...te, reference_kg: referenceKg && referenceKg > 0 ? referenceKg : null }
            : te)
      : trackedExercises;
    return buildFillPlan(inputs, macroWeeks, exList, targets, weekTypes);
  }, [inputs, macroWeeks, trackedExercises, targets, weekTypes, isAll, isGeneral, effectiveUnit, referenceKg, target]);

  // Push the live preview up for table ghosting; clear on unmount.
  useEffect(() => {
    onPreviewChange(plan.preview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  useEffect(() => () => onPreviewChange(null), [onPreviewChange]);

  // Chart anchor handles drive the guide's from/to values (kg → active unit).
  useEffect(() => {
    if (!registerAnchorSetter) return;
    registerAnchorSetter((which, kg) => {
      const ref = referenceKg && referenceKg > 0 ? referenceKg : selectedTe?.reference_kg ?? null;
      const value = effectiveUnit === 'pct'
        ? (ref && ref > 0 ? Math.round((kg / ref) * 200) / 2 : null)
        : Math.round(kg / 2.5) * 2.5;
      if (value == null) return;
      if (which === 'from') setFromValue(value);
      else setToValue(value);
    });
    return () => registerAnchorSetter(null);
  }, [registerAnchorSetter, effectiveUnit, referenceKg, selectedTe?.reference_kg]);

  // ── movable window ──────────────────────────────────────────────────────────
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    const move = (ev: PointerEvent) => {
      if (!dragOffset.current) return;
      setPos({
        x: Math.max(4, ev.clientX - dragOffset.current.dx),
        y: Math.max(4, ev.clientY - dragOffset.current.dy),
      });
    };
    const up = () => {
      dragOffset.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── rhythm working copy editing ─────────────────────────────────────────────
  const selectRhythm = (id: string) => {
    const preset = rhythmPresets.find(r => r.id === id);
    if (preset) setRhythm(JSON.parse(JSON.stringify(preset)) as RhythmPreset);
  };
  const setMult = (abbr: string, key: 'load' | 'reps', value: number) => {
    setRhythm(r => ({
      ...r,
      mult: { ...r.mult, [abbr]: { ...(r.mult?.[abbr] ?? { load: 100, reps: 100 }), [key]: value } },
    }));
  };
  const setPatternStep = (i: number, key: 'load' | 'reps', value: number) => {
    setRhythm(r => ({
      ...r,
      pattern: (r.pattern ?? []).map((st, j) => (j === i ? { ...st, [key]: value } : st)),
    }));
  };
  const addPatternStep = () => {
    setRhythm(r => ({
      ...r,
      pattern: [...(r.pattern ?? []), { load: 100, reps: 100 }],
      stampTypes: r.stampTypes ? [...r.stampTypes, null] : r.stampTypes,
    }));
  };
  const removePatternStep = () => {
    setRhythm(r => ({
      ...r,
      pattern: (r.pattern ?? []).slice(0, -1),
      stampTypes: r.stampTypes ? r.stampTypes.slice(0, -1) : r.stampTypes,
    }));
  };

  // Switching anchor unit CONVERTS the values (via the reference) instead of
  // reinterpreting the raw numbers — 120 kg at ref 150 becomes 80 %, not 120 %.
  const switchUnit = (next: 'kg' | 'pct') => {
    if (next === unit) return;
    const ref = referenceKg && referenceKg > 0 ? referenceKg : selectedTe?.reference_kg ?? null;
    if (ref && ref > 0) {
      if (next === 'pct') {
        setFromValue(Math.round((fromValue / ref) * 200) / 2);
        setToValue(Math.round((toValue / ref) * 200) / 2);
      } else {
        setFromValue(Math.round((ref * fromValue) / 100 / 2.5) * 2.5);
        setToValue(Math.round((ref * toValue) / 100 / 2.5) * 2.5);
      }
    }
    setUnit(next);
  };

  const canStamp = stampAllowed(rhythm, weekTypes);
  const hasStamps = rhythm.mode === 'pattern' && !!rhythm.stampTypes?.some(Boolean);
  const missingStampTypes = hasStamps && !canStamp
    ? Array.from(new Set((rhythm.stampTypes ?? []).filter((s): s is string =>
        !!s && !weekTypes.some(t => t.abbreviation === s))))
    : [];

  const wtColor = (abbr: string) => weekTypes.find(t => t.abbreviation === abbr)?.color ?? '#94a3b8';

  const handleApply = async () => {
    if (plan.cellCount === 0 || applying) return;
    setApplying(true);
    try {
      await onApply(plan, inputs);
    } catch {
      // Failure is surfaced by the macro page's error banner; the guide stays
      // open (parent keeps it mounted) so the coach can retry.
    } finally {
      setApplying(false);
    }
  };

  const valueUnitLabel = isGeneral ? 'reps' : effectiveUnit === 'pct' ? '%' : 'kg';

  return (
    <div
      ref={panelRef}
      className="fixed z-40 w-[400px] bg-white rounded-lg shadow-2xl border border-gray-300"
      style={pos ? { left: pos.x, top: pos.y } : { right: 24, top: 120 }}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3.5 py-2 border-b border-gray-200 bg-gray-50 rounded-t-lg cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onHeaderPointerDown}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)]">
          Fill guide
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="Close">
          <X size={14} />
        </button>
      </div>

      <div className="px-3.5 py-2.5 space-y-1.5 text-xs">
        {/* Target */}
        <div className="flex items-center gap-2">
          <label className={labelCls}>Target</label>
          <select
            value={target}
            onChange={e => setTarget(e.target.value)}
            className={`${inputCls} max-w-[240px]`}
          >
            {trackedExercises.map(te => (
              <option key={te.id} value={te.id}>
                {te.exercise.exercise_code || te.exercise.name} (exercise)
              </option>
            ))}
            <option value={FILL_TARGET_ALL}>All exercises (proportional, % of reference)</option>
            <option value={FILL_TARGET_SREPS}>Week · Σreps (general)</option>
          </select>
        </div>

        {/* Anchor unit */}
        {!isGeneral && (
          <div className="flex items-center gap-2">
            <label className={labelCls}>Anchors in</label>
            <div className="inline-flex border border-gray-300 rounded overflow-hidden">
              <button
                onClick={() => !isAll && switchUnit('kg')}
                className={`px-2.5 py-0.5 text-[11px] ${effectiveUnit === 'kg' ? 'bg-[var(--color-accent)] text-white' : 'bg-white text-gray-600'} ${isAll ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={isAll ? 'All-exercises fills are always % of each reference' : undefined}
              >
                kg
              </button>
              <button
                onClick={() => switchUnit('pct')}
                className={`px-2.5 py-0.5 text-[11px] ${effectiveUnit === 'pct' ? 'bg-[var(--color-accent)] text-white' : 'bg-white text-gray-600'}`}
              >
                % of reference
              </button>
            </div>
          </div>
        )}

        {/* Reference (single exercise, % mode) */}
        {!isGeneral && !isAll && effectiveUnit === 'pct' && selectedTe && (
          <div className="flex items-center gap-2">
            <label className={labelCls}>Reference</label>
            <input
              type="number"
              step="2.5"
              value={refDraft}
              onChange={e => setRefDraft(e.target.value)}
              onBlur={() => {
                const v = refDraft.trim() === '' ? null : parseFloat(refDraft);
                if (v !== selectedTe.reference_kg && (v === null || !isNaN(v))) {
                  void onUpdateReference(selectedTe.id, v);
                }
              }}
              className={`${inputCls} w-[68px]`}
              placeholder="kg"
            />
            <span className="text-[10px] text-[color:var(--color-text-tertiary)]">
              kg — saved on the tracked exercise
            </span>
          </div>
        )}
        {isAll && (
          <div className="text-[10px] text-[color:var(--color-text-tertiary)] pl-[94px]">
            Each exercise anchors to its own saved reference.
            {plan.skippedNoReference.length > 0 && (
              <span className="text-amber-600"> Skipped (no reference): {plan.skippedNoReference.join(', ')}</span>
            )}
          </div>
        )}

        {/* Anchors */}
        <div className="flex items-center gap-1.5">
          <label className={labelCls}>{isGeneral ? 'Σreps, week' : 'Max, week'}</label>
          <input type="number" min={1} max={lastWeek} value={fromWeek}
            onChange={e => setFromWeek(parseInt(e.target.value) || 1)} className={`${inputCls} w-[46px]`} />
          <span className="text-gray-400">=</span>
          <input type="number" step={isGeneral ? 10 : 2.5} value={fromValue}
            onChange={e => setFromValue(parseFloat(e.target.value) || 0)} className={`${inputCls} w-[62px]`} />
          <span className="text-gray-400">→</span>
          <input type="number" min={1} max={lastWeek} value={toWeek}
            onChange={e => setToWeek(parseInt(e.target.value) || 1)} className={`${inputCls} w-[46px]`} />
          <span className="text-gray-400">=</span>
          <input type="number" step={isGeneral ? 10 : 2.5} value={toValue}
            onChange={e => setToValue(parseFloat(e.target.value) || 0)} className={`${inputCls} w-[62px]`} />
          <span className="text-[10px] text-gray-400">{valueUnitLabel}</span>
        </div>

        {/* Reps + mirror (exercise targets only) */}
        {!isGeneral && (
          <>
            <div className="flex items-center gap-1.5">
              <label className={`${labelCls} flex items-center gap-1`}>
                <input type="checkbox" checked={fillReps} onChange={e => setFillReps(e.target.checked)} />
                Reps
              </label>
              <input type="number" value={repsFrom} disabled={!fillReps}
                onChange={e => setRepsFrom(parseInt(e.target.value) || 0)} className={`${inputCls} w-[52px] disabled:opacity-40`} />
              <span className="text-gray-400">→</span>
              <input type="number" value={repsTo} disabled={!fillReps}
                onChange={e => setRepsTo(parseInt(e.target.value) || 0)} className={`${inputCls} w-[52px] disabled:opacity-40`} />
              <span className="text-[10px] text-gray-400">per week, same anchor weeks</span>
            </div>
            <div className="flex items-center gap-1.5">
              <label className={`${labelCls} flex items-center gap-1`}>
                <input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} />
                Mirror avg
              </label>
              <input type="number" value={mirrorPct} disabled={!mirror}
                onChange={e => setMirrorPct(parseFloat(e.target.value) || 0)} className={`${inputCls} w-[52px] disabled:opacity-40`} />
              <span className="text-[10px] text-gray-400">% below max</span>
            </div>
          </>
        )}

        {/* Rhythm */}
        <div className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-text-tertiary)]">
          Rhythm
        </div>
        <div className="flex items-center gap-2">
          <label className={labelCls}>Preset</label>
          <select
            value={rhythm.id}
            onChange={e => selectRhythm(e.target.value)}
            className={`${inputCls} max-w-[200px]`}
          >
            {rhythmPresets.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {onEditPresets && (
            <button
              onClick={onEditPresets}
              className="text-[10px] text-[color:var(--color-accent)] hover:underline"
              title="Create and edit your saved rhythm presets"
            >
              edit presets…
            </button>
          )}
        </div>
        <div className="text-[9px] text-[color:var(--color-text-tertiary)] pl-[94px]">
          top = load % · bottom = reps % of trend · tweaks apply to this fill only
        </div>
        <div className="flex flex-wrap gap-1 pl-[94px]">
          {rhythm.mode === 'weektype'
            ? weekTypes.map(t => {
                const m = rhythm.mult?.[t.abbreviation] ?? { load: 100, reps: 100 };
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
                {(rhythm.pattern ?? []).map((st, i) => {
                  const stampAbbr = rhythm.stampTypes?.[i] ?? null;
                  return (
                    <div key={i} className="flex flex-col items-center border rounded px-0.5 py-0.5 bg-gray-50" style={stampAbbr ? { borderColor: wtColor(stampAbbr) } : { borderColor: '#cbd5e1' }}>
                      <input type="number" value={st.load}
                        onChange={e => setPatternStep(i, 'load', parseFloat(e.target.value) || 100)}
                        className="no-spin w-[44px] text-center text-[11px] font-bold bg-transparent outline-none" />
                      <input type="number" value={st.reps}
                        onChange={e => setPatternStep(i, 'reps', parseFloat(e.target.value) || 100)}
                        className="no-spin w-[44px] text-center text-[10px] text-gray-500 bg-transparent outline-none border-t border-dotted border-gray-300" />
                      {stampAbbr
                        ? <span className="text-[8px] font-bold text-white rounded px-1" style={{ backgroundColor: wtColor(stampAbbr) }}>{stampAbbr}</span>
                        : <span className="text-[8px] text-gray-300">·</span>}
                    </div>
                  );
                })}
                <button onClick={addPatternStep} className="w-6 self-stretch border border-dashed border-gray-300 rounded text-gray-400 hover:text-gray-600" title="Add step">+</button>
                {(rhythm.pattern?.length ?? 0) > 1 && (
                  <button onClick={removePatternStep} className="w-6 self-stretch border border-dashed border-gray-300 rounded text-gray-400 hover:text-gray-600" title="Remove last step">−</button>
                )}
              </>
            )}
        </div>

        {/* Stamp + overwrite + rounding */}
        {hasStamps && (
          <div className="flex items-center gap-1.5 pl-[94px]">
            <input type="checkbox" id="fg-stamp" checked={stamp} disabled={!canStamp}
              onChange={e => setStamp(e.target.checked)} />
            <label htmlFor="fg-stamp" className={`text-[11px] ${canStamp ? 'text-[color:var(--color-text-secondary)]' : 'text-gray-300'}`}>
              Also stamp week types onto weeks
            </label>
          </div>
        )}
        {missingStampTypes.length > 0 && (
          <div className="text-[10px] text-amber-600 pl-[94px]">
            Stamp disabled — preset uses week type(s) "{missingStampTypes.join(', ')}" not in your configuration.
          </div>
        )}
        <div className="flex items-center gap-1.5 pl-[94px]">
          <input type="checkbox" id="fg-overwrite" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
          <label htmlFor="fg-overwrite" className="text-[11px] text-[color:var(--color-text-secondary)]">
            Overwrite existing values
          </label>
        </div>
        {!isGeneral && (
          <div className="flex items-center gap-2">
            <label className={labelCls}>Round loads to</label>
            <select value={loadRoundingKg} onChange={e => setLoadRoundingKg(parseFloat(e.target.value))} className={inputCls}>
              <option value={2.5}>2,5 kg</option>
              <option value={1}>1 kg</option>
              <option value={5}>5 kg</option>
            </select>
          </div>
        )}

        {/* Apply */}
        <div className="flex items-center gap-2 pt-1.5 border-t border-gray-100">
          <button
            onClick={handleApply}
            disabled={plan.cellCount === 0 || applying}
            className="px-3 py-1 rounded text-white text-[11.5px] font-medium bg-[var(--color-accent)] disabled:opacity-40"
          >
            {applying ? 'Applying…' : `Apply → table (${plan.cellCount})`}
          </button>
          <button onClick={onClose} className="px-3 py-1 rounded border border-gray-300 text-[11.5px] text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          {plan.cellCount === 0 && (
            <span className="text-[10px] text-[color:var(--color-text-tertiary)]">
              {!isAll && !isGeneral && effectiveUnit === 'pct' && !(referenceKg && referenceKg > 0)
                ? 'No reference set — enter one above'
                : plan.skippedExisting > 0
                ? 'All weeks in range already have values — tick Overwrite'
                : 'Nothing to fill — check the anchors'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

