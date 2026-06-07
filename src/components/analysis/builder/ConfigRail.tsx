// The left configuration rail. Reads top-to-bottom in query order:
// Scope → Subjects → Rows → Columns → Measures → Compare → View. Every control
// mutates the builder state; the result pane re-renders from runAnalysisQuery.

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Select } from '../../ui';
import type { Dimension, MeasureState, MetricDef, VizType } from '../../../lib/analysis';
import { DIMENSIONS, dimLabel } from './dimensions';
import type { BuilderState, ScopeMode } from './builderState';

interface ConfigRailProps {
  state: BuilderState;
  set: (patch: Partial<BuilderState>) => void;
  metrics: MetricDef[];
  subjectLabel: string;
  vizOptions: { id: VizType; label: string }[];
}

const SCOPE_PRESETS: { mode: ScopeMode; windowDays?: number; label: string }[] = [
  { mode: 'rolling', windowDays: 28, label: '4w' },
  { mode: 'rolling', windowDays: 56, label: '8w' },
  { mode: 'rolling', windowDays: 84, label: '12w' },
  { mode: 'ytd', label: 'YTD' },
  { mode: 'custom', label: 'Custom' },
];

const COMPARE_OPTIONS: { id: MeasureState; label: string; hint: string }[] = [
  { id: 'performed', label: 'Performed', hint: 'What the athlete actually did' },
  { id: 'planned', label: 'Planned', hint: 'What the coach prescribed' },
  { id: 'both', label: 'Both', hint: 'Planned and performed side by side' },
  { id: 'delta', label: 'Δ', hint: 'Performed − planned' },
  { id: 'adherence', label: 'Adherence', hint: 'Performed ÷ planned' },
];

export function ConfigRail({ state, set, metrics, subjectLabel, vizOptions }: ConfigRailProps) {
  const usedDims = new Set<string>([...state.rows, ...state.cols]);

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
        <Segmented
          options={SCOPE_PRESETS.map((p) => ({
            id: `${p.mode}:${p.windowDays ?? ''}`,
            label: p.label,
            active:
              p.mode === state.scopeMode &&
              (p.mode !== 'rolling' || p.windowDays === state.windowDays),
          }))}
          onSelect={(id) => {
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

      <Section label="Subject">
        <div style={{ ...chip, cursor: 'default' }}>{subjectLabel}</div>
        <p style={hint}>Multi-athlete &amp; group comparison comes from the header selector.</p>
      </Section>

      <Section label="Rows">
        <ChipPicker
          selected={state.rows}
          onAdd={(d) => set({ rows: [...state.rows, d] })}
          onRemove={(d) => set({ rows: state.rows.filter((x) => x !== d) })}
          disabledIds={usedDims}
        />
      </Section>

      <Section label="Columns">
        <ChipPicker
          selected={state.cols}
          onAdd={(d) => set({ cols: [...state.cols, d] })}
          onRemove={(d) => set({ cols: state.cols.filter((x) => x !== d) })}
          disabledIds={usedDims}
        />
      </Section>

      <Section label="Measures">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {state.metrics.map((id) => (
            <Chip key={id} label={metrics.find((m) => m.id === id)?.label ?? id} onRemove={() => set({ metrics: state.metrics.filter((x) => x !== id) })} />
          ))}
        </div>
        <Select
          value=""
          onChange={(e) => {
            if (e.target.value) set({ metrics: [...state.metrics, e.target.value] });
          }}
        >
          <option value="">+ Add measure…</option>
          {metrics
            .filter((m) => !state.metrics.includes(m.id))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
        </Select>
      </Section>

      <Section label="Compare">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {COMPARE_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => set({ compare: o.id })}
              title={o.hint}
              className="emos-btn"
              style={{
                ...optionRow,
                background: state.compare === o.id ? 'var(--color-accent-muted)' : 'transparent',
                color: state.compare === o.id ? 'var(--color-accent-hover)' : 'var(--color-text-secondary)',
                border: state.compare === o.id ? '0.5px solid var(--color-accent-border)' : '0.5px solid transparent',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Section>

      {vizOptions.length > 1 && (
        <Section label="View">
          <Segmented
            options={vizOptions.map((v) => ({ id: v.id, label: v.label, active: state.vizType === v.id }))}
            onSelect={(id) => set({ vizType: id as VizType })}
          />
        </Section>
      )}
    </div>
  );
}

// ── building blocks ────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 'var(--text-caption)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-text-tertiary)',
          marginBottom: 8,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Segmented({
  options,
  onSelect,
}: {
  options: { id: string; label: string; active: boolean }[];
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onSelect(o.id)}
          className="emos-btn"
          style={{
            padding: '4px 10px',
            fontSize: 'var(--text-caption)',
            borderRadius: 'var(--radius-md)',
            background: o.active ? 'var(--color-accent)' : 'var(--color-bg-primary)',
            color: o.active ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
            border: o.active ? 'none' : '0.5px solid var(--color-border-secondary)',
            fontWeight: o.active ? 500 : 400,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChipPicker({
  selected,
  onAdd,
  onRemove,
  disabledIds,
}: {
  selected: Dimension[];
  onAdd: (d: Dimension) => void;
  onRemove: (d: Dimension) => void;
  disabledIds: Set<string>;
}) {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: selected.length ? 6 : 0 }}>
        {selected.map((d) => (
          <Chip key={d} label={dimLabel(d)} onRemove={() => onRemove(d)} />
        ))}
      </div>
      <Select
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value as Dimension);
        }}
      >
        <option value="">+ Add dimension…</option>
        {DIMENSIONS.filter((d) => !disabledIds.has(d.id)).map((d) => (
          <option key={d.id} value={d.id}>
            {d.section}: {d.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span style={chip}>
      {label}
      <button onClick={onRemove} aria-label={`Remove ${label}`} style={chipX}>
        <X size={11} />
      </button>
    </span>
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
