/**
 * Exercise-feature UI for planner day cards:
 *
 *  - AnalysisColumn — the compact per-exercise analysis block on the right of
 *    each row (R / S / Hi / Ø from the cached summary_*), plus the "+" feature
 *    menu in the row's upper-right corner. Derived values are grey; their
 *    override features turn the value accent-coloured and editable in place.
 *    Ctrl+click on a grey value adds its override and opens the edit directly.
 *  - FeatureChips — the athlete-visible duration chips under the
 *    prescription (⏱ total time, ⏸ rest between sets).
 *
 * Editing follows the house gestures everywhere (same as PrescriptionGrid):
 * click +1 · right-click −1 · Ctrl+click type · Del-held+click removes the
 * feature.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Plus, Eye, EyeOff } from 'lucide-react';
import type { AthleteHiddenKey, Exercise, PlannedExercise } from '../../lib/database.types';
import type { ExerciseFeatures } from '../../lib/exerciseFeatures';
import { formatSeconds, parseTimeInput, timeEditValue, parseTempoInput } from '../../lib/exerciseFeatures';
import { useDeleteHeld } from '../../hooks/useDeleteHeld';
import { useRepeatOnHold } from '../../hooks/useRepeatOnHold';

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

/** One editable feature value with the house gestures. `editOnClick` is for
 *  non-steppable values (e.g. the tempo tuple): a plain click opens the edit
 *  instead of stepping. */
function GestureValue({
  display,
  editValue,
  title,
  accent,
  onStep,
  onCommit,
  onRemove,
  editOnClick = false,
  initialEditing,
  onEditClosed,
}: {
  display: string;
  editValue: string;
  title: string;
  accent: boolean;
  /** Return false when the value cannot move (already at its floor) — the
   *  hold-to-repeat ends there instead of spinning on a clamped number. */
  onStep: (delta: number) => boolean | void;
  onCommit: (text: string) => void;
  onRemove: () => void;
  editOnClick?: boolean;
  /** Mount straight into the edit input with this seed text (Ctrl+click on
   *  a passive summary value adds the override and opens the edit at once). */
  initialEditing?: string;
  onEditClosed?: () => void;
}) {
  const deleteHeld = useDeleteHeld();
  const [editing, setEditing] = useState<string | null>(initialEditing ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  // These step in whole minutes (⏱) and whole reps (Σ), so the repeat runs
  // slower than the grid's — 11/s, not 20/s.
  const hold = useRepeatOnHold({ interval: 160, minInterval: 90 });
  // The repeat re-runs this on a timer; onStep closes over the CURRENT value,
  // so it must be re-read each tick or every step of a hold would add 1 to the
  // same starting number.
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  useEffect(() => {
    if (editing != null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing != null]);

  const closeEdit = (commitText?: string) => {
    if (commitText != null) onCommit(commitText);
    setEditing(null);
    onEditClosed?.();
  };

  if (editing != null) {
    return (
      <input
        ref={inputRef}
        value={editing}
        size={3}
        onChange={e => setEditing(e.target.value)}
        onBlur={() => closeEdit(editing.trim())}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); closeEdit(editing.trim()); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEdit(); }
        }}
        onClick={e => e.stopPropagation()}
        style={{
          width: '2.6rem', fontSize: 10, textAlign: 'right', border: 'none', outline: 'none',
          borderRadius: 3, background: 'var(--color-accent-muted, var(--color-bg-secondary))',
          color: 'var(--color-text-primary)', padding: '0 2px',
        }}
      />
    );
  }

  return (
    <button
      onMouseDown={e => {
        if (e.button !== 0 && e.button !== 2) return;
        e.preventDefault();
        e.stopPropagation();
        if (deleteHeld) { onRemove(); return; }
        if (editOnClick || e.ctrlKey || e.metaKey) { setEditing(editValue); return; }
        const delta = e.button === 2 ? -1 : 1;
        hold.start(() => onStepRef.current(delta));
      }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      onClick={e => e.stopPropagation()}
      tabIndex={-1}
      title={deleteHeld
        ? 'Click to remove this feature'
        : editOnClick
        ? `${title} · click to type · Del-held removes`
        : `${title} · click +1 · right-click −1 · hold to repeat · Ctrl+click type · Del-held removes`}
      style={{
        border: 'none', background: 'none', cursor: 'pointer', padding: '0 2px',
        borderRadius: 3, fontSize: 10, lineHeight: 1.4, fontWeight: 600,
        color: deleteHeld ? 'var(--color-danger-text)' : accent ? 'var(--color-accent)' : 'var(--color-text-secondary)',
      }}
    >
      {display}
    </button>
  );
}

export interface FeatureMenuItem {
  key: string;
  icon: string;
  label: string;
  onAdd: () => void;
}

/** Athlete-visibility toggles surfaced by the eye menu, in display order. */
const EYE_ITEMS: Array<{ key: AthleteHiddenKey; label: string }> = [
  { key: 'prescription', label: 'Prescription' },
  { key: 'belowTopSet', label: 'Sets below top set' },
  { key: 'durations', label: '⏱ ⏸ ⧖ timing' },
  { key: 'note', label: 'Note' },
];

interface AnalysisColumnProps {
  ex: PlannedExercise & { exercise: Exercise };
  /** Row hover state — the corner icons only surface on hover. */
  rowHovered: boolean;
  onSaveFeatures: (features: ExerciseFeatures) => void;
  /** Extra "+"-menu entries the parent contributes (e.g. the load sign,
   *  which edits the prescription rather than the features bag). */
  extraFeatureItems?: FeatureMenuItem[];
  /** "#" menu — apply-preset entries, Save as preset…, Manage presets…. */
  presetItems?: FeatureMenuItem[];
  /** Eye menu — what the athlete app shows for this row. */
  visibility?: { hidden: AthleteHiddenKey[]; onToggle: (key: AthleteHiddenKey) => void };
  /** Render the R/S/Hi/Ø values. false = corner icons only (per-exercise
   *  "Individual Exercise Summary in the planner" toggle). */
  showSummary?: boolean;
}

type CornerMenu = 'features' | 'presets' | 'eye';

/**
 * The right-hand column of a planner exercise row: R / S / Hi / Ø summary
 * values (optional per exercise) under a three-icon corner strip —
 * + exercise features · # presets · eye athlete visibility.
 */
export function AnalysisColumn({
  ex,
  rowHovered,
  onSaveFeatures,
  extraFeatureItems = [],
  presetItems = [],
  visibility,
  showSummary = true,
}: AnalysisColumnProps) {
  const [openMenu, setOpenMenu] = useState<CornerMenu | null>(null);
  // Ctrl+click on a passive summary value adds its override and should land
  // straight in the edit input once the override renders.
  const [autoEdit, setAutoEdit] = useState<'totalReps' | 'totalSets' | 'highestLoad' | 'avgLoad' | null>(null);
  const features: ExerciseFeatures = ex.metadata?.features ?? {};
  const isPct = ex.unit === 'percentage';
  const unitSuffix = isPct ? '%' : '';

  // Close any menu on an outside click.
  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenu]);

  // Numeric-feature patcher for the summary overrides and durations; tempo
  // (a string) goes through onSaveFeatures directly.
  const patchFeatures = (patch: Partial<Record<'totalTime' | 'restTime' | 'totalReps' | 'totalSets' | 'highestLoad' | 'avgLoad', number | undefined>>) => {
    const next: ExerciseFeatures = { ...features };
    for (const [k, v] of Object.entries(patch)) {
      const key = k as 'totalTime' | 'restTime' | 'totalReps' | 'totalSets' | 'highestLoad' | 'avgLoad';
      if (v == null) delete next[key];
      else next[key] = v;
    }
    onSaveFeatures(next);
  };

  const featureItems: FeatureMenuItem[] = [
    ...extraFeatureItems,
    ...(features.totalTime == null ? [{
      key: 'totalTime', icon: '⏱', label: 'Total time',
      onAdd: () => patchFeatures({ totalTime: 600 }),
    }] : []),
    ...(features.restTime == null ? [{
      key: 'restTime', icon: '⏸', label: 'Rest time',
      onAdd: () => patchFeatures({ restTime: 120 }),
    }] : []),
    ...(features.tempo == null ? [{
      key: 'tempo', icon: '⧖', label: 'Tempo (TUT)',
      onAdd: () => onSaveFeatures({ ...features, tempo: '3-0-1-0' }),
    }] : []),
    ...(features.totalReps == null ? [{
      key: 'totalReps', icon: 'Σ', label: 'Total reps — overwrites summation',
      onAdd: () => patchFeatures({ totalReps: ex.summary_total_reps ?? 0 }),
    }] : []),
    ...(features.totalSets == null ? [{
      key: 'totalSets', icon: 'S', label: 'Total sets — overwrites summation',
      onAdd: () => patchFeatures({ totalSets: ex.summary_total_sets ?? 0 }),
    }] : []),
    ...(features.highestLoad == null ? [{
      key: 'highestLoad', icon: 'Hi', label: 'Highest load — overwrites',
      onAdd: () => patchFeatures({ highestLoad: ex.summary_highest_load ?? 0 }),
    }] : []),
    ...(features.avgLoad == null ? [{
      key: 'avgLoad', icon: 'Ø', label: 'Avg load — overwrites',
      onAdd: () => patchFeatures({ avgLoad: ex.summary_avg_load ?? ex.summary_highest_load ?? 0 }),
    }] : []),
  ];

  const parseCount = (t: string) => { const n = parseInt(t, 10); return isNaN(n) || n < 0 ? null : n; };
  const parseLoad = (t: string) => { const n = parseFloat(t.replace('%', '').replace(',', '.')); return isNaN(n) || n < 0 ? null : n; };

  // Every summary row is overridable: `active` is the override value when the
  // feature is on, `seed` is what Ctrl+click on the passive value starts from.
  const rows: Array<{
    label: string; value: string;
    key: 'totalReps' | 'totalSets' | 'highestLoad' | 'avgLoad';
    active: number | null; seed: number; step: number; title: string;
    parse: (t: string) => number | null;
  }> = [
    {
      label: 'R', key: 'totalReps',
      value: fmtNum(ex.summary_total_reps),
      active: features.totalReps ?? null, seed: ex.summary_total_reps ?? 0, step: 1,
      title: 'Total reps override — overwrites the summation',
      parse: parseCount,
    },
    {
      label: 'S', key: 'totalSets',
      value: fmtNum(ex.summary_total_sets),
      active: features.totalSets ?? null, seed: ex.summary_total_sets ?? 0, step: 1,
      title: 'Total sets override — overwrites the summation',
      parse: parseCount,
    },
    {
      label: 'Hi', key: 'highestLoad',
      value: ex.summary_highest_load != null ? fmtNum(ex.summary_highest_load) + unitSuffix : '—',
      active: features.highestLoad ?? null, seed: ex.summary_highest_load ?? 0, step: 1,
      title: 'Highest load override — overwrites',
      parse: parseLoad,
    },
    {
      label: 'Ø', key: 'avgLoad',
      value: ex.summary_avg_load != null ? fmtNum(ex.summary_avg_load) + unitSuffix : '—',
      active: features.avgLoad ?? null, seed: ex.summary_avg_load ?? ex.summary_highest_load ?? 0, step: 1,
      title: 'Avg load override — overwrites',
      parse: parseLoad,
    },
  ];

  const menuBoxStyle: CSSProperties = {
    position: 'absolute', top: 15, right: 0, zIndex: 30, minWidth: 190,
    background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border-primary)',
    boxShadow: '0 4px 14px rgba(20,30,45,0.13)', padding: 3,
  };

  function cornerButton(menu: CornerMenu, title: string, icon: ReactNode, active = false) {
    return (
      <button
        onClick={e => { e.stopPropagation(); setOpenMenu(o => (o === menu ? null : menu)); }}
        title={title}
        style={{
          width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', background: openMenu === menu ? 'var(--color-bg-secondary)' : 'none',
          cursor: 'pointer', padding: 0, borderRadius: 3,
          color: active ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
        }}
      >
        {icon}
      </button>
    );
  }

  function renderItemMenu(items: FeatureMenuItem[], emptyText: string) {
    return (
      <div style={menuBoxStyle}>
        {items.map(item => (
          <button
            key={item.key}
            onClick={e => { e.stopPropagation(); item.onAdd(); setOpenMenu(null); }}
            style={{
              display: 'flex', gap: 6, width: '100%', textAlign: 'left',
              border: 'none', background: 'none', padding: '4px 8px',
              borderRadius: 3, cursor: 'pointer', fontSize: 11,
              color: 'var(--color-text-primary)', alignItems: 'center',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
          >
            <span style={{ width: 14, color: 'var(--color-text-tertiary)', fontSize: 10 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
        {items.length === 0 && (
          <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            {emptyText}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative', flexShrink: 0, width: 52, alignSelf: 'stretch',
        borderLeft: '0.5px solid var(--color-border-tertiary)',
        paddingLeft: 5, display: 'flex', flexDirection: 'column', gap: 0,
      }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      draggable={false}
      onDragStart={e => e.preventDefault()}
    >
      {/* Corner icon strip: + features · # presets · eye athlete visibility */}
      <div
        style={{
          position: 'absolute', top: 0, right: 0, display: 'flex', gap: 1,
          opacity: openMenu != null || rowHovered ? 1 : 0,
          transition: 'opacity 0.1s',
        }}
      >
        {featureItems.length > 0 && cornerButton('features', 'Add exercise feature', <Plus size={10} />)}
        {presetItems.length > 0 && cornerButton('presets', 'Presets — apply, save, manage', <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1 }}>#</span>)}
        {visibility && cornerButton(
          'eye',
          'Athlete visibility — choose what this row shows in the athlete app',
          visibility.hidden.length > 0 ? <EyeOff size={10} /> : <Eye size={10} />,
          visibility.hidden.length > 0,
        )}
      </div>
      {openMenu === 'features' && renderItemMenu(featureItems, 'All features added')}
      {openMenu === 'presets' && renderItemMenu(presetItems, 'No presets yet')}
      {openMenu === 'eye' && visibility && (
        <div style={menuBoxStyle}>
          <div style={{ padding: '2px 8px 3px', fontSize: 9, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Athlete sees
          </div>
          {EYE_ITEMS.map(item => {
            const isHidden = visibility.hidden.includes(item.key);
            return (
              <button
                key={item.key}
                onClick={e => { e.stopPropagation(); visibility.onToggle(item.key); }}
                style={{
                  display: 'flex', gap: 6, width: '100%', textAlign: 'left',
                  border: 'none', background: 'none', padding: '4px 8px',
                  borderRadius: 3, cursor: 'pointer', fontSize: 11, alignItems: 'center',
                  color: isHidden ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                title={isHidden ? 'Hidden from the athlete — click to show' : 'Visible to the athlete — click to hide'}
              >
                <span style={{ width: 14, display: 'flex', color: isHidden ? 'var(--color-text-tertiary)' : 'var(--color-accent)' }}>
                  {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
                </span>
                <span style={{ textDecoration: isHidden ? 'line-through' : 'none' }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ height: 12 }} />{/* clearance under the corner strip */}
      {showSummary && rows.map(row => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 3 }}>
          <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>{row.label}</span>
          {row.active != null ? (
            <GestureValue
              display={row.value}
              editValue={String(row.active)}
              title={row.title}
              accent
              initialEditing={autoEdit === row.key ? String(row.active) : undefined}
              onEditClosed={() => setAutoEdit(a => (a === row.key ? null : a))}
              onStep={d => {
                const next = Math.max(0, row.active! + d * row.step);
                if (next === row.active) return false;
                patchFeatures({ [row.key]: next });
              }}
              onCommit={t => { const n = row.parse(t); if (n != null) patchFeatures({ [row.key]: n }); }}
              onRemove={() => { setAutoEdit(a => (a === row.key ? null : a)); patchFeatures({ [row.key]: undefined }); }}
            />
          ) : (
            <span
              title={`${row.title} · Ctrl+click to overwrite`}
              onMouseDown={e => {
                if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
                e.preventDefault();
                e.stopPropagation();
                setAutoEdit(row.key);
                patchFeatures({ [row.key]: row.seed });
              }}
              style={{ fontSize: 10, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}
            >
              {row.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

interface FeatureChipsProps {
  features: ExerciseFeatures;
  onSaveFeatures: (features: ExerciseFeatures) => void;
}

/** Time-valued feature chips shown under the prescription — the two
 *  duration features today: ⏱ totalTime, ⏸ restTime (seconds each).
 *  Athlete-visible prescription content. */
const TIME_CHIPS: Array<{ key: 'totalTime' | 'restTime'; icon: string; title: string; minSec: number }> = [
  { key: 'totalTime', icon: '⏱', title: 'Total time (minutes; append s for seconds)', minSec: 60 },
  { key: 'restTime', icon: '⏸', title: 'Rest between sets (minutes; append s for seconds)', minSec: 15 },
];

export function FeatureChips({ features, onSaveFeatures }: FeatureChipsProps) {
  const deleteHeld = useDeleteHeld();
  const active = TIME_CHIPS.filter(c => features[c.key] != null);
  if (active.length === 0 && features.tempo == null) return null;
  const save = (key: 'totalTime' | 'restTime', sec: number | undefined) => {
    const next: ExerciseFeatures = { ...features };
    if (sec == null) delete next[key]; else next[key] = sec;
    onSaveFeatures(next);
  };
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', flexWrap: 'wrap' }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      draggable={false}
      onDragStart={e => e.preventDefault()}
    >
      {active.map(c => {
        const sec = features[c.key] as number;
        // ⏱ steps in minutes; ⏸ rests are short — step in 15 s so "1′45″"
        // is reachable by clicking, not only by typing.
        const step = c.key === 'restTime' ? 15 : 60;
        return (
          <div key={c.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 9, color: deleteHeld ? 'var(--color-danger-text)' : 'var(--color-text-tertiary)' }}>{c.icon}</span>
            <GestureValue
              display={formatSeconds(sec)}
              editValue={timeEditValue(sec)}
              title={c.title}
              accent={false}
              onStep={d => {
                const next = Math.max(c.minSec, sec + d * step);
                if (next === sec) return false;
                save(c.key, next);
              }}
              onCommit={t => { const parsed = parseTimeInput(t); if (parsed != null) save(c.key, parsed); }}
              onRemove={() => save(c.key, undefined)}
            />
          </div>
        );
      })}
      {features.tempo != null && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 9, color: deleteHeld ? 'var(--color-danger-text)' : 'var(--color-text-tertiary)' }}>⧖</span>
          <GestureValue
            display={features.tempo}
            editValue={features.tempo.replace(/-/g, '')}
            title="Tempo (TUT) — eccentric · pause · concentric · pause; type 4 digits, e.g. 3120"
            accent={false}
            editOnClick
            onStep={() => {}}
            onCommit={t => {
              const v = parseTempoInput(t);
              if (v != null) onSaveFeatures({ ...features, tempo: v });
            }}
            onRemove={() => {
              const next = { ...features };
              delete next.tempo;
              onSaveFeatures(next);
            }}
          />
        </div>
      )}
    </div>
  );
}
