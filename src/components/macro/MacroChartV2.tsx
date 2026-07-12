/**
 * MacroChartV2 — the macro-cycle chart, rebuilt to match the fill-guide
 * prototype (mockup/macro-fill-guide-v5.html) in look, feel and mechanics.
 *
 * Core difference from the retired Recharts chart: dragging is POSITION-based.
 * The dragged point sits under the cursor — value = yInverse(pointerY),
 * snapped (2,5 kg loads, integer reps, 0,1 t tonnage) — instead of mapping a
 * mouse delta onto a scaled range. Axis domains freeze while a drag is live so
 * the chart never shifts under the pointer, and re-fit on release.
 *
 * The table stays the single source of truth: drags preview via local
 * overrides and write exactly once on pointer-up through the same mutation
 * callbacks the table uses.
 *
 * Series: per-exercise Max (solid, draggable) and Avg (dashed, hollow dots,
 * draggable; Ctrl+drag on Max moves both by the same delta), grouped reps bars
 * on the right axis (draggable tops), faded actuals, the week-level general
 * targets (Σreps / tonnage in t / avg intensity — draggable, exercise-
 * independent), the fill-guide ghost overlay, and the guide's ◆ ramp anchors
 * (dragging them reshapes the pending fill live).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MacroCompetition,
  MacroTarget,
  MacroTrackedExerciseWithExercise,
  MacroWeek,
  WeekTypeConfig,
} from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';
import type { FillGuidePreview } from './fillGuidePlan';
import { getExerciseCategoryShade } from '../../lib/colorUtils';
import { getWeekTypeColor } from '../../lib/weekUtils';

interface MacroChartV2Props {
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  competitions: MacroCompetition[];
  actuals: MacroActualsMap;
  weekTypes: WeekTypeConfig[];
  showReps: boolean;
  visibleGeneralSeries?: Set<string>;
  fillPreview?: FillGuidePreview | null;
  focusedExerciseId?: string | null;
  onDragTarget: (weekId: string, trackedExId: string, field: keyof MacroTarget, value: number) => Promise<void>;
  onDragWeekTarget?: (
    weekId: string,
    field: 'total_reps_target' | 'tonnage_target' | 'avg_intensity_target',
    value: number,
  ) => Promise<void>;
  /** Drag a fill-guide ◆ anchor — kg flows back into the guide's inputs. */
  onDragAnchor?: (which: 'from' | 'to', kg: number) => void;
}

const H = 320;
const PAD_T = 12;
const PAD_B = 36;
const PAD_L = 40;

const GENERAL = {
  k: { label: 'Σreps target', color: '#334155', axis: 'reps' as const, field: 'total_reps_target' as const, snap: (v: number) => Math.round(v), toKg: (v: number) => Math.round(v) },
  tonnage: { label: 'Ton target (t)', color: '#B45309', axis: 'reps' as const, field: 'tonnage_target' as const, snap: (v: number) => Math.round(v * 10) / 10, toKg: (v: number) => Math.round(v * 10) * 100 },
  avg: { label: 'Avg int. target', color: '#0F766E', axis: 'kg' as const, field: 'avg_intensity_target' as const, snap: (v: number) => Math.round(v), toKg: (v: number) => Math.round(v) },
} as const;
type GeneralKey = keyof typeof GENERAL;

const fmt = (n: number): string => (Math.round(n * 10) / 10).toString().replace('.', ',');
const snapKg = (v: number) => Math.round(v / 2.5) * 2.5;

type SeriesKind = 'max' | 'avg' | 'reps';

interface DragInfo {
  kind: 'exercise' | 'general' | 'anchor';
  series?: SeriesKind;
  weekId?: string;
  teId?: string;
  genKey?: GeneralKey;
  anchorWhich?: 'from' | 'to';
  startValue?: number;
  /** Ctrl+drag on Max: avg start value, moved by the same delta. */
  ctrlAvgStart?: number | null;
  /** Link drag: teId → start value for every other visible exercise at this week. */
  linkStarts?: Record<string, number>;
  frozen: { kgMin: number; kgMax: number; repsMax: number };
}

export function MacroChartV2({
  macroWeeks,
  trackedExercises,
  targets,
  competitions,
  actuals,
  weekTypes,
  showReps,
  visibleGeneralSeries,
  fillPreview,
  focusedExerciseId,
  onDragTarget,
  onDragWeekTarget,
  onDragAnchor,
}: MacroChartV2Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(720);
  const [avgLines, setAvgLines] = useState(true);
  const [linkDrag, setLinkDrag] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const dragRef = useRef<DragInfo | null>(null);
  // Removes the window listeners of a live drag; used by unmount cleanup so a
  // drag never leaks listeners past the component's life.
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(480, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const weeks = useMemo(
    () => [...macroWeeks].sort((a, b) => a.week_number - b.week_number),
    [macroWeeks],
  );

  const getColor = useCallback(
    (te: MacroTrackedExerciseWithExercise) =>
      getExerciseCategoryShade(te.exercise.id, te.exercise.color, te.exercise.category, trackedExercises),
    [trackedExercises],
  );

  const targetMap = useMemo(() => {
    const m = new Map<string, MacroTarget>();
    for (const t of targets) m.set(`${t.macro_week_id}|${t.tracked_exercise_id}`, t);
    return m;
  }, [targets]);

  const oKey = (weekId: string, series: string) => `${weekId}|${series}`;

  const getExValue = useCallback((weekId: string, teId: string, series: SeriesKind): number | null => {
    const ov = overrides[oKey(weekId, `${series}:${teId}`)];
    if (ov !== undefined) return ov;
    const t = targetMap.get(`${weekId}|${teId}`);
    if (!t) return null;
    return series === 'max' ? t.target_max : series === 'avg' ? t.target_avg : t.target_reps;
  }, [overrides, targetMap]);

  const getGenValue = useCallback((week: MacroWeek, gk: GeneralKey): number | null => {
    const ov = overrides[oKey(week.id, `g:${gk}`)];
    if (ov !== undefined) return ov;
    const raw = week[GENERAL[gk].field];
    if (raw == null) return null;
    return gk === 'tonnage' ? raw / 1000 : raw;
  }, [overrides]);

  const generalKeys = (Object.keys(GENERAL) as GeneralKey[]).filter(k => visibleGeneralSeries?.has(k));
  const repsAxisOn = (showReps && trackedExercises.length > 0)
    || generalKeys.includes('k') || generalKeys.includes('tonnage');
  const padR = repsAxisOn ? 40 : 14;
  const plotW = width - PAD_L - padR;
  const plotH = H - PAD_T - PAD_B;

  // ── axis domains — auto-fit, frozen while dragging ──────────────────────────
  const domains = useMemo(() => {
    const kg: number[] = [];
    const reps: number[] = [];
    for (const w of weeks) {
      for (const te of trackedExercises) {
        const mx = getExValue(w.id, te.id, 'max');
        const av = getExValue(w.id, te.id, 'avg');
        const rp = getExValue(w.id, te.id, 'reps');
        if (mx != null && mx > 0) kg.push(mx);
        if (avgLines && av != null && av > 0) kg.push(av);
        if (rp != null && rp > 0) reps.push(rp);
        const act = actuals[w.id]?.[te.exercise_id];
        if (act?.maxWeight) kg.push(act.maxWeight);
        const pv = fillPreview?.byTrackedEx?.[te.id]?.[w.id];
        if (pv?.max != null) kg.push(pv.max);
        if (avgLines && pv?.avg != null) kg.push(pv.avg);
      }
      for (const gk of generalKeys) {
        const v = getGenValue(w, gk);
        if (v != null && v > 0) (GENERAL[gk].axis === 'kg' ? kg : reps).push(v);
      }
      const pk = fillPreview?.totalReps?.[w.id];
      if (pk != null && generalKeys.includes('k')) reps.push(pk);
    }
    if (fillPreview?.anchors) kg.push(fillPreview.anchors.fromKg, fillPreview.anchors.toKg);

    let kgMin = 50, kgMax = 150;
    if (kg.length > 0) {
      const lo = Math.min(...kg), hi = Math.max(...kg);
      const range = Math.max(20, hi - lo);
      kgMin = Math.max(0, Math.floor((lo - range * 0.12) / 10) * 10);
      kgMax = Math.ceil((hi + range * 0.08) / 10) * 10;
      if (kgMax - kgMin < 30) kgMax = kgMin + 30;
    }
    const repsMax = reps.length > 0 ? Math.max(10, Math.ceil((Math.max(...reps) * 1.15) / 5) * 5) : 40;
    return { kgMin, kgMax, repsMax };
  }, [weeks, trackedExercises, getExValue, getGenValue, generalKeys, actuals, fillPreview, avgLines]);

  const active = dragRef.current?.frozen ?? domains;
  const { kgMin, kgMax, repsMax } = active;

  const n = weeks.length;
  const x = useCallback((i: number) => (n <= 1 ? PAD_L + plotW / 2 : PAD_L + (i * plotW) / (n - 1)), [n, plotW]);
  const yKg = useCallback((v: number) => PAD_T + ((kgMax - v) / (kgMax - kgMin)) * plotH, [kgMin, kgMax, plotH]);
  const yReps = useCallback((v: number) => PAD_T + ((repsMax - v) / repsMax) * plotH, [repsMax, plotH]);

  // ── drag mechanics — the point follows the pointer ──────────────────────────
  const beginDrag = useCallback((e: React.PointerEvent, info: Omit<DragInfo, 'frozen'>) => {
    // Left/primary pointer only (right-click must not drag or write), and one
    // drag at a time (a second touch must not hijack a live drag).
    if (e.button !== 0 || !e.isPrimary) return;
    if (dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const pointerId = e.pointerId;
    const drag: DragInfo = { ...info, frozen: { ...domains } };
    dragRef.current = drag;

    const yToKg = (clientY: number): number => {
      const rect = svgRef.current!.getBoundingClientRect();
      const raw = drag.frozen.kgMax - ((clientY - rect.top - PAD_T) / plotH) * (drag.frozen.kgMax - drag.frozen.kgMin);
      return Math.min(drag.frozen.kgMax, Math.max(drag.frozen.kgMin, raw));
    };
    const yToReps = (clientY: number): number => {
      const rect = svgRef.current!.getBoundingClientRect();
      const raw = drag.frozen.repsMax - ((clientY - rect.top - PAD_T) / plotH) * drag.frozen.repsMax;
      return Math.min(drag.frozen.repsMax, Math.max(0, raw));
    };

    const applyMove = (ev: PointerEvent): Record<string, number> => {
      const next: Record<string, number> = {};
      if (drag.kind === 'anchor') {
        const kg = snapKg(yToKg(ev.clientY));
        onDragAnchor?.(drag.anchorWhich!, kg);
        setTooltip({ x: ev.clientX, y: ev.clientY, text: `${fmt(kg)} kg` });
        return next;
      }
      if (drag.kind === 'general') {
        const cfg = GENERAL[drag.genKey!];
        const v = cfg.snap(cfg.axis === 'kg' ? yToKg(ev.clientY) : yToReps(ev.clientY));
        next[oKey(drag.weekId!, `g:${drag.genKey}`)] = v;
        setTooltip({ x: ev.clientX, y: ev.clientY, text: `${fmt(v)}${drag.genKey === 'tonnage' ? ' t' : drag.genKey === 'avg' ? ' kg' : ''}` });
        return next;
      }
      // exercise series
      if (drag.series === 'reps') {
        const v = Math.round(yToReps(ev.clientY));
        next[oKey(drag.weekId!, `reps:${drag.teId}`)] = v;
        setTooltip({ x: ev.clientX, y: ev.clientY, text: `${v} reps` });
        return next;
      }
      const kg = snapKg(yToKg(ev.clientY));
      next[oKey(drag.weekId!, `${drag.series}:${drag.teId}`)] = kg;
      const delta = kg - (drag.startValue ?? kg);
      if (drag.series === 'max' && drag.ctrlAvgStart != null) {
        next[oKey(drag.weekId!, `avg:${drag.teId}`)] = Math.max(0, snapKg(drag.ctrlAvgStart + delta));
      }
      if (drag.series === 'max' && drag.linkStarts) {
        for (const [otherId, start] of Object.entries(drag.linkStarts)) {
          next[oKey(drag.weekId!, `max:${otherId}`)] = Math.max(0, snapKg(start + delta));
        }
      }
      setTooltip({ x: ev.clientX, y: ev.clientY, text: `${fmt(kg)} kg` });
      return next;
    };

    // A click without movement must not write — otherwise a hand-entered
    // off-grid value (117) would get snap-rewritten (117,5) by a stray click.
    let moved = false;

    const removeListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      dragCleanupRef.current = null;
    };
    // Single exit point. write=false (cancel / plain click) discards the
    // preview; write=true commits every overridden key exactly once.
    const finish = (write: boolean, ev?: PointerEvent) => {
      removeListeners();
      dragRef.current = null;
      if (!write || !moved || !ev) {
        setTooltip(null);
        setOverrides({});
        return;
      }
      // applyMove re-shows the tooltip as a side effect — clear AFTER it,
      // otherwise the value bubble sticks on screen forever post-drag.
      const finalValues = applyMove(ev);
      setTooltip(null);
      const writes: Promise<void>[] = [];
      for (const [key, value] of Object.entries(finalValues)) {
        const [weekId, series] = key.split('|');
        if (series.startsWith('g:')) {
          const gk = series.slice(2) as GeneralKey;
          writes.push(onDragWeekTarget?.(weekId, GENERAL[gk].field, GENERAL[gk].toKg(value)) ?? Promise.resolve());
        } else {
          const [kind, teId] = series.split(':');
          const field: keyof MacroTarget = kind === 'max' ? 'target_max' : kind === 'avg' ? 'target_avg' : 'target_reps';
          writes.push(onDragTarget(weekId, teId, field, value));
        }
      }
      void Promise.all(writes).finally(() => setOverrides({}));
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // Lost pointerup (e.g. released outside the window on some platforms):
      // a mouse moving with no button down is not a drag — end without writing.
      if (ev.pointerType === 'mouse' && ev.buttons === 0) {
        finish(false);
        return;
      }
      moved = true;
      const next = applyMove(ev);
      if (Object.keys(next).length > 0) setOverrides(prev => ({ ...prev, ...next }));
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      finish(true, ev);
    };
    // pointercancel ends a touch WITHOUT a pointerup (notification, rotation,
    // palm rejection) — discard the drag instead of leaking listeners.
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      finish(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    dragCleanupRef.current = removeListeners;
  }, [domains, plotH, onDragAnchor, onDragTarget, onDragWeekTarget]);

  const startExerciseDrag = (e: React.PointerEvent, weekId: string, teId: string, series: SeriesKind) => {
    const startValue = getExValue(weekId, teId, series) ?? 0;
    const ctrlAvgStart = series === 'max' && (e.ctrlKey || e.metaKey)
      ? getExValue(weekId, teId, 'avg')
      : null;
    const linkStarts: Record<string, number> | undefined =
      series === 'max' && linkDrag
        ? Object.fromEntries(
            trackedExercises
              .filter(te => te.id !== teId)
              .map(te => [te.id, getExValue(weekId, te.id, 'max')] as const)
              .filter((entry): entry is [string, number] => entry[1] != null),
          )
        : undefined;
    beginDrag(e, { kind: 'exercise', series, weekId, teId, startValue, ctrlAvgStart, linkStarts });
  };

  // ── geometry helpers for series paths ───────────────────────────────────────
  const linePoints = (vals: Array<number | null>, yScale: (v: number) => number): string =>
    vals
      .map((v, i) => (v != null ? `${x(i)},${yScale(v)}` : null))
      .filter((p): p is string => p !== null)
      .join(' ');

  const wtAbbr = (wt: string): string => {
    const cfg = weekTypes.find(t => t.abbreviation === wt || t.name.toLowerCase() === wt.toLowerCase());
    return cfg?.abbreviation ?? (wt ? wt.slice(0, 2).toLowerCase() : '');
  };

  const compMarkers = useMemo(() => competitions.map(comp => {
    const idx = weeks.findIndex(w => {
      const start = new Date(w.week_start).getTime();
      const cd = new Date(comp.competition_date).getTime();
      return cd >= start && cd <= start + 6 * 86400000;
    });
    return idx >= 0 ? { idx, name: comp.competition_name, isPrimary: comp.is_primary } : null;
  }).filter((m): m is NonNullable<typeof m> => m !== null), [competitions, weeks]);

  if (weeks.length === 0) {
    return <div className="flex items-center justify-center h-32 text-sm text-gray-400">No weeks to display.</div>;
  }

  // kg gridline step: aim for ~5 lines
  const kgSpan = kgMax - kgMin;
  const kgStep = kgSpan <= 60 ? 10 : kgSpan <= 120 ? 20 : kgSpan <= 200 ? 30 : 50;
  const kgTicks: number[] = [];
  for (let v = Math.ceil(kgMin / kgStep) * kgStep; v <= kgMax; v += kgStep) kgTicks.push(v);
  // Dedupe — small domains can round two fractions onto the same tick value
  const repsTicks = Array.from(new Set([0, 0.25, 0.5, 0.75, 1].map(f => Math.round((repsMax * f) / 5) * 5)));

  const barGroupW = n > 1 ? Math.min((x(1) - x(0)) * 0.55, trackedExercises.length * 9) : 24;
  const barW = trackedExercises.length > 0 ? Math.max(2, barGroupW / trackedExercises.length) : 0;

  const anchors = fillPreview?.anchors ?? null;
  const anchorWeekIdx = (weekNumber: number) => weeks.findIndex(w => w.week_number === weekNumber);

  return (
    <div ref={containerRef} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* Header: legend chips + options — mirrors the prototype */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50 flex-wrap gap-2">
        <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
          {trackedExercises.map(te => (
            <span key={te.id} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(te) }} />
              <span className="font-medium" style={{ color: getColor(te) }}>
                {te.exercise.exercise_code || te.exercise.name}
              </span>
            </span>
          ))}
          {generalKeys.map(gk => (
            <span key={gk} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: GENERAL[gk].color }} />
              <span className="font-medium" style={{ color: GENERAL[gk].color }}>{GENERAL[gk].label}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-600">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={avgLines} onChange={e => setAvgLines(e.target.checked)} />
            avg lines
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none" title="Dragging a Max point moves every visible exercise by the same delta at that week">
            <input type="checkbox" checked={linkDrag} onChange={e => setLinkDrag(e.target.checked)} />
            <span className="font-medium">link drag</span>
          </label>
        </div>
      </div>
      <div className="px-3 pt-1 text-[10px] text-gray-400">
        Drag points to write into the table — snaps to 2,5 kg · Ctrl+drag moves Max &amp; Avg together{fillPreview?.anchors ? ' · drag the ◆ anchors to reshape the pending fill' : ''}
      </div>

      <svg ref={svgRef} width={width} height={H} className="block select-none" style={{ touchAction: 'none' }}>
        {/* Week-type background bands */}
        {weeks.map((w, i) => {
          const x0 = i === 0 ? PAD_L : (x(i - 1) + x(i)) / 2;
          const x1 = i === n - 1 ? width - padR : (x(i) + x(i + 1)) / 2;
          return (
            <rect key={w.id} x={x0} y={PAD_T} width={Math.max(0, x1 - x0)} height={plotH}
              fill={getWeekTypeColor(w.week_type, weekTypes)} opacity={0.07} />
          );
        })}

        {/* kg gridlines + labels (left) */}
        {kgTicks.map(v => (
          <g key={`kg${v}`}>
            <line x1={PAD_L} y1={yKg(v)} x2={width - padR} y2={yKg(v)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PAD_L - 5} y={yKg(v) + 4} textAnchor="end" fontSize={10} fill="#94a3b8">{v}</text>
          </g>
        ))}
        {/* reps axis labels (right) */}
        {repsAxisOn && repsTicks.map(v => (
          <text key={`rp${v}`} x={width - padR + 6} y={yReps(v) + 4} fontSize={10} fill="#94a3b8">{v}</text>
        ))}
        {repsAxisOn && (
          <text x={width - padR + 6} y={PAD_T + 2} fontSize={9} fill="#94a3b8" fontStyle="italic">reps</text>
        )}

        {/* x labels: week number + type abbreviation */}
        {weeks.map((w, i) => (
          <g key={`xl${w.id}`}>
            <text x={x(i)} y={H - 20} textAnchor="middle" fontSize={10} fill="#4b5563">{w.week_number}</text>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={8}
              fill={getWeekTypeColor(w.week_type, weekTypes)} fontWeight={700}>
              {wtAbbr(w.week_type)}
            </text>
          </g>
        ))}

        {/* Competition markers */}
        {compMarkers.map((m, i) => (
          <g key={`cm${i}`}>
            <line x1={x(m.idx)} y1={PAD_T} x2={x(m.idx)} y2={PAD_T + plotH}
              stroke={m.isPrimary ? '#dc2626' : '#f59e0b'} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.7} />
            <text x={x(m.idx) + 3} y={PAD_T + 10} fontSize={9} fill={m.isPrimary ? '#dc2626' : '#f59e0b'}>
              {m.name}
            </text>
          </g>
        ))}

        {/* Reps bars — grouped per exercise, draggable tops */}
        {showReps && trackedExercises.map((te, ti) => {
          const color = getColor(te);
          return weeks.map((w, i) => {
            const v = getExValue(w.id, te.id, 'reps');
            if (v == null || v <= 0) return null;
            const bx = x(i) - barGroupW / 2 + ti * barW;
            return (
              <rect
                key={`b${te.id}${w.id}`}
                x={bx} y={yReps(v)} width={Math.max(1, barW - 1)} height={Math.max(0, yReps(0) - yReps(v))}
                fill={color} opacity={0.28} rx={1.5}
                style={{ cursor: 'ns-resize' }}
                onPointerDown={e => startExerciseDrag(e, w.id, te.id, 'reps')}
              >
                <title>{`${te.exercise.exercise_code || te.exercise.name} W${w.week_number}: ${v} reps — drag to adjust`}</title>
              </rect>
            );
          });
        })}

        {/* Actual lines (faded) — performed max, and performed avg when avg lines are on */}
        {trackedExercises.flatMap(te => {
          const color = getColor(te);
          return (['maxWeight', 'avgWeight'] as const)
            .filter(k => k === 'maxWeight' || avgLines)
            .map(k => {
              const vals = weeks.map(w => actuals[w.id]?.[te.exercise_id]?.[k] || null);
              const pts = linePoints(vals, yKg);
              return pts.split(' ').length > 1 ? (
                <polyline key={`act-${k}-${te.id}`} points={pts} fill="none"
                  stroke={color} strokeWidth={1} strokeDasharray="3 2" opacity={0.25} />
              ) : null;
            });
        })}

        {/* Avg lines — dashed, hollow draggable dots */}
        {avgLines && trackedExercises.map(te => {
          const color = getColor(te);
          const vals = weeks.map(w => getExValue(w.id, te.id, 'avg'));
          return (
            <g key={`avg${te.id}`}>
              <polyline points={linePoints(vals, yKg)} fill="none"
                stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.55} />
              {weeks.map((w, i) => vals[i] != null && (
                <circle key={w.id} cx={x(i)} cy={yKg(vals[i]!)} r={3.5}
                  fill="#fff" stroke={color} strokeWidth={1.4}
                  style={{ cursor: 'ns-resize' }}
                  onPointerDown={e => startExerciseDrag(e, w.id, te.id, 'avg')}
                >
                  <title>{`${te.exercise.exercise_code || te.exercise.name} W${w.week_number} avg: ${fmt(vals[i]!)} kg — drag to adjust`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {/* Max lines — solid, draggable dots */}
        {trackedExercises.map(te => {
          const color = getColor(te);
          const focused = focusedExerciseId === te.id;
          const vals = weeks.map(w => getExValue(w.id, te.id, 'max'));
          return (
            <g key={`max${te.id}`}>
              <polyline points={linePoints(vals, yKg)} fill="none"
                stroke={color} strokeWidth={focused ? 2.6 : 1.8} />
              {weeks.map((w, i) => vals[i] != null && (
                <circle key={w.id} cx={x(i)} cy={yKg(vals[i]!)} r={5.5}
                  fill={color} stroke="#fff" strokeWidth={1.5}
                  style={{ cursor: 'ns-resize' }}
                  onPointerDown={e => startExerciseDrag(e, w.id, te.id, 'max')}
                >
                  <title>{`${te.exercise.exercise_code || te.exercise.name} W${w.week_number} max: ${fmt(vals[i]!)} kg — drag (Ctrl = with avg)`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {/* General week-level series — draggable, exercise-independent */}
        {generalKeys.map(gk => {
          const cfg = GENERAL[gk];
          const yScale = cfg.axis === 'kg' ? yKg : yReps;
          const vals = weeks.map(w => getGenValue(w, gk));
          return (
            <g key={`g${gk}`}>
              <polyline points={linePoints(vals, yScale)} fill="none" stroke={cfg.color} strokeWidth={1.8} />
              {weeks.map((w, i) => vals[i] != null && (
                <circle key={w.id} cx={x(i)} cy={yScale(vals[i]!)} r={4.5}
                  fill={cfg.color} stroke="#fff" strokeWidth={1.5}
                  style={{ cursor: onDragWeekTarget ? 'ns-resize' : 'default' }}
                  onPointerDown={onDragWeekTarget
                    ? e => beginDrag(e, { kind: 'general', weekId: w.id, genKey: gk, startValue: vals[i]! })
                    : undefined}
                >
                  <title>{`${cfg.label} W${w.week_number}: ${fmt(vals[i]!)} — drag to adjust`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {/* Fill-guide ghost overlay — dashed lines + hollow dots */}
        {fillPreview && trackedExercises.map(te => {
          const cells = fillPreview.byTrackedEx?.[te.id];
          if (!cells) return null;
          const color = getColor(te);
          const maxVals = weeks.map(w => cells[w.id]?.max ?? null);
          const avgVals = weeks.map(w => cells[w.id]?.avg ?? null);
          return (
            <g key={`pv${te.id}`} pointerEvents="none">
              <polyline points={linePoints(maxVals, yKg)} fill="none"
                stroke={color} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.65} />
              {avgLines && (
                <polyline points={linePoints(avgVals, yKg)} fill="none"
                  stroke={color} strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
              )}
              {weeks.map((w, i) => maxVals[i] != null && (
                <circle key={w.id} cx={x(i)} cy={yKg(maxVals[i]!)} r={3.5}
                  fill="#fff" stroke={color} strokeWidth={1.3} opacity={0.75} />
              ))}
            </g>
          );
        })}
        {fillPreview && generalKeys.includes('k') && (() => {
          const vals = weeks.map(w => fillPreview.totalReps?.[w.id] ?? null);
          const pts = linePoints(vals, yReps);
          return pts.split(' ').length > 1 ? (
            <polyline points={pts} fill="none" pointerEvents="none"
              stroke={GENERAL.k.color} strokeWidth={1.4} strokeDasharray="5 4" opacity={0.6} />
          ) : null;
        })()}

        {/* Fill-guide ◆ ramp anchors — drag to reshape the pending fill */}
        {anchors && onDragAnchor && (['from', 'to'] as const).map(which => {
          const weekNumber = which === 'from' ? anchors.fromWeekNumber : anchors.toWeekNumber;
          const kg = which === 'from' ? anchors.fromKg : anchors.toKg;
          const idx = anchorWeekIdx(weekNumber);
          if (idx < 0) return null;
          const ax = x(idx), ay = yKg(kg);
          return (
            <path
              key={`anchor-${which}`}
              d={`M ${ax} ${ay - 8} L ${ax + 8} ${ay} L ${ax} ${ay + 8} L ${ax - 8} ${ay} Z`}
              fill="var(--color-accent)" stroke="#fff" strokeWidth={1.5}
              style={{ cursor: 'ns-resize' }}
              onPointerDown={e => beginDrag(e, { kind: 'anchor', anchorWhich: which })}
            >
              <title>{`Ramp anchor (${which === 'from' ? 'start' : 'end'}): W${weekNumber} = ${fmt(kg)} kg — drag to reshape`}</title>
            </path>
          );
        })}
      </svg>

      {/* Drag value bubble — follows the pointer */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900 text-white text-[11px] px-2 py-1 rounded shadow-lg"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
