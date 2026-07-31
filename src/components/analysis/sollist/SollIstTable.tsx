// The Soll–Ist sheet table. Presentational: receives computed rows and
// renders reference rows on top, one line per model row below. Ist cells are
// inline-editable (dense tables over modals, CLAUDE.md).

import type { ComputedSollIstRow, RefSlot, SollIstRow } from '../../../lib/sollIst';
import { istKey } from '../../../lib/sollIst';
import { fmtKg, heatColor } from './sollIstState';

export interface RefLine {
  slot: RefSlot;
  label: string;
  current: number | null;
  goal: number | null;
}

interface SollIstTableProps {
  computed: ComputedSollIstRow[];
  /** Second model rendered side-by-side, or null. */
  side: { name: string; computed: ComputedSollIstRow[] } | null;
  modelName: string;
  refLines: RefLine[];
  hasAthlete: boolean;
  heatmap: boolean;
  diff: boolean;
  onEditIst: (row: SollIstRow, raw: string) => void;
}

const th: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 'var(--text-caption)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
  fontWeight: 600,
  textAlign: 'right',
  borderBottom: '1px solid var(--color-border-secondary)',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 'var(--text-label)',
  textAlign: 'right',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
  whiteSpace: 'nowrap',
};
const leftAlign: React.CSSProperties = { textAlign: 'left' };
const colSep: React.CSSProperties = { borderLeft: '0.5px solid var(--color-border-secondary)' };

function RefPill({ slot }: { slot: RefSlot }) {
  const sn = slot === 'snatch';
  return (
    <span
      title={sn ? 'Referenced to snatch (Kategorie 1)' : 'Referenced to clean & jerk (Kategorie 2)'}
      style={{
        fontSize: 'var(--text-caption)',
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: 8,
        background: sn ? 'rgba(24, 95, 165, 0.12)' : 'rgba(141, 59, 110, 0.12)',
        color: sn ? '#185FA5' : '#8d3b6e',
      }}
    >
      {sn ? 'SN' : 'C&J'}
    </span>
  );
}

function DeltaPct({ value, isRef }: { value: number | null; isRef?: boolean }) {
  if (value == null || isRef) return <span>–</span>;
  return (
    <span style={{ color: value >= 100 ? 'var(--color-success-text, #1c7c3c)' : 'var(--color-danger-text, #b3261e)' }}>
      {Math.round(value).toLocaleString('de-DE')} %
    </span>
  );
}

/** Match a main row to the same exercise+reps row in the side model. */
function sideRowFor(main: ComputedSollIstRow, side: ComputedSollIstRow[]): ComputedSollIstRow | null {
  return (
    side.find(
      (s) =>
        (main.row.exerciseId != null && s.row.exerciseId === main.row.exerciseId && s.row.reps === main.row.reps) ||
        (main.row.exerciseId == null && s.row.label === main.row.label && s.row.reps === main.row.reps),
    ) ?? null
  );
}

export function SollIstTable({ computed, side, modelName, refLines, hasAthlete, heatmap, diff, onEditIst }: SollIstTableProps) {
  const modelCols = diff ? 3 : 2; // Index, Soll, (Δ%)

  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        {side && (
          <tr>
            <th style={{ ...th, borderBottom: 'none' }} colSpan={hasAthlete ? 4 : 3} />
            <th style={{ ...th, borderBottom: 'none', textAlign: 'center', color: 'var(--color-text-secondary)', ...colSep }} colSpan={modelCols}>
              {modelName}
            </th>
            <th style={{ ...th, borderBottom: 'none', textAlign: 'center', color: 'var(--color-text-secondary)', ...colSep }} colSpan={modelCols}>
              {side.name}
            </th>
            <th style={{ ...th, borderBottom: 'none', textAlign: 'center', color: 'var(--color-text-secondary)', ...colSep }} colSpan={2}>
              Goal ({modelName})
            </th>
          </tr>
        )}
        <tr>
          <th style={{ ...th, ...leftAlign }}>Exercise</th>
          <th style={{ ...th, textAlign: 'center' }}>Ref</th>
          <th style={th}>Reps</th>
          {side ? (
            <>
              {hasAthlete && <th style={th}>Ist kg</th>}
              <th style={{ ...th, ...colSep }}>Index %</th>
              <th style={th}>Soll kg</th>
              {diff && <th style={th}>Δ %</th>}
              <th style={{ ...th, ...colSep }}>Index %</th>
              <th style={th}>Soll kg</th>
              {diff && <th style={th}>Δ %</th>}
            </>
          ) : (
            <>
              <th style={{ ...th, ...colSep }}>Index %</th>
              <th style={th}>Soll kg</th>
              {hasAthlete && <th style={th}>Ist kg</th>}
              {diff && hasAthlete && <th style={th}>Δ kg</th>}
              {diff && hasAthlete && <th style={th}>Δ %</th>}
            </>
          )}
          <th style={{ ...th, ...colSep }}>Target kg</th>
          {hasAthlete && <th style={th}>To go</th>}
        </tr>
      </thead>
      <tbody>
        {refLines.map((ref) => (
          <tr key={ref.slot} style={{ background: 'var(--color-accent-bg, rgba(24, 95, 165, 0.07))' }}>
            <td style={{ ...td, ...leftAlign, fontWeight: 600 }}>{ref.label}</td>
            <td style={{ ...td, textAlign: 'center' }}>
              <RefPill slot={ref.slot} />
            </td>
            <td style={td}>1</td>
            {side ? (
              <>
                {hasAthlete && <td style={{ ...td, fontWeight: 600 }}>{fmtKg(ref.current)}</td>}
                <td style={{ ...td, ...colSep }}>100</td>
                <td style={{ ...td, fontWeight: 600 }}>{fmtKg(ref.current)}</td>
                {diff && <td style={td}>–</td>}
                <td style={{ ...td, ...colSep }}>100</td>
                <td style={{ ...td, fontWeight: 600 }}>{fmtKg(ref.current)}</td>
                {diff && <td style={td}>–</td>}
              </>
            ) : (
              <>
                <td style={{ ...td, ...colSep }}>100</td>
                <td style={{ ...td, fontWeight: 600 }}>{fmtKg(ref.current)}</td>
                {hasAthlete && <td style={{ ...td, fontWeight: 600 }}>{fmtKg(ref.current)}</td>}
                {diff && hasAthlete && <td style={td}>–</td>}
                {diff && hasAthlete && <td style={td}>–</td>}
              </>
            )}
            <td style={{ ...td, ...colSep, fontWeight: 600 }}>{fmtKg(ref.goal)}</td>
            {hasAthlete && (
              <td style={td}>
                {ref.goal != null && ref.current != null ? `+${fmtKg(ref.goal - ref.current)}` : '–'}
              </td>
            )}
          </tr>
        ))}

        {computed.map((c, i) => {
          const key = c.row.exerciseId ? istKey(c.row.exerciseId, c.row.reps) : `row-${i}`;
          const sideC = side ? sideRowFor(c, side.computed) : null;
          const heatStyle = (pct: number | null): React.CSSProperties =>
            heatmap && hasAthlete && pct != null ? { background: heatColor(pct) } : {};
          const istTitle =
            c.ist?.source === 'estimated'
              ? `Estimated rep-max from the PR table (no real ${c.row.reps}RM logged) — type to override`
              : c.ist?.source === 'override'
              ? 'Coach override — clear to return to the PR suggestion'
              : 'From the PR table — type to override';
          const unmapped = c.row.exerciseId == null;

          const istCell = hasAthlete ? (
            <td style={{ ...td, ...heatStyle(side ? null : c.deltaPct), padding: '2px 8px' }} title={unmapped ? 'Exercise not mapped to the catalogue — edit in the wizard' : istTitle}>
              {unmapped ? (
                '–'
              ) : (
                <input
                  type="text"
                  // Uncontrolled with a remount key: shows the latest suggestion
                  // or override, commits on blur/Enter without fighting typing.
                  key={`${key}-${c.ist?.valueKg ?? ''}-${c.ist?.source ?? ''}`}
                  defaultValue={c.ist ? (c.ist.source === 'estimated' ? `≈${fmtKg(c.ist.valueKg)}` : fmtKg(c.ist.valueKg)) : ''}
                  placeholder="–"
                  onBlur={(e) => onEditIst(c.row, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  style={{
                    width: 64,
                    textAlign: 'right',
                    font: 'inherit',
                    fontStyle: c.ist?.source === 'estimated' ? 'italic' : 'normal',
                    color: c.ist?.source === 'estimated' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                    background: 'transparent',
                    border: '0.5px solid transparent',
                    borderRadius: 'var(--radius-sm)',
                    padding: '1px 4px',
                  }}
                  className="sollist-ist-input"
                />
              )}
            </td>
          ) : null;

          return (
            <tr key={key} className="sollist-row">
              <td style={{ ...td, ...leftAlign, color: unmapped ? 'var(--color-text-tertiary)' : undefined }}>
                {c.row.label}
                {unmapped && <span title="Not mapped to a catalogue exercise"> ⚠</span>}
              </td>
              <td style={{ ...td, textAlign: 'center' }}>
                <RefPill slot={c.row.refSlot} />
              </td>
              <td style={td}>{c.row.reps > 1 ? `×${c.row.reps}` : '1'}</td>
              {side ? (
                <>
                  {istCell}
                  <td style={{ ...td, ...colSep }}>{c.row.indexPct.toLocaleString('de-DE')}</td>
                  <td style={{ ...td, ...heatStyle(c.deltaPct) }}>{fmtKg(c.soll)}</td>
                  {diff && (
                    <td style={td}>
                      <DeltaPct value={c.deltaPct} />
                    </td>
                  )}
                  <td style={{ ...td, ...colSep }}>{sideC ? sideC.row.indexPct.toLocaleString('de-DE') : '–'}</td>
                  <td style={{ ...td, ...heatStyle(sideC?.deltaPct ?? null) }}>{fmtKg(sideC?.soll)}</td>
                  {diff && (
                    <td style={td}>
                      <DeltaPct value={sideC?.deltaPct ?? null} />
                    </td>
                  )}
                </>
              ) : (
                <>
                  <td style={{ ...td, ...colSep }}>{c.row.indexPct.toLocaleString('de-DE')}</td>
                  <td style={td}>{fmtKg(c.soll)}</td>
                  {istCell}
                  {diff && hasAthlete && (
                    <td
                      style={{
                        ...td,
                        color:
                          c.deltaKg != null && c.deltaKg > 0.25
                            ? 'var(--color-success-text, #1c7c3c)'
                            : c.deltaKg != null && c.deltaKg < -0.25
                            ? 'var(--color-danger-text, #b3261e)'
                            : undefined,
                      }}
                    >
                      {c.deltaKg == null ? '–' : `${c.deltaKg > 0 ? '+' : ''}${fmtKg(c.deltaKg)}`}
                    </td>
                  )}
                  {diff && hasAthlete && (
                    <td style={td}>
                      <DeltaPct value={c.deltaPct} />
                    </td>
                  )}
                </>
              )}
              <td style={{ ...td, ...colSep }}>{fmtKg(c.target)}</td>
              {hasAthlete && (
                <td style={{ ...td, color: c.toGo != null && c.toGo <= 0 ? 'var(--color-success-text, #1c7c3c)' : undefined }}>
                  {c.toGo == null ? '–' : c.toGo <= 0 ? '✓ done' : `+${fmtKg(c.toGo)}`}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
