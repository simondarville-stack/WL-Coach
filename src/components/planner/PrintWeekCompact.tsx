import type { WeekPlan, PlannedExercise, Exercise, Athlete, ComboMemberEntry } from '../../lib/database.types';
import { DAYS_OF_WEEK } from '../../lib/constants';
import { formatDateRange } from '../../lib/dateUtils';
import { calculateAge } from '../../lib/calculations';
import { parsePrescription, parseComboPrescription } from '../../lib/prescriptionParser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  showSuperscript: boolean;
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
  if (parsed.length === 0) return parsed.map(() => ({ load: '?', reps: '?', sets: 1, showSuperscript: false }));

  const cells: GridCell[] = parsed.map(p => ({
    load: p.load,
    reps: p.reps,
    sets: p.sets,
    showSuperscript: false,
  }));

  // Mark last cell of consecutive same-sets groups where sets > 1
  let i = 0;
  while (i < cells.length) {
    const s = cells[i].sets;
    if (s <= 1) { i++; continue; }
    let j = i;
    while (j < cells.length && cells[j].sets === s) j++;
    cells[j - 1].showSuperscript = true;
    i = j;
  }

  return cells;
}

function buildComboGridCells(prescriptionRaw: string | null): GridCell[] {
  if (!prescriptionRaw?.trim()) return [];
  const parsed = parseComboPrescription(prescriptionRaw);
  if (parsed.length === 0) return [];

  const cells: GridCell[] = parsed.map(p => ({
    load: p.load,
    reps: p.repsText,
    sets: p.sets,
    showSuperscript: false,
  }));

  let i = 0;
  while (i < cells.length) {
    const s = cells[i].sets;
    if (s <= 1) { i++; continue; }
    let j = i;
    while (j < cells.length && cells[j].sets === s) j++;
    cells[j - 1].showSuperscript = true;
    i = j;
  }
  return cells;
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

function ExerciseGridRow({
  code,
  cells,
  unit,
  totalReps,
  avgLoad,
  maxLoad,
  notes,
  variationNote,
}: {
  code: string;
  cells: GridCell[];
  unit: string | null;
  totalReps: number | null;
  avgLoad: number | null;
  maxLoad: number | null;
  notes?: string | null;
  variationNote?: string | null;
}) {
  const unitSuffix = unit === 'percentage' ? '%' : '';
  const CELL_W = 30; // px

  return (
    <div className="print-exercise-block">
      {/* Load row */}
      <div className="flex items-baseline">
        <div className="print-code-col font-bold">{code}</div>
        <div className="flex flex-1 flex-wrap">
          {cells.map((c, i) => (
            <div key={i} className="print-cell text-right" style={{ minWidth: CELL_W }}>
              {typeof c.load === 'number' && c.load === 0 ? '—' : `${c.load}${unitSuffix}`}
            </div>
          ))}
        </div>
        {/* spacer to align WH/MHG/BW */}
        <div className="print-summary-spacer" />
      </div>
      {/* Reps row */}
      <div className="flex items-baseline">
        <div className="print-code-col" />
        <div className="flex flex-1 flex-wrap">
          {cells.map((c, i) => (
            <div key={i} className="print-cell text-right" style={{ minWidth: CELL_W }}>
              {c.reps}
              {c.showSuperscript && c.sets > 1 && (
                <sup className="text-[6px]">{c.sets}</sup>
              )}
            </div>
          ))}
        </div>
        <div className="print-summary-cols">
          <span>{totalReps ?? '—'}</span>
          <span>{avgLoad != null && avgLoad > 0 ? Math.round(avgLoad) : '—'}</span>
          <span>{maxLoad != null && maxLoad > 0 ? Math.round(maxLoad) : '—'}</span>
        </div>
      </div>
      {variationNote && (
        <div className="print-notes-row">{variationNote}</div>
      )}
      {notes && (
        <div className="print-notes-row">{notes}</div>
      )}
    </div>
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
    if (labels?.[dayIndex]) return labels[dayIndex];
    return DAYS_OF_WEEK.find(d => d.index === dayIndex)?.name || `Day ${dayIndex}`;
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
              <div className="print-athlete-name">{athlete.name}</div>
              <div className="print-athlete-sub">
                {age !== null && `${age} y`}
                {athlete.bodyweight && ` · ${athlete.bodyweight}kg`}
                {athlete.weight_class && ` · ${athlete.weight_class}`}
              </div>
            </div>
            <div className="print-header-center">WEEKLY PLAN</div>
            <div className="print-header-right">
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
              <div className="print-ex-summary-grid">
                {summaryChunks.map((chunk, ci) => (
                  <div key={ci} className="print-ex-summary-col">
                    {chunk.map(s => (
                      <div key={s.exerciseId} className="print-ex-summary-row">
                        <span className="print-ex-code">{s.exerciseCode}</span>
                        <span className="print-ex-stat">{s.totalReps}</span>
                        <span className="print-ex-stat">{s.avgLoad > 0 ? Math.round(s.avgLoad) : '—'}</span>
                        <span className="print-ex-stat">{s.maxLoad > 0 ? Math.round(s.maxLoad) : '—'}</span>
                        <span className="print-ex-freq">{s.frequency}d</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {/* Summary header labels */}
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

                {dayExs.map(ex => {
                  const sentinel = getSentinelType(ex.exercise.exercise_code);

                  // TEXT sentinel
                  if (sentinel === 'text') {
                    if (!ex.notes?.trim()) return null;
                    return (
                      <div key={ex.id} className="print-text-row">
                        — {ex.notes}
                      </div>
                    );
                  }

                  // VIDEO sentinel
                  if (sentinel === 'video') {
                    const url = ex.notes?.trim() || '';
                    return (
                      <div key={ex.id} className="print-text-row">
                        📎 Video: {url.length > 50 ? url.slice(0, 47) + '…' : url}
                      </div>
                    );
                  }

                  // IMAGE sentinel
                  if (sentinel === 'image') {
                    return (
                      <div key={ex.id} className="print-text-row">
                        📎 Image: {ex.notes?.trim() || 'attached image'}
                      </div>
                    );
                  }

                  // Combo exercise
                  if (ex.is_combo) {
                    const members = (comboMembers[ex.id] ?? []).sort((a, b) => a.position - b.position);
                    const comboCode = ex.combo_notation ||
                      members.map(m => codeMap.get(m.exercise_id) || m.exercise.name.slice(0, 3).toUpperCase()).join('+');
                    const cells = buildComboGridCells(ex.prescription_raw);

                    return (
                      <div key={ex.id} className="print-exercise-block">
                        {/* Load row */}
                        <div className="flex items-baseline">
                          <div className="print-code-col font-bold text-[8px]">{comboCode}</div>
                          <div className="flex flex-1 flex-wrap">
                            {cells.map((c, i) => (
                              <div key={i} className="print-cell text-right">
                                {c.load === 0 ? '—' : `${c.load}`}
                              </div>
                            ))}
                          </div>
                          <div className="print-summary-spacer" />
                        </div>
                        {/* Reps row */}
                        <div className="flex items-baseline">
                          <div className="print-code-col" />
                          <div className="flex flex-1 flex-wrap">
                            {cells.map((c, i) => (
                              <div key={i} className="print-cell text-right">
                                {c.reps}
                                {c.showSuperscript && c.sets > 1 && <sup className="text-[6px]">{c.sets}</sup>}
                              </div>
                            ))}
                          </div>
                          <div className="print-summary-cols">
                            <span>{ex.summary_total_reps ?? '—'}</span>
                            <span>{ex.summary_avg_load != null && ex.summary_avg_load > 0 ? Math.round(ex.summary_avg_load) : '—'}</span>
                            <span>{ex.summary_highest_load != null && ex.summary_highest_load > 0 ? Math.round(ex.summary_highest_load) : '—'}</span>
                          </div>
                        </div>
                        {ex.variation_note && <div className="print-notes-row">{ex.variation_note}</div>}
                        {ex.notes && <div className="print-notes-row">{ex.notes}</div>}
                      </div>
                    );
                  }

                  // Regular exercise
                  const code = codeMap.get(ex.exercise_id) || getExerciseCode(ex.exercise, new Map());
                  const cells = buildGridCells(ex.prescription_raw);

                  // Free-text unit — no grid
                  if (ex.unit === 'free_text' || (cells.length === 0 && ex.prescription_raw?.trim())) {
                    return (
                      <div key={ex.id} className="print-exercise-block">
                        <div className="flex items-baseline gap-2">
                          <div className="print-code-col font-bold">{code}</div>
                          <div className="print-muted flex-1">{ex.prescription_raw}</div>
                          <div className="print-summary-cols">
                            <span>—</span><span>—</span><span>—</span>
                          </div>
                        </div>
                        {ex.notes && <div className="print-notes-row">{ex.notes}</div>}
                      </div>
                    );
                  }

                  return (
                    <ExerciseGridRow
                      key={ex.id}
                      code={code}
                      cells={cells}
                      unit={ex.unit}
                      totalReps={ex.summary_total_reps}
                      avgLoad={ex.summary_avg_load}
                      maxLoad={ex.summary_highest_load}
                      notes={ex.notes}
                      variationNote={ex.variation_note}
                    />
                  );
                })}

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

  /* Exercise summary */
  .print-ex-summary-grid {
    display: grid;
    grid-template-columns: 1fr 1px 1fr 1px 1fr;
    gap: 0 4px;
  }
  .print-ex-summary-col { display: flex; flex-direction: column; gap: 1px; }
  .print-ex-summary-row {
    display: flex;
    gap: 4px;
    font-size: 8px;
  }
  .print-ex-code { font-weight: bold; min-width: 30px; }
  .print-ex-stat { min-width: 26px; text-align: right; }
  .print-ex-freq { min-width: 16px; text-align: right; color: #666; }
  .print-ex-summary-legend {
    font-size: 7px;
    color: #999;
    margin-top: 2px;
    font-style: italic;
  }

  /* Day header */
  .print-day-block {
    border-top: 0.5px solid #000;
    padding-top: 3px;
    margin-top: 3px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .print-day-header {
    display: flex;
    align-items: center;
    margin-bottom: 2px;
    font-weight: bold;
    font-size: 9px;
    gap: 4px;
  }
  .print-day-name { white-space: nowrap; }
  .print-day-rule {
    flex: 1;
    height: 0.5px;
    background: #000;
  }
  .print-day-col-headers {
    white-space: nowrap;
    font-size: 8px;
    font-weight: normal;
    color: #333;
    min-width: 90px;
    text-align: right;
  }

  /* Exercise rows */
  .print-exercise-block {
    margin-bottom: 2px;
  }
  .print-code-col {
    min-width: 45px;
    max-width: 45px;
    font-size: 8px;
    font-weight: bold;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .print-cell {
    min-width: 28px;
    max-width: 36px;
    font-size: 8px;
    padding: 0 2px;
    flex-shrink: 0;
  }
  .print-summary-spacer {
    min-width: 90px;
  }
  .print-summary-cols {
    display: flex;
    gap: 0;
    min-width: 90px;
    justify-content: flex-end;
    font-size: 8px;
    font-weight: bold;
  }
  .print-summary-cols span {
    min-width: 30px;
    text-align: right;
  }
  .print-notes-row {
    font-style: italic;
    font-size: 8px;
    color: #444;
    padding-left: 38px;
    margin-bottom: 1px;
  }
  .print-text-row {
    font-style: italic;
    font-size: 8px;
    color: #333;
    padding: 1px 0;
  }
  .print-day-total {
    font-size: 7px;
    color: #888;
    text-align: right;
    margin-top: 1px;
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
