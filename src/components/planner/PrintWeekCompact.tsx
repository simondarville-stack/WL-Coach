// TODO: Consider extracting buildGridCells / buildComboGridCells into a shared printUtils module
// TODO: Consider extracting the athlete-programme and group-programme render paths into sub-components
import { useCoachStore } from '../../store/coachStore';
import type { WeekPlan, PlannedExercise, Exercise, Athlete, ComboMemberEntry } from '../../lib/database.types';
import { DAYS_OF_WEEK } from '../../lib/constants';
import { formatDateRange } from '../../lib/dateUtils';
import { calculateAge } from '../../lib/calculations';
import { parsePrescription, parseComboPrescription } from '../../lib/prescriptionParser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface PrintWeekCompactProps {
  athlete: Athlete;
  weekPlan: WeekPlan;
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  comboMembers: Record<string, ComboMemberEntry[]>;
  weekStart: string;
  weekDescription?: string | null;
  dayLabels?: Record<number, string> | null;
}

interface GridCell {
  load: number | string;
  reps: number | string;
  sets: number;
}

interface WeekExerciseSummary {
  exerciseId: string;
  exerciseCode: string;
  exerciseName: string;
  category: string;
  totalReps: number;
  avgLoad: number;
  maxLoad: number;
  frequency: number;
}

interface CategorySummary {
  category: string;
  abbreviation: string;
  totalReps: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_ABBREVIATIONS: Record<string, string> = {
  'Snatch': 'Sn',
  'Clean': 'Cl',
  'Jerk': 'Jk',
  'Clean & Jerk': 'C&J',
  'Squat': 'Sq',
  'Back Squat': 'BSq',
  'Front Squat': 'FSq',
  'Overhead Squat': 'OSq',
  'Pull': 'Pull',
  'Snatch Pull': 'SnP',
  'Clean Pull': 'ClP',
  'Press': 'Pr',
  'Push Press': 'PP',
  'Jerk from rack': 'JkR',
  'Accessories': 'Acc',
  'General': 'Gen',
  'Strength': 'Str',
  'Conditioning': 'Cond',
  'Technique': 'Tech',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SentinelType = 'text' | 'video' | 'image' | null;
function getSentinelType(code: string | null | undefined): SentinelType {
  if (code === 'TEXT') return 'text';
  if (code === 'VIDEO') return 'video';
  if (code === 'IMAGE') return 'image';
  return null;
}

function getCategoryAbbr(category: string): string {
  if (CATEGORY_ABBREVIATIONS[category]) return CATEGORY_ABBREVIATIONS[category];
  // Multi-word: initials
  const words = category.trim().split(/\s+/);
  if (words.length >= 2) return words.map(w => w[0].toUpperCase()).join('');
  return category.slice(0, 3).toUpperCase();
}

function getExerciseCode(ex: Exercise, usedCodes: Map<string, string>): string {
  if (ex.exercise_code) return ex.exercise_code;
  // Generate from name — max 4 chars
  const words = ex.name.trim().split(/\s+/);
  let code: string;
  if (words.length === 1) {
    code = words[0].slice(0, 3).toUpperCase();
  } else {
    // Initials of each word, capped at 4 chars
    code = words.map(w => w[0].toUpperCase()).join('').slice(0, 4);
  }
  // Ensure uniqueness
  let candidate = code;
  let n = 2;
  while (usedCodes.has(candidate) && usedCodes.get(candidate) !== ex.id) {
    candidate = code + n;
    n++;
  }
  usedCodes.set(candidate, ex.id);
  return candidate;
}

function buildGridCells(prescriptionRaw: string | null): GridCell[] {
  if (!prescriptionRaw?.trim()) return [];
  const parsed = parsePrescription(prescriptionRaw);
  if (parsed.length === 0) return [];

  return parsed.map(p => ({
    load: p.loadMax != null ? `${p.load}-${p.loadMax}` : p.load,
    reps: p.reps,
    sets: p.sets,
  }));
}

function buildComboGridCells(prescriptionRaw: string | null): GridCell[] {
  if (!prescriptionRaw?.trim()) return [];
  const parsed = parseComboPrescription(prescriptionRaw);
  if (parsed.length === 0) return [];

  return parsed.map(p => ({
    load: p.loadMax != null ? `${p.load}-${p.loadMax}` : p.load,
    reps: p.repsText,
    sets: p.sets,
  }));
}

function aggregateWeekExercises(
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>,
  usedCodes: Map<string, string>,
): WeekExerciseSummary[] {
  const map = new Map<string, WeekExerciseSummary>();

  Object.values(plannedExercises).forEach(dayExs => {
    dayExs.forEach(ex => {
      if (getSentinelType(ex.exercise.exercise_code)) return;
      if (!ex.exercise.counts_towards_totals) return;

      const code = getExerciseCode(ex.exercise, usedCodes);
      const existing = map.get(ex.exercise_id);
      const reps = ex.summary_total_reps || 0;
      const avgLoad = ex.summary_avg_load || 0;
      const maxLoad = ex.summary_highest_load || 0;

      if (existing) {
        const prevTotalLoad = existing.avgLoad * existing.totalReps;
        existing.totalReps += reps;
        existing.avgLoad = existing.totalReps > 0 ? (prevTotalLoad + avgLoad * reps) / existing.totalReps : 0;
        existing.maxLoad = Math.max(existing.maxLoad, maxLoad);
        existing.frequency += 1;
      } else {
        map.set(ex.exercise_id, {
          exerciseId: ex.exercise_id,
          exerciseCode: code,
          exerciseName: ex.exercise.name,
          category: ex.exercise.category || '',
          totalReps: reps,
          avgLoad: avgLoad,
          maxLoad: maxLoad,
          frequency: 1,
        });
      }
    });
  });

  return Array.from(map.values()).sort((a, b) =>
    a.category.localeCompare(b.category) || a.exerciseName.localeCompare(b.exerciseName),
  );
}

function aggregateCategories(
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>,
): CategorySummary[] {
  const map = new Map<string, number>();

  Object.values(plannedExercises).forEach(dayExs => {
    dayExs.forEach(ex => {
      if (getSentinelType(ex.exercise.exercise_code)) return;
      if (!ex.exercise.counts_towards_totals) return;
      const cat = ex.exercise.category || 'Other';
      map.set(cat, (map.get(cat) || 0) + (ex.summary_total_reps || 0));
    });
  });

  return Array.from(map.entries())
    .map(([category, totalReps]) => ({ category, abbreviation: getCategoryAbbr(category), totalReps }))
    .sort((a, b) => b.totalReps - a.totalReps);
}

function calculateWeekTotals(
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>,
): { totalReps: number; avgLoad: number; totalTonnage: number } {
  let totalReps = 0;
  let totalLoad = 0;

  Object.values(plannedExercises).forEach(dayExs => {
    dayExs.forEach(ex => {
      if (!ex.exercise.counts_towards_totals) return;
      if (getSentinelType(ex.exercise.exercise_code)) return;
      const reps = ex.summary_total_reps || 0;
      totalReps += reps;
      if (ex.unit === 'absolute_kg' && ex.summary_avg_load) {
        totalLoad += ex.summary_avg_load * reps;
      }
    });
  });

  const avgLoad = totalReps > 0 ? totalLoad / totalReps : 0;
  return { totalReps, avgLoad, totalTonnage: totalLoad / 1000 };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function unitLabel(unit: string | null): string {
  if (unit === 'percentage') return ' (%)';
  if (unit === 'rpe') return ' RPE';
  return '';
}

// Renders two <tr> rows (load + reps) plus optional notes rows for one exercise
function ExerciseRows({
  code,
  cells,
  maxCols,
  unit,
  totalReps,
  avgLoad,
  maxLoad,
  notes,
  variationNote,
}: {
  code: string;
  cells: GridCell[];
  maxCols: number;
  unit?: string | null;
  totalReps: number | null;
  avgLoad: number | null;
  maxLoad: number | null;
  notes?: string | null;
  variationNote?: string | null;
}) {
  const emptyCols = Math.max(0, maxCols - cells.length);
  const codeLabel = code + unitLabel(unit ?? null);
  return (
    <>
      {/* Load row */}
      <tr className="print-load-row">
        <td rowSpan={2} className="print-code-cell">{codeLabel}</td>
        {cells.map((c, i) => (
          <td key={i} className="print-cell">
            {typeof c.load === 'number' && c.load === 0 ? '—' : typeof c.load === 'number' ? Math.round(c.load) : c.load}
          </td>
        ))}
        {emptyCols > 0 && <td colSpan={emptyCols} />}
        <td className="print-spacer-cell" />
        <td className="print-stat-cell" />
        <td className="print-stat-cell" />
        <td className="print-stat-cell" />
      </tr>
      {/* Reps row */}
      <tr className="print-reps-row">
        {cells.map((c, i) => (
          <td key={i} className="print-cell">
            {c.reps}
            {c.sets > 1 && <sup className="print-sup">{c.sets}</sup>}
          </td>
        ))}
        {emptyCols > 0 && <td colSpan={emptyCols} />}
        <td className="print-spacer-cell" />
        <td className="print-stat-cell">{totalReps ?? '—'}</td>
        <td className="print-stat-cell">{avgLoad != null && avgLoad > 0 ? Math.round(avgLoad) : '—'}</td>
        <td className="print-stat-cell">{maxLoad != null && maxLoad > 0 ? Math.round(maxLoad) : '—'}</td>
      </tr>
      {variationNote && (
        <tr className="print-notes-tr">
          <td colSpan={maxCols + 5} className="print-notes-cell">{variationNote}</td>
        </tr>
      )}
      {notes && (
        <tr className="print-notes-tr">
          <td colSpan={maxCols + 5} className="print-notes-cell">{notes}</td>
        </tr>
      )}
    </>
  );
}

// Renders a full table for one training day — all exercises share aligned columns
function DayTable({
  dayExs,
  codeMap,
  comboMembers,
}: {
  dayExs: (PlannedExercise & { exercise: Exercise })[];
  codeMap: Map<string, string>;
  comboMembers: Record<string, ComboMemberEntry[]>;
}) {
  const maxCols = Math.max(
    1,
    ...dayExs.map(ex => {
      if (getSentinelType(ex.exercise.exercise_code)) return 0;
      if (ex.unit === 'free_text') return 0;
      if (ex.is_combo) return buildComboGridCells(ex.prescription_raw).length;
      return buildGridCells(ex.prescription_raw).length;
    }),
  );

  // total table columns: code(1) + data(maxCols) + spacer(1) + stats(3) = maxCols + 5
  const totalCols = maxCols + 5;

  return (
    <table className="print-day-table">
      <colgroup>
        <col style={{ width: '45px' }} />
        {Array.from({ length: maxCols }).map((_, i) => <col key={i} style={{ width: '34px' }} />)}
        <col style={{ width: 'auto' }} />
        <col style={{ width: '30px' }} />
        <col style={{ width: '30px' }} />
        <col style={{ width: '30px' }} />
      </colgroup>
      <tbody>
        {dayExs.map(ex => {
          const sentinel = getSentinelType(ex.exercise.exercise_code);

          if (sentinel === 'text') {
            if (!ex.notes?.trim()) return null;
            return (
              <tr key={ex.id} className="print-sentinel-tr">
                <td colSpan={totalCols} className="print-text-cell">— {ex.notes}</td>
              </tr>
            );
          }

          if (sentinel === 'video') {
            const url = ex.notes?.trim() || '';
            let display = 'attached';
            if (url) {
              const ytId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)?.[1];
              display = ytId
                ? `YouTube (${ytId})`
                : (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 30); } })();
            }
            return (
              <tr key={ex.id} className="print-sentinel-tr">
                <td colSpan={totalCols} className="print-text-cell">📎 Video: {display}</td>
              </tr>
            );
          }

          if (sentinel === 'image') {
            return (
              <tr key={ex.id} className="print-sentinel-tr">
                <td colSpan={totalCols} className="print-text-cell">📎 Image attached</td>
              </tr>
            );
          }

          if (ex.is_combo) {
            const members = (comboMembers[ex.id] ?? []).sort((a, b) => a.position - b.position);
            // Always use short member codes for compact layout (ignore long combo_notation)
            const memberCodes = members.map(m =>
              codeMap.get(m.exercise_id) ||
              m.exercise.name.split(/\s+/).map((w: string) => w[0].toUpperCase()).join('').slice(0, 4),
            ).join('+');
            const shortNotation = ex.combo_notation && ex.combo_notation.length <= 8 ? ex.combo_notation : memberCodes;
            const comboCode = '●● ' + shortNotation;
            const cells = buildComboGridCells(ex.prescription_raw);
            return (
              <ExerciseRows
                key={ex.id}
                code={comboCode}
                cells={cells}
                maxCols={maxCols}
                totalReps={ex.summary_total_reps}
                avgLoad={ex.summary_avg_load}
                maxLoad={ex.summary_highest_load}
                notes={ex.notes}
                variationNote={ex.variation_note}
              />
            );
          }

          const code = codeMap.get(ex.exercise_id) || getExerciseCode(ex.exercise, new Map());
          const cells = buildGridCells(ex.prescription_raw);

          if (ex.unit === 'free_text' || (cells.length === 0 && ex.prescription_raw?.trim())) {
            return (
              <tr key={ex.id}>
                <td className="print-code-cell">{code}</td>
                <td colSpan={maxCols} className="print-free-text-cell">{ex.prescription_raw}</td>
                <td className="print-spacer-cell" />
                <td className="print-stat-cell">—</td>
                <td className="print-stat-cell">—</td>
                <td className="print-stat-cell">—</td>
              </tr>
            );
          }

          return (
            <ExerciseRows
              key={ex.id}
              code={code}
              cells={cells}
              maxCols={maxCols}
              unit={ex.unit}
              totalReps={ex.summary_total_reps}
              avgLoad={ex.summary_avg_load}
              maxLoad={ex.summary_highest_load}
              notes={ex.notes}
              variationNote={ex.variation_note}
            />
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PrintWeekCompact({
  athlete,
  weekPlan,
  plannedExercises,
  comboMembers,
  weekStart,
  weekDescription,
  dayLabels,
}: PrintWeekCompactProps) {
  const { activeCoach } = useCoachStore();
  const age = calculateAge(athlete.birthdate);
  const usedCodes = new Map<string, string>();

  const weekTotals = calculateWeekTotals(plannedExercises);
  const categorySummaries = aggregateCategories(plannedExercises);
  const exerciseSummaries = aggregateWeekExercises(plannedExercises, usedCodes);

  // Re-build usedCodes for day rendering (same map, already populated)
  const codeMap = new Map<string, string>();
  exerciseSummaries.forEach(s => codeMap.set(s.exerciseId, s.exerciseCode));

  const getDayLabel = (dayIndex: number): string => {
    const labels = dayLabels || weekPlan.day_labels;
    const base = (labels?.[dayIndex]) || DAYS_OF_WEEK.find(d => d.index === dayIndex)?.name || `Day ${dayIndex}`;
    const schedule = weekPlan.day_schedule as Record<number, { weekday: number; time: string | null }> | null;
    const entry = schedule?.[dayIndex];
    if (!entry) return base;
    const wdName = WEEKDAY_NAMES_FULL[entry.weekday];
    const timeSuffix = entry.time ? ` ${entry.time}` : '';
    return `${base} (${wdName}${timeSuffix})`;
  };

  const activeDays = weekPlan.active_days || [1, 2, 3, 4, 5, 6, 7];

  // Chunk exercise summaries into 3 columns
  const summaryChunks: WeekExerciseSummary[][] = [[], [], []];
  exerciseSummaries.forEach((s, i) => summaryChunks[i % 3].push(s));

  return (
    <>
      <style>{COMPACT_PRINT_CSS}</style>

      {/* Screen preview wrapper */}
      <div className="bg-gray-100 p-6 flex justify-center print:p-0 print:bg-white min-h-screen">
        <div
          id="print-compact-root"
          className="bg-white shadow-md border border-gray-300 print:shadow-none print:border-none print-compact"
          style={{ width: '210mm', minHeight: '297mm', padding: '8mm 10mm', boxSizing: 'border-box' }}
        >
          {/* ── Header ── */}
          <div className="print-header">
            <div className="print-header-left">
              {activeCoach?.name && <div className="print-muted" style={{ fontSize: '7pt' }}>{activeCoach.name}</div>}
              <div className="print-athlete-name">{athlete.name}</div>
              <div className="print-athlete-sub">
                {age !== null && `${age} y`}
                {athlete.bodyweight && ` · ${athlete.bodyweight}kg`}
                {athlete.weight_class && ` · ${athlete.weight_class}`}
              </div>
            </div>
            <div className="print-header-center">WEEKLY PLAN</div>
            <div className="print-header-right">
              {activeCoach?.club_name && <div className="print-muted" style={{ fontSize: '7pt' }}>{activeCoach.club_name}</div>}
              <div>{formatDateRange(weekStart)}</div>
              <div className="print-muted">Week {weekPlan.week_number} / {new Date(weekStart).getFullYear()}</div>
            </div>
          </div>

          {weekDescription?.trim() && (
            <div className="print-week-desc">{weekDescription}</div>
          )}

          {/* ── Weekly totals ── */}
          {weekTotals.totalReps > 0 && (
            <div className="print-section">
              <div className="print-totals-row">
                <span>
                  <strong>{weekTotals.totalReps}</strong> reps
                  {weekTotals.avgLoad > 0 && <> · <strong>{weekTotals.avgLoad.toFixed(1)}</strong> kg avg</>}
                  {weekTotals.totalTonnage > 0 && <> · <strong>{weekTotals.totalTonnage.toFixed(1)}</strong> t</>}
                </span>
                <span className="print-cat-row">
                  {categorySummaries.map(c => (
                    <span key={c.category} className="print-cat-item">
                      <strong>{c.abbreviation}</strong>: {c.totalReps}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          )}

          {/* ── Exercise summary table ── */}
          {exerciseSummaries.length > 0 && (
            <div className="print-section">
              <table className="print-summary-table">
                <tbody>
                  {/* Build rows of 3 exercises side by side */}
                  {Array.from({ length: Math.ceil(exerciseSummaries.length / 3) }).map((_, ri) => {
                    const row = exerciseSummaries.slice(ri * 3, ri * 3 + 3);
                    return (
                      <tr key={ri}>
                        {row.map((s, ci) => (
                          <>
                            {ci > 0 && <td key={`sep-${ci}`} className="print-summary-sep">│</td>}
                            <td key={`code-${s.exerciseId}`} className="print-sum-code">{s.exerciseCode}</td>
                            <td key={`wh-${s.exerciseId}`} className="print-sum-stat">{s.totalReps}</td>
                            <td key={`mhg-${s.exerciseId}`} className="print-sum-stat">{s.avgLoad > 0 ? Math.round(s.avgLoad) : '—'}</td>
                            <td key={`bw-${s.exerciseId}`} className="print-sum-stat">{s.maxLoad > 0 ? Math.round(s.maxLoad) : '—'}</td>
                            <td key={`freq-${s.exerciseId}`} className="print-sum-freq">{s.frequency}d</td>
                          </>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="print-ex-summary-legend">
                Code · WH (reps) · MHG (avg kg) · BW (max kg) · Days
              </div>
            </div>
          )}

          {/* ── Daily blocks ── */}
          {activeDays.map(dayIndex => {
            const dayExs = (plannedExercises[dayIndex] || [])
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
            if (dayExs.length === 0) return null;

            const dayLabel = getDayLabel(dayIndex);

            // Day totals
            const dayReps = dayExs
              .filter(ex => ex.exercise.counts_towards_totals && !getSentinelType(ex.exercise.exercise_code))
              .reduce((s, ex) => s + (ex.summary_total_reps || 0), 0);

            return (
              <div key={dayIndex} className="print-day-block">
                {/* Day header */}
                <div className="print-day-header">
                  <span className="print-day-name">{dayLabel}</span>
                  <span className="print-day-rule" />
                  <span className="print-day-col-headers">WH&nbsp;&nbsp;MHG&nbsp;&nbsp;&nbsp;BW</span>
                </div>

                <DayTable
                  dayExs={dayExs}
                  codeMap={codeMap}
                  comboMembers={comboMembers}
                />

                {dayReps > 0 && (
                  <div className="print-day-total">Total: {dayReps} reps</div>
                )}
              </div>
            );
          })}

          {/* ── Footer ── */}
          <div className="print-footer">
            Generated by WinWota 2.0 · {new Date().toLocaleDateString('en-GB')}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Print CSS
// ---------------------------------------------------------------------------

const COMPACT_PRINT_CSS = `
  .print-compact {
    font-family: 'Courier New', Consolas, monospace;
    font-size: 9px;
    line-height: 1.4;
    color: #000;
  }

  /* Header */
  .print-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    border-bottom: 1px solid #000;
    padding-bottom: 3px;
    margin-bottom: 4px;
  }
  .print-header-left { flex: 1; }
  .print-header-center {
    font-weight: bold;
    font-size: 11px;
    letter-spacing: 2px;
    text-align: center;
    flex: 1;
  }
  .print-header-right { flex: 1; text-align: right; }
  .print-athlete-name { font-size: 11px; font-weight: bold; }
  .print-athlete-sub { font-size: 8px; color: #555; }
  .print-muted { color: #666; }
  .print-week-desc {
    font-style: italic;
    font-size: 8px;
    margin-bottom: 4px;
    color: #444;
  }

  /* Section divider */
  .print-section {
    border-top: 0.5px solid #ccc;
    padding: 3px 0;
    margin-bottom: 2px;
  }

  /* Weekly totals */
  .print-totals-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px;
  }
  .print-cat-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .print-cat-item { white-space: nowrap; }

  /* Exercise summary table */
  .print-summary-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8px;
    font-family: 'Courier New', Consolas, monospace;
  }
  .print-summary-table td {
    padding: 0 2px;
    line-height: 1.3;
    white-space: nowrap;
  }
  .print-sum-code { font-weight: bold; width: 28px; }
  .print-sum-stat { text-align: right; width: 28px; }
  .print-sum-freq { text-align: right; width: 16px; color: #666; }
  .print-summary-sep { color: #bbb; padding: 0 3px; width: 10px; text-align: center; }
  .print-ex-summary-legend {
    font-size: 7px;
    color: #999;
    margin-top: 2px;
    font-style: italic;
  }

  /* Day header */
  .print-day-block {
    border-top: 0.5px solid #000;
    padding-top: 2px;
    margin-top: 4px;
    margin-bottom: 2px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .print-day-header {
    display: flex;
    align-items: baseline;
    margin-bottom: 1px;
    font-weight: bold;
    font-size: 9px;
    gap: 4px;
  }
  .print-day-name { white-space: nowrap; font-weight: bold; }
  .print-day-rule {
    flex: 1;
    border-bottom: 0.5px solid #000;
    margin: 0 4px;
    align-self: flex-end;
    margin-bottom: 2px;
  }
  .print-day-col-headers {
    white-space: nowrap;
    font-size: 8px;
    font-weight: normal;
    color: #333;
    min-width: 90px;
    text-align: right;
  }
  .print-day-total {
    font-size: 7px;
    color: #888;
    text-align: right;
    margin-top: 1px;
  }

  /* Day table — all exercises in a day share aligned columns */
  .print-day-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin-bottom: 1px;
  }
  .print-day-table td {
    padding: 0 2px;
    font-size: 8px;
    line-height: 1.2;
    vertical-align: baseline;
    white-space: nowrap;
    overflow: hidden;
  }
  .print-code-cell {
    font-weight: bold;
    font-size: 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    vertical-align: middle !important;
  }
  .print-cell {
    text-align: right;
    font-size: 8px;
  }
  .print-spacer-cell {
    /* fills remaining space */
  }
  .print-stat-cell {
    text-align: right;
    font-size: 8px;
    font-weight: bold;
  }
  .print-sup {
    font-size: 6px;
    vertical-align: super;
    line-height: 0;
  }
  .print-load-row td { padding-bottom: 0; }
  .print-reps-row td { padding-top: 0; padding-bottom: 1px; }
  .print-notes-tr td { padding: 0; }
  .print-notes-cell {
    font-style: italic;
    font-size: 7.5px;
    color: #444;
    padding-left: 47px !important;
    line-height: 1.2;
  }
  .print-text-cell {
    font-style: italic;
    font-size: 8px;
    color: #333;
    padding: 1px 0;
  }
  .print-free-text-cell {
    font-size: 8px;
    color: #555;
  }
  .print-sentinel-tr td {
    padding: 1px 0;
  }

  /* Footer */
  .print-footer {
    margin-top: 8px;
    font-size: 7px;
    color: #aaa;
    text-align: center;
    border-top: 0.5px solid #ddd;
    padding-top: 3px;
  }

  @media print {
    body > * { display: none !important; }
    #print-compact-root { display: block !important; }

    @page {
      size: A4 portrait;
      margin: 8mm 10mm;
    }

    #print-compact-root {
      width: 100% !important;
      min-height: auto !important;
      padding: 0 !important;
      box-shadow: none !important;
      border: none !important;
    }

    .print-day-block {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .print\\:hidden { display: none !important; }
  }
`;
