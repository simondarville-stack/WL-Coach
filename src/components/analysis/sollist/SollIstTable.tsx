// The Ratio Analysis sheet table. The model itself is interactive: a row's
// reference is swapped via an inline select (full reference names, no
// chips), index/reps are edited in place, rows can be removed, columns
// sort on click, and rows arrive pre-grouped (by reference or category)
// from the view state. Reference lines stay pinned on top.

import { useMemo, useState } from 'react';
import { ExerciseSearch } from '../../planner/ExerciseSearch';
import type { Exercise } from '../../../lib/database.types';
import type { ComputedSollIstRow, SollIstRow } from '../../../lib/sollIst';
import { istKey } from '../../../lib/sollIst';
import { exerciseOptionLabel, fmtKg, heatColor, type RowGroup, type SheetRef, type SheetView, type SortKey } from './sollIstState';

interface SollIstTableProps {
  groups: RowGroup[];
  /** Second model rendered side-by-side, or null. */
  side: { name: string; computed: ComputedSollIstRow[] } | null;
  modelName: string;
  refs: SheetRef[];
  /** Catalogue (sorted by name) for the inline exercise remap select. */
  exercises: Exercise[];
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
/** The exercise code, rendered inline before the name. minWidth keeps the
 *  names aligned when some exercises have no code. */
const monoCode: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-secondary)',
  flexShrink: 0,
  minWidth: 26,
};
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

/**
 * A signed kilogram gap. Both analysis blocks use it, so "above" and "below"
 * read the same way whichever level the coach is scanning.
 *
 * The 0,25 dead band keeps a rounding artefact from being coloured as a real
 * strength or weakness.
 */
function DeltaKg({ value }: { value: number | null }) {
  if (value == null) return <span>–</span>;
  return (
    <span
      style={{
        color:
          value > 0.25
            ? 'var(--color-success-text, #1c7c3c)'
            : value < -0.25
            ? 'var(--color-danger-text, #b3261e)'
            : undefined,
      }}
    >
      {value > 0 ? '+' : ''}{fmtKg(value)}
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
  exercises,
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
  const showRefCol = groupBy !== 'ref';

  /**
   * Which unmapped row has its search open, held by ROW OBJECT.
   *
   * Not by the render key: that key is `${group.key}-${i}` while a row is
   * unmapped and flips to `istKey(exerciseId, reps)` the instant it is mapped,
   * so keying on it would lose track of the cell mid-edit. `onEditRow` already
   * identifies rows the same way (`r === row`).
   */
  const [mappingRow, setMappingRow] = useState<SollIstRow | null>(null);
  /**
   * The exercise just picked, so the select that replaces the search takes
   * focus and tab order does not restart at the top of the document.
   *
   * Keyed on the exercise id rather than the row: `onEditRow` replaces the row
   * OBJECT, so a row-keyed ref would point at the unmounted one. The select
   * mounts for the first time at that moment (the cell was a button until
   * now), so plain `autoFocus` is enough — no ref, no effect.
   */
  const [focusMappedExerciseId, setFocusMappedExerciseId] = useState<string | null>(null);

  // ── column blocks ───────────────────────────────────────────────────────
  // The sheet reads GENERAL → the model at the athlete's CURRENT level → the
  // same model at their GOAL level. Both analysis blocks ask the same two
  // questions (how far off, in kg and in %) of the same one number, so their
  // widths are computed from the same flags rather than hardcoded — the band
  // headers above them have to span exactly what the body renders.
  //
  // "Current best" sits in GENERAL, not in the current-level block: it is the
  // athlete's own number and both levels are measured against it.
  const showDelta = diff && hasAthlete; // a Δ column with no athlete is all dashes
  /** Exercise, [Reference], Reps, [Current best] */
  const generalCols = 2 + (showRefCol ? 1 : 0) + (hasAthlete ? 1 : 0);
  /** Side-by-side, per model: Index %, Target kg, [Δ %] — no room for Δ kg. */
  const modelColsSide = 2 + (showDelta ? 1 : 0);
  /** Single model: Index %, Target kg, [Δ kg, Δ %] */
  const modelColsSingle = 2 + (showDelta ? 2 : 0);
  /** Goal target kg, [Δ kg, Δ %] */
  const goalCols = 1 + (showDelta ? 2 : 0);

  // Codes come from the CATALOGUE at render time, never copied onto the model
  // row: a coach who re-codes an exercise must not have to re-save every model.
  const codeById = useMemo(
    () => new Map(exercises.map((e) => [e.id, e.exercise_code])),
    [exercises],
  );

  // Total column count for the group-header colSpan.
  const totalCols =
    generalCols +
    (side ? modelColsSide * 2 : modelColsSingle) +
    goalCols +
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
        {/* Band row — names the blocks. It renders in BOTH modes now: the
            single-model sheet carries two identically-labelled "Δ kg / Δ %"
            pairs, and without a band above them there is nothing on screen
            saying which level each pair measures against. The colSpans are
            computed, not hardcoded — the old `colSpan={2}` on the goal band was
            one wider than the body whenever no athlete was selected. */}
        <tr>
          <th style={{ ...th, borderBottom: 'none' }} colSpan={generalCols} />
          <th style={{ ...th, borderBottom: 'none', textAlign: 'center', color: 'var(--color-text-secondary)', ...colSep }} colSpan={side ? modelColsSide : modelColsSingle}>
            {side ? modelName : 'Now'}
          </th>
          {side && (
            <th style={{ ...th, borderBottom: 'none', textAlign: 'center', color: 'var(--color-text-secondary)', ...colSep }} colSpan={modelColsSide}>
              {side.name}
            </th>
          )}
          <th style={{ ...th, borderBottom: 'none', textAlign: 'center', color: 'var(--color-text-secondary)', ...colSep }} colSpan={goalCols}>
            {side ? `Goal (${modelName})` : 'Goal'}
          </th>
          <th style={{ ...th, borderBottom: 'none' }} />
        </tr>
        <tr>
          {/* GENERAL — who and what, plus the athlete's own number. */}
          {sortableTh('Exercise', 'exercise', leftAlign)}
          {showRefCol && <th style={{ ...th, ...leftAlign }}>Reference</th>}
          {sortableTh('Reps', 'reps')}
          {hasAthlete && sortableTh('Current best', 'ist')}
          {/* NOW — the model at the athlete's current reference. */}
          {sortableTh('Index %', 'index', colSep)}
          {sortableTh('Target kg', 'soll')}
          {side ? (
            <>
              {showDelta && sortableTh('Δ %', 'deltaPct')}
              <th style={{ ...th, ...colSep }}>Index %</th>
              <th style={th}>Target kg</th>
              {showDelta && <th style={th}>Δ %</th>}
            </>
          ) : (
            <>
              {showDelta && sortableTh('Δ kg', 'deltaKg')}
              {showDelta && sortableTh('Δ %', 'deltaPct')}
            </>
          )}
          {/* GOAL — the same model at the athlete's goal reference. */}
          {sortableTh('Goal target kg', 'target', colSep)}
          {showDelta && sortableTh('Δ kg', 'goalDeltaKg')}
          {showDelta && sortableTh('Δ %', 'goalDeltaPct')}
          <th style={th} />
        </tr>
      </thead>
      <tbody>
        {/* pinned reference lines (the anchors; not part of grouping/sorting) */}
        {refs.map((ref) => (
          <tr key={ref.key} style={{ background: 'var(--color-accent-bg, rgba(24, 95, 165, 0.07))' }}>
            <td style={{ ...td, ...leftAlign, fontWeight: 600 }} title={ref.exerciseId == null ? 'Manual reference — numbers typed by the coach' : undefined}>
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                {codeById.get(ref.exerciseId ?? '') && (
                  <span style={monoCode} title="Exercise code">{codeById.get(ref.exerciseId ?? '')}</span>
                )}
                <span>{ref.label}</span>
              </span>
              {ref.exerciseId == null && <span style={{ fontWeight: 400, color: 'var(--color-text-tertiary)' }}> ✎</span>}
            </td>
            {showRefCol && <td style={{ ...td, ...leftAlign, color: 'var(--color-text-tertiary)' }}>= 100</td>}
            <td style={td}>1</td>
            {hasAthlete && <td style={{ ...td, fontWeight: 600 }}>{fmtKg(ref.current)}</td>}
            <td style={{ ...td, ...colSep }}>100</td>
            <td style={{ ...td, fontWeight: 600 }}>{fmtKg(ref.current)}</td>
            {side ? (
              <>
                {showDelta && <td style={td}>–</td>}
                <td style={{ ...td, ...colSep }}>100</td>
                <td style={{ ...td, fontWeight: 600 }}>{fmtKg(ref.current)}</td>
                {showDelta && <td style={td}>–</td>}
              </>
            ) : (
              <>
                {showDelta && <td style={td}>–</td>}
                {showDelta && <td style={td}>–</td>}
              </>
            )}
            <td style={{ ...td, ...colSep, fontWeight: 600 }}>{fmtKg(ref.goal)}</td>
            {/* A reference IS its own current best, so its gap to the goal is
                the plain difference between the two numbers the coach typed. */}
            {showDelta && (
              <td style={td}>
                <DeltaKg value={ref.goal != null && ref.current != null ? ref.current - ref.goal : null} />
              </td>
            )}
            {showDelta && (
              <td style={td}>
                <DeltaPct value={ref.goal != null && ref.goal > 0 && ref.current != null ? (ref.current / ref.goal) * 100 : null} />
              </td>
            )}
            <td style={td} />
          </tr>
        ))}

        {groups.map((group) => (
          <GroupSection key={group.key} label={group.label} totalCols={totalCols}>
            {group.rows.map((c, i) => {
              const key = c.row.exerciseId ? istKey(c.row.exerciseId, c.row.reps) : `${group.key}-${i}`;
              const sideC = side ? sideRowFor(c, side.computed) : null;
              // The tint marks strength/weakness against the CURRENT level, so it
              // rides the Target-kg cell in both modes now (it used to ride the
              // Current-best cell in single mode, where it read as if the
              // athlete's own number were the thing being judged).
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
                <td style={{ ...td, padding: '2px 8px' }} title={unmapped ? 'Exercise not mapped to the catalogue — pick one here' : istTitle}>
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
                  <td style={{ ...td, ...leftAlign, padding: '2px 8px', minWidth: 232 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {codeById.get(c.row.exerciseId ?? '') && (
                      <span style={monoCode} title="Exercise code">{codeById.get(c.row.exerciseId ?? '')}</span>
                    )}
                    {unmapped ? (
                      // An unmapped row has no exercise to pick from a list of
                      // one — it has a NAME to look up. A 300-option select is
                      // the wrong tool for that; the ranked search is the one
                      // the rest of the app uses, and it matches on code too.
                      mappingRow === c.row ? (
                        <span
                          style={{ display: 'inline-block', width: 220 }}
                          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMappingRow(null); } }}
                          onBlur={(e) => {
                            // Only when focus actually leaves the search. Picking a
                            // result commits on mousedown with preventDefault, so
                            // the input never blurs on the way to a match.
                            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMappingRow(null);
                          }}
                        >
                          <ExerciseSearch
                            exercises={exercises}
                            disableSlashCommands
                            dropUp={false}
                            autoFocus
                            placeholder="Search exercise…"
                            onAdd={(ex) => {
                              onEditRow(c.row, { exerciseId: ex.id, label: ex.name });
                              setMappingRow(null);
                              setFocusMappedExerciseId(ex.id);
                            }}
                          />
                        </span>
                      ) : (
                        <button
                          type="button"
                          // onClick, never onMouseDown: an open search dismisses on
                          // outside mousedown, so a mousedown trigger would race it
                          // and the next cell would appear not to open.
                          onClick={() => setMappingRow(c.row)}
                          title={`"${c.row.label}" is not in the catalogue — click to search for the exercise it means`}
                          className="sollist-inline-select"
                          style={{
                            font: 'inherit',
                            color: 'var(--color-text-tertiary)',
                            background: 'transparent',
                            border: '0.5px solid transparent',
                            borderRadius: 'var(--radius-sm)',
                            padding: '1px 4px',
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          ⚠ {c.row.label}
                        </button>
                      )
                    ) : (
                      <select
                        value={c.row.exerciseId ?? ''}
                        autoFocus={c.row.exerciseId != null && c.row.exerciseId === focusMappedExerciseId}
                        onChange={(e) => {
                          const ex = exercises.find((x) => x.id === e.target.value);
                          onEditRow(c.row, { exerciseId: ex?.id ?? null, label: ex?.name ?? c.row.label });
                        }}
                        title="Repoint this row to a different catalogue exercise"
                        className="sollist-inline-select"
                        style={{
                          font: 'inherit',
                          fontWeight: 'inherit',
                          color: 'var(--color-text-primary)',
                          background: 'transparent',
                          border: '0.5px solid transparent',
                          borderRadius: 'var(--radius-sm)',
                          padding: '1px 2px',
                          maxWidth: 220,
                          cursor: 'pointer',
                        }}
                      >
                        {exercises.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {exerciseOptionLabel(ex)}
                          </option>
                        ))}
                      </select>
                    )}
                    </span>
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
                  {istCell}
                  {indexCell(colSep)}
                  <td style={{ ...td, ...heatStyle(c.deltaPct) }}>{fmtKg(c.soll)}</td>
                  {side ? (
                    <>
                      {showDelta && (
                        <td style={td}>
                          <DeltaPct value={c.deltaPct} />
                        </td>
                      )}
                      <td style={{ ...td, ...colSep }}>{sideC ? sideC.row.indexPct.toLocaleString('de-DE') : '–'}</td>
                      <td style={{ ...td, ...heatStyle(sideC?.deltaPct ?? null) }}>{fmtKg(sideC?.soll)}</td>
                      {showDelta && (
                        <td style={td}>
                          <DeltaPct value={sideC?.deltaPct ?? null} />
                        </td>
                      )}
                    </>
                  ) : (
                    <>
                      {showDelta && (
                        <td style={td}>
                          <DeltaKg value={c.deltaKg} />
                        </td>
                      )}
                      {showDelta && (
                        <td style={td}>
                          <DeltaPct value={c.deltaPct} />
                        </td>
                      )}
                    </>
                  )}
                  <td style={{ ...td, ...colSep }}>{fmtKg(c.target)}</td>
                  {showDelta && (
                    <td
                      style={td}
                      title={
                        c.toGo == null ? undefined : c.toGo > 0 ? `${fmtKg(c.toGo)} kg still to go` : 'Goal number already there'
                      }
                    >
                      <DeltaKg value={c.goalDeltaKg} />
                    </td>
                  )}
                  {showDelta && (
                    <td style={td}>
                      <DeltaPct value={c.goalDeltaPct} />
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
