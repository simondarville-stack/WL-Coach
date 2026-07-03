/**
 * MacroViewMenu — "Table view" dropdown for the macro table.
 *
 * Governs the exercise-metric registry (order + visibility — the coach sets
 * the macro's detail level here), the two indicator tints, and collapse/expand
 * all. Clicks inside the menu do NOT close it (batch changes, then click
 * outside to dismiss — coach-confirmed interaction from the mockup).
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react';
import { Button } from '../ui';
import {
  EXERCISE_METRIC_LABELS,
  type ExerciseMetricConfig,
} from './MacroTableV2';

interface MacroViewMenuProps {
  metrics: ExerciseMetricConfig[];
  onMetricsChange: (metrics: ExerciseMetricConfig[]) => void;
  consistencyTint: boolean;
  onConsistencyTintChange: (v: boolean) => void;
  collapsedHeatmap: boolean;
  onCollapsedHeatmapChange: (v: boolean) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
}

export function MacroViewMenu({
  metrics,
  onMetricsChange,
  consistencyTint,
  onConsistencyTintChange,
  collapsedHeatmap,
  onCollapsedHeatmapChange,
  onCollapseAll,
  onExpandAll,
}: MacroViewMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click only — inside clicks keep the menu open for batching
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= metrics.length) return;
    const next = [...metrics];
    [next[i], next[j]] = [next[j], next[i]];
    onMetricsChange(next);
  };

  const toggle = (key: ExerciseMetricConfig['key'], on: boolean) => {
    if (!on && metrics.filter(m => m.on).length <= 1) return; // keep ≥1 visible
    onMetricsChange(metrics.map(m => (m.key === key ? { ...m, on } : m)));
  };

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <Button
        variant={open ? 'primary' : 'secondary'}
        size="sm"
        icon={<SlidersHorizontal size={12} />}
        onClick={() => setOpen(v => !v)}
        title="Exercise metrics, indicator tints, collapse/expand"
      >
        Table view
      </Button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-30 rounded-lg p-2 min-w-[220px]"
          style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)', boxShadow: '0 6px 20px rgba(15,40,70,.14)' }}
        >
          <div className="text-[9px] font-semibold uppercase tracking-wide px-1 mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Exercise metrics · this macro
          </div>
          {metrics.map((m, i) => (
            <div key={m.key} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-gray-50">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-primary)] disabled:opacity-20 p-0.5"
                title="Higher priority"
              >
                <ArrowUp size={10} />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === metrics.length - 1}
                className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-primary)] disabled:opacity-20 p-0.5"
                title="Lower priority"
              >
                <ArrowDown size={10} />
              </button>
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none" style={{ color: 'var(--color-text-secondary)' }}>
                <input type="checkbox" checked={m.on} onChange={e => toggle(m.key, e.target.checked)} />
                {EXERCISE_METRIC_LABELS[m.key]}
              </label>
            </div>
          ))}

          <div className="text-[9px] font-semibold uppercase tracking-wide px-1 mt-2 mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Indicators
          </div>
          <label className="flex items-center gap-1.5 px-1 py-0.5 text-[11px] cursor-pointer select-none rounded hover:bg-gray-50" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={consistencyTint} onChange={e => onConsistencyTintChange(e.target.checked)} />
            Σreps tint (target vs Σ exercise reps)
          </label>
          <label className="flex items-center gap-1.5 px-1 py-0.5 text-[11px] cursor-pointer select-none rounded hover:bg-gray-50" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={collapsedHeatmap} onChange={e => onCollapsedHeatmapChange(e.target.checked)} />
            Heatmap on collapsed columns
          </label>

          <div className="flex gap-1.5 mt-2 pt-1.5" style={{ borderTop: '0.5px solid var(--color-border-primary)' }}>
            <Button variant="secondary" size="sm" onClick={onCollapseAll}>Collapse all</Button>
            <Button variant="secondary" size="sm" onClick={onExpandAll}>Expand all</Button>
          </div>
        </div>
      )}
    </div>
  );
}
