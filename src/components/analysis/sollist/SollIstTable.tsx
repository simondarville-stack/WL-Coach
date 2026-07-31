// The Soll–Ist sheet table. The model itself is interactive: a row's
// reference is swapped via an inline select (full reference names, no
// chips), index/reps are edited in place, rows can be removed, columns
// sort on click, and rows arrive pre-grouped (by reference or category)
// from the view state. Reference lines stay pinned on top.

import type { ComputedSollIstRow, SollIstRow } from '../../../lib/sollIst';
import { istKey } from '../../../lib/sollIst';
import { fmtKg, heatColor, type RowGroup, type SheetRef, type SheetView, type SortKey } from './sollIstState';

interface SollIstTableProps {
  groups: RowGroup[];
  /** Second model rendered side-by-side, or null. */
  side: { name: string; computed: ComputedSollIstRow[] } | null;
  modelName: string;
  refs: SheetRef[];
  hasAthlete: boolean;
  heatmap: boolean;
  diff: boolean;
  /** Hide the Ref column when the view already groups by reference. */
  groupBy: SheetView['groupBy'];
  sort: SheetView['sort'];
  onSortChange: (sort: SheetView['sort']) => void;
  onEditRow: (row: SollIstRow, patch: Partial<SollIstRow>) => void;
  onRemoveRow: (row: SollIstRow) => void;
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

const inlineInput: React.CSSProperties = {
  textAlign: 'right',
  font: 'inherit',
  background: 'transparent',
  border: '0.5px solid transparent',
  borderRadius: 'var(--radius-sm)',
  padding: '1px 4px',
  color: 'var(--color-text-primary)',
};

function DeltaPct({ value }: { value: number | null }) {
  if (value == null) return <span>–</span>;
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

export function SollIstTable({
  groups,
  side,
  modelName,
  refs,
  hasAthlete,
  heatmap,
  diff,
  groupBy,
  sort,
  onSortChange,
  onEditRow,
  onRemoveRow,
  onEditIst,
}: SollIstTableProps) {
  const modelCols = diff ? 3 : 2; // Index, Soll, (Δ%)
  const showRefCol = groupBy !== 'ref';

  // Total column count for group-header colSpan.
  const totalCols =
    2 + // Exercise, Reps
    (showRefCol ? 1 : 0) +
    (side ? (hasAthlete ? 1 : 0) + modelCols * 2 : 2 + (hasAthlete ? 1 : 0) + (diff && hasAthlete ? 2 : 0)) +
    1 + // Target
    (hasAthlete ? 1 : 0) +
    1; // remove-button column

  const sortableTh = (label: string, key: SortKey, extra?: React.CSSProperties) => {
    const active = sort?.key === key;
    return (
      <th
        style={{ ...th, ...extra, cursor: 'pointer', userSelect: 'none' }}
        title={`Sort by ${label}`}
        onClick={() => {
          if (!active) onSortChange({ key, dir: key === 'exercise' ? 1 : -1 });
          else if ((sort!.dir === -1 && key !== 'exercise') || (sort!.dir === 1 && key === 'exercise')) onSortChange({ key, dir: (sort!.dir * -1) as 1 | -1 });
          else onSortChange(null); // third click clears back to model order
        }}
      >
        {label}
        {active && <span style={{ marginLeft: 2 }}>{sort!.dir === 1 ? '▲' : '▼'}</span>}
      </th>
    );
  };

  const refName = (key: string) => refs.find((r) => r.key === key)?.label ?? `? ${key}`;

  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        {side && (
          <tr>
            <th style={{ ...th, borderBottom: 'none' }} colSpan={2 + (showRefCol ? 1 : 0) + (hasAthlete ? 1 : 0)} />
            <th style={{ ...th, borderBottom: 'none', textAlign: 'center', color: 'var(--color-text-secondary)', ...colSep }} colSpan={modelCols}>
              {modelName}
            </th>
            <th style={{ ...th, borderBottom: 'none', textAlign: 'center', color: 'var(--color-text-secondary)', ...colSep }} colSpan={modelCols}>
              {side.name}
            </th>
            <th style={{ ...th, borderBottom: 'none', textAlign: 'center', color: 'var(--color-text-secondary)', ...colSep }} colSpan={2}>
              Goal ({modelName})
            </th>
            <th style={{ ...th, borderBottom: 'none' }} />
          </tr>
        )}
        <tr>
          {sortableTh('Exercise', 'exercise', leftAlign)}
          {showRefCol && <th style={{ ...th, ...leftAlign }}>Reference</th>}
          {sortableTh('Reps', 'reps')}
          {side ? (
            <>
              {hasAthlete && sortableTh('Ist kg', 'ist')}
              {sortableTh('Index %', 'index', colSep)}
              {sortableTh('Soll kg', 'soll')}
              {diff && sortableTh('Δ %', 'deltaPct')}
              <th style={{ ...th, ...colSep }}>Index %</th>
              <th style={th}>Soll kg</th>
              {diff && <th style={th}>Δ %</th>}
            </>
          ) : (
            <>
              {sortableTh('Index %', 'index', colSep)}
              {sortableTh('Soll kg', 'soll')}
              {hasAthlete && sortableTh('Ist kg', 'ist')}
              {diff && hasAthlete && sortableTh('Δ kg', 'deltaKg')}
              {diff && hasAthlete && sortableTh('Δ %', 'deltaPct')}
            </>
          )}
          {sortableTh('Target kg', 'target', colSep)}
          {hasAthlete && sortableTh('To go', 'toGo')}
          <th style={th} />
        </tr>
      </thead>
      <tbody>
        {/* pinned reference lines (the anchors; not part of grouping/sorting) */}
        {refs.map((ref) => (
          <tr key={ref.key} style={{ background: 'var(--color-accent-bg, rgba(24, 95, 165, 0.07))' }}>
            <td style={{ ...td, ...leftAlign, fontWeight: 600 }} title={ref.exerciseId == null ? 'Manual reference — numbers typed by the coach' : undefined}>
              {ref.label}
              {ref.exerciseId == null && <span style={{ fontWeight: 400, color: 'var(--color-text-tertiary)' }}> ✎</span>}
            </td>
            {showRefCol && <td style={{ ...td, ...leftAlign, color: 'var(--color-text-tertiary)' }}>= 100</td>}
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
            {hasAthlete && <td style={td}>{ref.goal != null && ref.current != null ? `+${fmtKg(ref.goal - ref.current)}` : '–'}</td>}
            <td style={td} />
          </tr>
        ))}

        {groups.map((group) => (
          <GroupSection key={group.key} label={group.label} totalCols={totalCols}>
            {group.rows.map((c, i) => {
              const key = c.row.exerciseId ? istKey(c.row.exerciseId, c.row.reps) : `${group.key}-${i}`;
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
                        ...inlineInput,
                        width: 64,
                        fontStyle: c.ist?.source === 'estimated' ? 'italic' : 'normal',
                        color: c.ist?.source === 'estimated' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                      }}
                      className="sollist-inline-input"
                    />
                  )}
                </td>
              ) : null;

              const indexCell = (extra?: React.CSSProperties) => (
                <td style={{ ...td, ...extra, padding: '2px 8px' }} title="Index — % of the reference at reference = 100; type to adjust the model">
                  <input
                    type="text"
                    key={`${key}-idx-${c.row.indexPct}`}
                    defaultValue={c.row.indexPct.toLocaleString('de-DE')}
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value.replace(',', '.'));
                      if (Number.isFinite(v) && v > 0 && v !== c.row.indexPct) onEditRow(c.row, { indexPct: v });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    style={{ ...inlineInput, width: 48 }}
                    className="sollist-inline-input"
                  />
                </td>
              );

              const repsCell = (
                <td style={{ ...td, padding: '2px 8px' }} title="Rep count the index applies to; type to adjust">
                  <input
                    type="text"
                    key={`${key}-reps-${c.row.reps}`}
                    defaultValue={String(c.row.reps)}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value.replace('×', ''), 10);
                      if (Number.isFinite(v) && v >= 1 && v <= 10 && v !== c.row.reps) onEditRow(c.row, { reps: v });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    style={{ ...inlineInput, width: 28 }}
                    className="sollist-inline-input"
                  />
                </td>
              );

              return (
                <tr key={key} className="sollist-row">
                  <td style={{ ...td, ...leftAlign, color: unmapped ? 'var(--color-text-tertiary)' : undefined }}>
                    {c.row.label}
                    {unmapped && <span title="Not mapped to a catalogue exercise"> ⚠</span>}
                  </td>
                  {showRefCol && (
                    <td style={{ ...td, ...leftAlign, padding: '2px 8px' }}>
                      <select
                        value={c.row.refKey}
                        onChange={(e) => onEditRow(c.row, { refKey: e.target.value })}
                        title="Swap the reference this row is indexed against"
                        className="sollist-inline-select"
                        style={{ font: 'inherit', color: 'var(--color-text-secondary)', background: 'transparent', border: '0.5px solid transparent', borderRadius: 'var(--radius-sm)', padding: '1px 2px', maxWidth: 160, cursor: 'pointer' }}
                      >
                        {refs.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}
                          </option>
                        ))}
                        {!refs.some((r) => r.key === c.row.refKey) && <option value={c.row.refKey}>{refName(c.row.refKey)}</option>}
                      </select>
                    </td>
                  )}
                  {repsCell}
                  {side ? (
                    <>
                      {istCell}
                      {indexCell(colSep)}
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
                      {indexCell(colSep)}
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
                  <td style={{ ...td, padding: '2px 4px' }}>
                    <button
                      type="button"
                      className="sollist-row-remove"
                      title="Remove this exercise from the sheet"
                      onClick={() => onRemoveRow(c.row)}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-caption)', padding: '2px 4px', borderRadius: 'var(--radius-sm)' }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </GroupSection>
        ))}
      </tbody>
    </table>
  );
}

function GroupSection({ label, totalCols, children }: { label: string | null; totalCols: number; children: React.ReactNode }) {
  return (
    <>
      {label != null && (
        <tr>
          <td
            colSpan={totalCols}
            style={{
              padding: '8px 8px 3px',
              fontSize: 'var(--text-caption)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              borderBottom: '1px solid var(--color-border-secondary)',
              textAlign: 'left',
            }}
          >
            {label}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
