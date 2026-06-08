// The left configuration rail. Reads top-to-bottom in query order:
// Scope → Subjects → Normalize → Rows → Columns → Filters → Limit → Measures →
// Compare → View → Overlay. Every control mutates the builder state; the result
// pane re-renders from runAnalysisQuery. All "pick one of N" controls use the
// shared SegmentedControl (consistent + accessible).

import { useState } from 'react';
import type { ReactNode } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { Select, SegmentedControl } from '../../ui';
import type { Agg, Dimension, Filter, MeasureState, MetricDef, Normalization, VizType } from '../../../lib/analysis';
import { DIMENSIONS, dimLabel } from './dimensions';
import type { BuilderState, ScopeMode } from './builderState';

interface NamedEntity {
  id: string;
  name: string;
}

interface ConfigRailProps {
  state: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  metrics: MetricDef[];
  athletes: NamedEntity[];
  groups: NamedEntity[];
  availableValues: Record<string, string[]>;
  vizOptions: { id: VizType; label: string }[];
}

const NORMALIZATION_OPTIONS: { id: Normalization; label: string; hint: string }[] = [
  { id: 'none', label: 'Off', hint: 'Raw values' },
  { id: 'perAthleteMean', label: 'Mean=100', hint: 'Each athlete indexed to their own mean — fair for any metric' },
  { id: 'perBodyweight', label: '÷ kg', hint: 'Per kilogram of bodyweight' },
  { id: 'sinclair', label: 'Sinclair', hint: 'Performance/max metrics only — needs athlete sex (sign-off)' },
];

const SCOPE_PRESETS: { mode: ScopeMode; windowDays?: number; label: string }[] = [
  { mode: 'rolling', windowDays: 28, label: '4w' },
  { mode: 'rolling', windowDays: 56, label: '8w' },
  { mode: 'rolling', windowDays: 84, label: '12w' },
  { mode: 'ytd', label: 'YTD' },
  { mode: 'custom', label: 'Custom' },
];

const COMPARE_OPTIONS: { id: MeasureState; label: string; title: string }[] = [
  { id: 'performed', label: 'Performed', title: 'What the athlete actually did' },
  { id: 'planned', label: 'Planned', title: 'What the coach prescribed' },
  { id: 'both', label: 'Both', title: 'Planned and performed side by side' },
  { id: 'delta', label: 'Δ', title: 'Performed − planned' },
  { id: 'adherence', label: 'Adherence', title: 'Performed ÷ planned' },
];

const AGG_OPTIONS: Agg[] = ['sum', 'avg', 'max', 'min', 'count', 'distinct'];
const NUMERIC_DIMS = new Set<string>(['relativeWeek', 'day', 'dayOfWeek', 'intensityZone']);
const isNumericDim = (d: string) => NUMERIC_DIMS.has(d) || d.startsWith('custom:');

/** The measure value-key that Top-N / a single-facet read should rank by. */
function primaryFacet(compare: MeasureState): string {
  return compare === 'both' ? 'performed' : compare;
}

export function ConfigRail({ state, set, metrics, athletes, groups, availableValues, vizOptions }: ConfigRailProps) {
  const usedDims = new Set<string>([...state.rows, ...state.cols]);
  const athleteName = (id: string) => athletes.find((a) => a.id === id)?.name ?? id;
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? id;
  const multi = state.athleteIds.length > 1 || state.groupIds.length > 0;
  const metricById = (id: string) => metrics.find((m) => m.id === id);

  const filters = state.filters ?? [];
  const avail = availableValues ?? {};
  const filteredDims = new Set<string>(filters.map((f) => f.dimension));
  const filterableDims = [
    ...new Set<string>([...Object.keys(avail).filter((d) => (avail[d]?.length ?? 0) > 0), ...NUMERIC_DIMS, ...usedDims]),
  ].filter((d) => !filteredDims.has(d));

  const scopeValue = `${state.scopeMode}:${state.scopeMode === 'rolling' ? state.windowDays : ''}`;
  const limitDims = [...new Set<string>([...state.rows, ...state.cols])];
  const facet = primaryFacet(state.compare);

  const setMeasureAgg = (i: number, agg: Agg | undefined) =>
    set({ metrics: state.metrics.map((m, j) => (j === i ? { ...m, agg } : m)) });

  return (
    <div
      style={{
        width: 264,
        flexShrink: 0,
        borderRight: '0.5px solid var(--color-border-tertiary)',
        overflowY: 'auto',
        padding: 'var(--space-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-lg)',
      }}
    >
      <Section label="Scope">
        <SegmentedControl
          ariaLabel="Scope"
          value={scopeValue}
          options={SCOPE_PRESETS.map((p) => ({ id: `${p.mode}:${p.windowDays ?? ''}`, label: p.label }))}
          onChange={(id) => {
            const [mode, w] = id.split(':');
            set({ scopeMode: mode as ScopeMode, windowDays: w ? Number(w) : state.windowDays });
          }}
        />
        {state.scopeMode === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <input type="date" value={state.from} onChange={(e) => set({ from: e.target.value })} className="emos-input" style={dateInput} />
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-caption)' }}>to</span>
            <input type="date" value={state.to} onChange={(e) => set({ to: e.target.value })} className="emos-input" style={dateInput} />
          </div>
        )}
      </Section>

      <Section label="Subjects">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {state.groupIds.map((id) => (
            <Chip key={`g-${id}`} label={`▦ ${groupName(id)}`} onRemove={() => set({ groupIds: state.groupIds.filter((x) => x !== id) })} />
          ))}
          {state.athleteIds.map((id) => (
            <Chip key={`a-${id}`} label={athleteName(id)} onRemove={() => set({ athleteIds: state.athleteIds.filter((x) => x !== id) })} />
          ))}
        </div>
        <Select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('g:')) {
              const id = v.slice(2);
              if (!state.groupIds.includes(id)) set({ groupIds: [...state.groupIds, id] });
            } else if (v.startsWith('a:')) {
              const id = v.slice(2);
              if (!state.athleteIds.includes(id)) set({ athleteIds: [...state.athleteIds, id] });
            }
          }}
        >
          <option value="">+ Add subject…</option>
          {groups.length > 0 && (
            <optgroup label="Groups">
              {groups.filter((g) => !state.groupIds.includes(g.id)).map((g) => (
                <option key={g.id} value={`g:${g.id}`}>{g.name}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Athletes">
            {athletes.filter((a) => !state.athleteIds.includes(a.id)).map((a) => (
              <option key={a.id} value={`a:${a.id}`}>{a.name}</option>
            ))}
          </optgroup>
        </Select>
        {multi && (
          <p style={hint}>
            Comparing multiple athletes — add <strong>Athlete</strong> as a row/column to split them, and normalize below.
          </p>
        )}
      </Section>

      {multi && (
        <Section label="Normalize">
          <SegmentedControl
            ariaLabel="Normalization"
            value={state.normalization}
            options={NORMALIZATION_OPTIONS.map((o) => ({ id: o.id, label: o.label, title: o.hint }))}
            onChange={(id) => set({ normalization: id })}
          />
          <p style={hint}>{NORMALIZATION_OPTIONS.find((o) => o.id === state.normalization)?.hint}</p>
        </Section>
      )}

      <Section label="Rows">
        <ChipPicker selected={state.rows} onAdd={(d) => set({ rows: [...state.rows, d] })} onRemove={(d) => set({ rows: state.rows.filter((x) => x !== d) })} disabledIds={usedDims} />
      </Section>

      <Section label="Columns">
        <ChipPicker selected={state.cols} onAdd={(d) => set({ cols: [...state.cols, d] })} onRemove={(d) => set({ cols: state.cols.filter((x) => x !== d) })} disabledIds={usedDims} />
      </Section>

      <Section label="Filters">
        {filters.map((f, i) => (
          <FilterRow
            key={`${f.dimension}-${i}`}
            filter={f}
            options={avail[f.dimension] ?? []}
            onChange={(nf) => set({ filters: filters.map((x, j) => (j === i ? nf : x)) })}
            onRemove={() => set({ filters: filters.filter((_, j) => j !== i) })}
          />
        ))}
        <Select
          value=""
          onChange={(e) => {
            const d = e.target.value as Dimension;
            if (!d) return;
            const nf: Filter = isNumericDim(d) ? { dimension: d, op: 'between', min: 0, max: 100 } : { dimension: d, op: 'in', values: [] };
            set({ filters: [...filters, nf] });
          }}
        >
          <option value="">+ Add filter…</option>
          {filterableDims.map((d) => (
            <option key={d} value={d}>{dimLabel(d)}</option>
          ))}
        </Select>
        {filterableDims.length === 0 && filters.length === 0 && (
          <p style={hint}>Filters narrow which exercises, categories, etc. are included — useful when a chart has too many.</p>
        )}
      </Section>

      {limitDims.length > 0 && (
        <Section label="Limit (Top-N)">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select
              value={state.topN?.dimension ?? ''}
              onChange={(e) => {
                const d = e.target.value as Dimension;
                if (!d) return set({ topN: undefined });
                set({ topN: { dimension: d, measureKey: `${state.metrics[0]?.id ?? 'volume'}::${facet}`, n: state.topN?.n ?? 10, dir: state.topN?.dir ?? 'desc' } });
              }}
            >
              <option value="">No limit</option>
              {limitDims.map((d) => (
                <option key={d} value={d}>{dimLabel(d)}</option>
              ))}
            </Select>
            {state.topN && (
              <>
                <input
                  type="number"
                  min={1}
                  value={state.topN.n}
                  onChange={(e) => set({ topN: { ...state.topN!, n: Math.max(1, Number(e.target.value) || 1) } })}
                  className="emos-input"
                  style={{ ...dateInput, width: 56, flex: 'none' }}
                  aria-label="Top N count"
                />
                <Select
                  value={state.topN.measureKey}
                  onChange={(e) => set({ topN: { ...state.topN!, measureKey: e.target.value } })}
                >
                  {state.metrics.map((m) => (
                    <option key={m.id} value={`${m.id}::${facet}`}>by {metricById(m.id)?.label ?? m.id}</option>
                  ))}
                </Select>
                <SegmentedControl<'asc' | 'desc'>
                  ariaLabel="Top or bottom"
                  value={state.topN.dir}
                  options={[{ id: 'desc', label: 'Top' }, { id: 'asc', label: 'Bottom' }]}
                  onChange={(dir) => set({ topN: { ...state.topN!, dir } })}
                />
              </>
            )}
          </div>
        </Section>
      )}

      <Section label="Measures">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          {state.metrics.map((m, i) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Chip label={metricById(m.id)?.label ?? m.id} onRemove={() => set({ metrics: state.metrics.filter((_, j) => j !== i) })} />
              <select
                value={m.agg ?? ''}
                onChange={(e) => setMeasureAgg(i, (e.target.value || undefined) as Agg | undefined)}
                aria-label={`Aggregation for ${metricById(m.id)?.label ?? m.id}`}
                style={aggSelect}
              >
                <option value="">{metricById(m.id)?.defaultAgg ?? 'sum'} (default)</option>
                {AGG_OPTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <Select
          value=""
          onChange={(e) => {
            if (e.target.value) set({ metrics: [...state.metrics, { id: e.target.value }] });
          }}
        >
          <option value="">+ Add measure…</option>
          {metrics.filter((m) => !state.metrics.some((x) => x.id === m.id)).map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </Select>
      </Section>

      <Section label="Compare">
        <SegmentedControl
          ariaLabel="Compare planned vs performed"
          value={state.compare}
          options={COMPARE_OPTIONS}
          onChange={(id) => set({ compare: id })}
        />
      </Section>

      {vizOptions.length > 1 && (
        <Section label="View">
          <SegmentedControl ariaLabel="Chart type" value={state.vizType} options={vizOptions.map((v) => ({ id: v.id, label: v.label }))} onChange={(id) => set({ vizType: id })} />
        </Section>
      )}

      {state.vizType !== 'table' && (
        <Section label="Overlay">
          <button
            type="button"
            aria-pressed={state.comparePrevious}
            onClick={() => set({ comparePrevious: !state.comparePrevious })}
            className="emos-btn"
            style={{
              ...optionRow,
              width: '100%',
              background: state.comparePrevious ? 'var(--color-accent-muted)' : 'transparent',
              color: state.comparePrevious ? 'var(--color-accent-hover)' : 'var(--color-text-secondary)',
              border: state.comparePrevious ? '0.5px solid var(--color-accent-border)' : '0.5px solid var(--color-border-tertiary)',
              transition: 'background var(--transition-base), color var(--transition-base), border-color var(--transition-base)',
            }}
          >
            {state.comparePrevious ? '✓ ' : ''}Previous period (ghost)
          </button>
        </Section>
      )}
    </div>
  );
}

// ── building blocks ────────────────────────────────────────────────────────

function Section({ label, children, defaultOpen = true }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const storeKey = `emos.analysis.section.${label}`;
  const [open, setOpen] = useState(() => {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(storeKey) : null;
    return v == null ? defaultOpen : v === '1';
  });
  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      try { localStorage.setItem(storeKey, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: 0, marginBottom: open ? 8 : 0, cursor: 'pointer' }}
      >
        <span style={{ fontSize: 'var(--text-caption)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{label}</span>
        <ChevronDown size={12} style={{ color: 'var(--color-text-tertiary)', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform var(--transition-base)' }} />
      </button>
      {open && children}
    </div>
  );
}

function ChipPicker({ selected, onAdd, onRemove, disabledIds }: { selected: Dimension[]; onAdd: (d: Dimension) => void; onRemove: (d: Dimension) => void; disabledIds: Set<string> }) {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: selected.length ? 6 : 0 }}>
        {selected.map((d) => (
          <Chip key={d} label={dimLabel(d)} onRemove={() => onRemove(d)} />
        ))}
      </div>
      <Select value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value as Dimension); }}>
        <option value="">+ Add dimension…</option>
        {DIMENSIONS.filter((d) => !disabledIds.has(d.id)).map((d) => (
          <option key={d.id} value={d.id}>{d.section}: {d.label}</option>
        ))}
      </Select>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span style={chip}>
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} style={chipX}>
        <X size={11} />
      </button>
    </span>
  );
}

/** Handles both `in` (searchable value chips) and `between` (numeric range). */
function FilterRow({ filter, options, onChange, onRemove }: { filter: Filter; options: string[]; onChange: (f: Filter) => void; onRemove: () => void }) {
  const [search, setSearch] = useState('');
  const label = dimLabel(filter.dimension);
  return (
    <div style={{ marginBottom: 8, border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--radius-md)', padding: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
          {label}
          {filter.op === 'in' && filter.values.length ? ` · ${filter.values.length}` : ''}
        </span>
        <button type="button" onClick={onRemove} aria-label={`Remove ${label} filter`} style={chipX}>
          <X size={11} />
        </button>
      </div>
      {filter.op === 'between' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="number" value={filter.min} onChange={(e) => onChange({ ...filter, min: Number(e.target.value) || 0 })} className="emos-input" style={{ ...dateInput, flex: 1 }} aria-label={`${label} min`} />
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-caption)' }}>–</span>
          <input type="number" value={filter.max} onChange={(e) => onChange({ ...filter, max: Number(e.target.value) || 0 })} className="emos-input" style={{ ...dateInput, flex: 1 }} aria-label={`${label} max`} />
        </div>
      ) : (
        <>
          {options.length > 8 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="emos-input"
              style={{ ...dateInput, width: '100%', marginBottom: 4 }}
            />
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 132, overflowY: 'auto' }}>
            {options
              .filter((v) => !search || v.toLowerCase().includes(search.toLowerCase()))
              .map((v) => {
                const on = filter.op === 'in' && filter.values.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      if (filter.op !== 'in') return;
                      onChange({ ...filter, values: on ? filter.values.filter((x) => x !== v) : [...filter.values, v] });
                    }}
                    className="emos-btn"
                    style={{
                      padding: '2px 6px',
                      fontSize: 'var(--text-caption)',
                      borderRadius: 'var(--radius-sm)',
                      background: on ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
                      color: on ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
                      border: '0.5px solid var(--color-border-tertiary)',
                      transition: 'background var(--transition-fast), color var(--transition-fast)',
                    }}
                  >
                    {v}
                  </button>
                );
              })}
          </div>
          {filter.op === 'in' && filter.values.length === 0 && <p style={{ ...hint, marginTop: 4 }}>None selected = all included.</p>}
        </>
      )}
    </div>
  );
}

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 6px 3px 8px',
  background: 'var(--color-bg-secondary)',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-primary)',
};

const chipX: React.CSSProperties = {
  display: 'flex',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--color-text-tertiary)',
  padding: 0,
};

const dateInput: React.CSSProperties = {
  height: 28,
  padding: '4px 6px',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-caption)',
  fontFamily: 'var(--font-sans)',
  color: 'var(--color-text-primary)',
  background: 'var(--color-bg-primary)',
  flex: 1,
  minWidth: 0,
};

const aggSelect: React.CSSProperties = {
  height: 24,
  padding: '0 4px',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-caption)',
  fontFamily: 'var(--font-sans)',
  color: 'var(--color-text-secondary)',
  background: 'var(--color-bg-primary)',
  cursor: 'pointer',
};

const optionRow: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-label)',
  cursor: 'pointer',
};

const hint: React.CSSProperties = {
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-tertiary)',
  marginTop: 6,
  lineHeight: 1.4,
};
