// The left configuration rail. Reads top-to-bottom in query order:
// Scope → Subjects → Rows → Columns → Measures → Compare → View. Every control
// mutates the builder state; the result pane re-renders from runAnalysisQuery.

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Select } from '../../ui';
import type { Dimension, MeasureState, MetricDef, Normalization, VizType } from '../../../lib/analysis';
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

const COMPARE_OPTIONS: { id: MeasureState; label: string; hint: string }[] = [
  { id: 'performed', label: 'Performed', hint: 'What the athlete actually did' },
  { id: 'planned', label: 'Planned', hint: 'What the coach prescribed' },
  { id: 'both', label: 'Both', hint: 'Planned and performed side by side' },
  { id: 'delta', label: 'Δ', hint: 'Performed − planned' },
  { id: 'adherence', label: 'Adherence', hint: 'Performed ÷ planned' },
];

export function ConfigRail({ state, set, metrics, athletes, groups, vizOptions }: ConfigRailProps) {
  const usedDims = new Set<string>([...state.rows, ...state.cols]);
  const athleteName = (id: string) => athletes.find((a) => a.id === id)?.name ?? id;
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? id;
  const multi = state.athleteIds.length > 1 || state.groupIds.length > 0;

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
          <Segmented
            options={NORMALIZATION_OPTIONS.map((o) => ({ id: o.id, label: o.label, active: state.normalization === o.id }))}
            onSelect={(id) => set({ normalization: id as Normalization })}
          />
          <p style={hint}>{NORMALIZATION_OPTIONS.find((o) => o.id === state.normalization)?.hint}</p>
        </Section>
      )}

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

      {state.vizType !== 'table' && (
        <Section label="Overlay">
          <button
            onClick={() => set({ comparePrevious: !state.comparePrevious })}
            className="emos-btn"
            style={{
              ...optionRow,
              width: '100%',
              background: state.comparePrevious ? 'var(--color-accent-muted)' : 'transparent',
              color: state.comparePrevious ? 'var(--color-accent-hover)' : 'var(--color-text-secondary)',
              border: state.comparePrevious ? '0.5px solid var(--color-accent-border)' : '0.5px solid var(--color-border-tertiary)',
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
