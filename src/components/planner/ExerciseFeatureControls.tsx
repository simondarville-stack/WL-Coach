/**
 * Exercise-feature UI for planner day cards:
 *
 *  - AnalysisColumn — the compact per-exercise analysis block on the right of
 *    each row (R / S / Hi / Ø from the cached summary_*), plus the "+" feature
 *    menu in the row's upper-right corner. Derived values are grey and
 *    passive; the Σ / Ø override features turn their value accent-coloured
 *    and editable in place.
 *  - FeatureChips — the athlete-visible duration chips under the
 *    prescription (⏱ total time, ⏸ rest between sets).
 *
 * Editing follows the house gestures everywhere (same as PrescriptionGrid):
 * click +1 · right-click −1 · Ctrl+click type · Del-held+click removes the
 * feature.
 */
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Exercise, PlannedExercise } from '../../lib/database.types';
import type { ExerciseFeatures } from '../../lib/exerciseFeatures';
import { formatSeconds, parseTimeInput, timeEditValue } from '../../lib/exerciseFeatures';
import { useDeleteHeld } from '../../hooks/useDeleteHeld';

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

/** One editable feature value with the house gestures. */
function GestureValue({
  display,
  editValue,
  title,
  accent,
  onStep,
  onCommit,
  onRemove,
}: {
  display: string;
  editValue: string;
  title: string;
  accent: boolean;
  onStep: (delta: number) => void;
  onCommit: (text: string) => void;
  onRemove: () => void;
}) {
  const deleteHeld = useDeleteHeld();
  const [editing, setEditing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing != null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing != null]);

  if (editing != null) {
    return (
      <input
        ref={inputRef}
        value={editing}
        size={3}
        onChange={e => setEditing(e.target.value)}
        onBlur={() => { onCommit(editing.trim()); setEditing(null); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onCommit(editing.trim()); setEditing(null); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null); }
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
        if (e.ctrlKey || e.metaKey) { setEditing(editValue); return; }
        onStep(e.button === 2 ? -1 : 1);
      }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      onClick={e => e.stopPropagation()}
      tabIndex={-1}
      title={deleteHeld ? 'Click to remove this feature' : `${title} · click +1 · right-click −1 · Ctrl+click type · Del-held removes`}
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

interface AnalysisColumnProps {
  ex: PlannedExercise & { exercise: Exercise };
  /** Row hover state — the "+" only surfaces on hover to keep rows clean. */
  rowHovered: boolean;
  onSaveFeatures: (features: ExerciseFeatures) => void;
  /** Extra "+"-menu entries the parent contributes (e.g. the load sign,
   *  which edits the prescription rather than the features bag). */
  extraMenuItems?: FeatureMenuItem[];
}

/**
 * R / S / Hi / Ø in four small rows on the right of a planner exercise row,
 * with the "+" feature menu in the upper-right corner.
 */
export function AnalysisColumn({ ex, rowHovered, onSaveFeatures, extraMenuItems = [] }: AnalysisColumnProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const features: ExerciseFeatures = ex.metadata?.features ?? {};
  const isPct = ex.unit === 'percentage';
  const unitSuffix = isPct ? '%' : '';

  // Close the menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const patchFeatures = (patch: Partial<Record<keyof ExerciseFeatures, number | undefined>>) => {
    const next: ExerciseFeatures = { ...features };
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) delete next[k as keyof ExerciseFeatures];
      else next[k as keyof ExerciseFeatures] = v;
    }
    onSaveFeatures(next);
  };

  const menuItems: FeatureMenuItem[] = [
    ...extraMenuItems,
    ...(features.totalTime == null ? [{
      key: 'totalTime', icon: '⏱', label: 'Total time',
      onAdd: () => patchFeatures({ totalTime: 600 }),
    }] : []),
    ...(features.restTime == null ? [{
      key: 'restTime', icon: '⏸', label: 'Rest time',
      onAdd: () => patchFeatures({ restTime: 120 }),
    }] : []),
    ...(features.totalReps == null ? [{
      key: 'totalReps', icon: 'Σ', label: 'Total reps — overwrites summation',
      onAdd: () => patchFeatures({ totalReps: ex.summary_total_reps ?? 0 }),
    }] : []),
    ...(features.avgLoad == null ? [{
      key: 'avgLoad', icon: 'Ø', label: 'Avg load — overwrites',
      onAdd: () => patchFeatures({ avgLoad: ex.summary_avg_load ?? ex.summary_highest_load ?? 0 }),
    }] : []),
  ];

  const rows: Array<{ label: string; value: string; override?: { key: 'totalReps' | 'avgLoad'; current: number; step: number; title: string; parse: (t: string) => number | null } }> = [
    {
      label: 'R',
      value: fmtNum(ex.summary_total_reps),
      ...(features.totalReps != null ? {
        override: {
          key: 'totalReps' as const, current: features.totalReps, step: 1,
          title: 'Total reps override — overwrites the summation',
          parse: (t: string) => { const n = parseInt(t, 10); return isNaN(n) || n < 0 ? null : n; },
        },
      } : {}),
    },
    { label: 'S', value: fmtNum(ex.summary_total_sets) },
    { label: 'Hi', value: ex.summary_highest_load != null ? fmtNum(ex.summary_highest_load) + unitSuffix : '—' },
    {
      label: 'Ø',
      value: ex.summary_avg_load != null ? fmtNum(ex.summary_avg_load) + unitSuffix : '—',
      ...(features.avgLoad != null ? {
        override: {
          key: 'avgLoad' as const, current: features.avgLoad, step: 1,
          title: 'Avg load override — overwrites',
          parse: (t: string) => { const n = parseFloat(t.replace('%', '').replace(',', '.')); return isNaN(n) || n < 0 ? null : n; },
        },
      } : {}),
    },
  ];

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
      {/* "+" — the feature menu, upper-right corner of the row */}
      <button
        onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
        title="Add exercise feature"
        style={{
          position: 'absolute', top: 0, right: 0, width: 14, height: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', background: 'none', cursor: 'pointer', padding: 0,
          color: 'var(--color-text-tertiary)', borderRadius: 3,
          opacity: menuOpen || (rowHovered && menuItems.length > 0) ? 1 : 0,
          transition: 'opacity 0.1s',
        }}
      >
        <Plus size={10} />
      </button>
      {menuOpen && (
        <div
          style={{
            position: 'absolute', top: 15, right: 0, zIndex: 30, minWidth: 190,
            background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border-primary)',
            boxShadow: '0 4px 14px rgba(20,30,45,0.13)', padding: 3,
          }}
        >
          {menuItems.map(item => (
            <button
              key={item.key}
              onClick={e => { e.stopPropagation(); item.onAdd(); setMenuOpen(false); }}
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
          {menuItems.length === 0 && (
            <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
              All features added
            </div>
          )}
        </div>
      )}

      <div style={{ height: 12 }} />{/* clearance under the + corner */}
      {rows.map(row => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 3 }}>
          <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>{row.label}</span>
          {row.override ? (
            <GestureValue
              display={row.value}
              editValue={String(row.override.current)}
              title={row.override.title}
              accent
              onStep={d => patchFeatures({ [row.override!.key]: Math.max(0, row.override!.current + d * row.override!.step) })}
              onCommit={t => { const n = row.override!.parse(t); if (n != null) patchFeatures({ [row.override!.key]: n }); }}
              onRemove={() => patchFeatures({ [row.override!.key]: undefined })}
            />
          ) : (
            <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{row.value}</span>
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
  if (active.length === 0) return null;
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
              onStep={d => save(c.key, Math.max(c.minSec, sec + d * step))}
              onCommit={t => { const parsed = parseTimeInput(t); if (parsed != null) save(c.key, parsed); }}
              onRemove={() => save(c.key, undefined)}
            />
          </div>
        );
      })}
    </div>
  );
}
