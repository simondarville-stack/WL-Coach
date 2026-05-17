/**
 * PrintWeekDesigner — second print mode for weekly programmes.
 *
 * A from-scratch designer that lets the coach toggle sections on/off and
 * adjust layout density before printing or exporting to PDF. Renders inside
 * PrintWeek's modal frame; data is loaded by PrintWeek and passed in.
 *
 * Persists user preferences in localStorage so the next print starts with
 * the same look. The control sidebar is hidden at print time; only the
 * programme page is sent to paper.
 */
import { useEffect, useState } from 'react';
import { RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { useCoachStore } from '../../store/coachStore';
import type { WeekPlan, PlannedExercise, Exercise, Athlete, ComboMemberEntry } from '../../lib/database.types';
import { DAYS_OF_WEEK, getUnitSymbol } from '../../lib/constants';
import { formatDateRange, formatDateToDDMMYYYY } from '../../lib/dateUtils';
import { calculateAge } from '../../lib/calculations';
import { parsePrescription, parseComboPrescription, parseFreeTextPrescription } from '../../lib/prescriptionParser';
import { fetchWeekLog } from '../../lib/trainingLogService';
import type { TrainingLogSet } from '../../lib/database.types';

// ─── Types & defaults ──────────────────────────────────────────────────────

type Density = 'comfortable' | 'normal' | 'compact';
type Orientation = 'portrait' | 'landscape';
type FontSize = 'small' | 'normal' | 'large';
type Columns = 1 | 2;

interface DesignerOptions {
  density: Density;
  orientation: Orientation;
  fontSize: FontSize;
  columns: Columns;
  showCoachHeader: boolean;
  showAthleteDetails: boolean;
  showWeekDates: boolean;
  showWeekNotes: boolean;
  showWeeklyTotals: boolean;
  showCategorySummary: boolean;
  showDayTotals: boolean;
  showSummaryBadges: boolean;
  showExerciseNotes: boolean;
  showVariationNotes: boolean;
  showComboMembers: boolean;
  showColorAccents: boolean;
  showDayDividers: boolean;
  hideEmptyDays: boolean;
  showFooter: boolean;
  /** P6 — print parity: include athlete-logged actuals under each
   *  planned exercise. */
  showLog: boolean;
}

const DEFAULT_OPTIONS: DesignerOptions = {
  density: 'normal',
  orientation: 'portrait',
  fontSize: 'normal',
  columns: 1,
  showCoachHeader: true,
  showAthleteDetails: true,
  showWeekDates: true,
  showWeekNotes: true,
  showWeeklyTotals: true,
  showCategorySummary: true,
  showDayTotals: true,
  showSummaryBadges: true,
  showExerciseNotes: true,
  showVariationNotes: true,
  showComboMembers: true,
  showColorAccents: true,
  showDayDividers: true,
  hideEmptyDays: true,
  showFooter: true,
  showLog: false,
};

const STORAGE_KEY = 'emos.print.designer.options.v1';

function loadOptions(): DesignerOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_OPTIONS;
    return { ...DEFAULT_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function saveOptions(opts: DesignerOptions) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(opts)); } catch { /* ignore */ }
}

// ─── Helpers (mirrors PrintWeek) ───────────────────────────────────────────

type SentinelType = 'text' | 'video' | 'image' | null;
function getSentinelType(code: string | null | undefined): SentinelType {
  if (code === 'TEXT') return 'text';
  if (code === 'VIDEO') return 'video';
  if (code === 'IMAGE') return 'image';
  return null;
}
function getYouTubeVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? m[1] : null;
}

// ISO 8601 week number — Thursday-based, ISO standard.
function isoWeekNumber(dateStr: string): number {
  const d = new Date(dateStr);
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const WEEKDAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ─── Inline prescription block ─────────────────────────────────────────────

function PrescriptionBlock({ prescription, unit, isCombo }: { prescription: string | null; unit: string | null; isCombo?: boolean }) {
  if (!prescription?.trim()) return <span className="dz-no-rx">No prescription</span>;
  const unitSym = unit === 'percentage' ? '%' : unit === 'rpe' ? ' RPE' : '';

  if (unit === 'free_text_reps') {
    const lines = parseFreeTextPrescription(prescription);
    if (lines.length === 0) return <span>{prescription}</span>;
    return (
      <div className="dz-rx-row">
        {lines.map((line, i) => (
          <div key={i} className="dz-rx-cell">
            <div className="dz-rx-stack">
              <span className="dz-rx-load">{line.loadText || ' '}</span>
              <div className="dz-rx-bar" />
              <span className="dz-rx-reps">{line.reps}</span>
            </div>
            {line.sets > 1 && <span className="dz-rx-sets">{line.sets}</span>}
          </div>
        ))}
      </div>
    );
  }

  if (isCombo) {
    const parsed = parseComboPrescription(prescription);
    if (parsed.length === 0) return <span>{prescription}</span>;
    return (
      <div className="dz-rx-row">
        {parsed.map((line, i) => (
          <div key={i} className="dz-rx-cell">
            <div className="dz-rx-stack">
              <span className="dz-rx-load">
                {line.loadMax != null ? `${line.load}-${line.loadMax}${unitSym}` : `${line.load}${unitSym}`}
              </span>
              <div className="dz-rx-bar" />
              <span className="dz-rx-reps">{line.repsText}</span>
            </div>
            {line.sets > 1 && <span className="dz-rx-sets">{line.sets}</span>}
          </div>
        ))}
      </div>
    );
  }

  const parsed = parsePrescription(prescription);
  if (parsed.length === 0) return <span>{prescription}</span>;
  return (
    <div className="dz-rx-row">
      {parsed.map((line, i) => (
        <div key={i} className="dz-rx-cell">
          <div className="dz-rx-stack">
            <span className="dz-rx-load">
              {line.loadMax != null ? `${line.load}-${line.loadMax}${unitSym}` : `${line.load}${unitSym}`}
            </span>
            <div className="dz-rx-bar" />
            <span className="dz-rx-reps">{line.reps}</span>
          </div>
          {line.sets > 1 && <span className="dz-rx-sets">{line.sets}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Sidebar primitives ────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-200">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-700 hover:bg-gray-50"
      >
        <span>{title}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <span>{label}</span>
    </label>
  );
}

function SegmentedControl<T extends string | number>({
  label, value, options, onChange,
}: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      <div className="flex rounded border border-gray-300 overflow-hidden bg-white">
        {options.map(opt => (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-2 py-1 text-[11px] transition-colors ${value === opt.value ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

interface PrintWeekDesignerProps {
  athlete: Athlete;
  weekPlan: WeekPlan;
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  comboMembers: Record<string, ComboMemberEntry[]>;
  weekStart: string;
  weekDescription?: string | null;
  dayLabels?: Record<number, string> | null;
}

export function PrintWeekDesigner({
  athlete, weekPlan, plannedExercises, comboMembers, weekStart, weekDescription, dayLabels,
}: PrintWeekDesignerProps) {
  const { activeCoach } = useCoachStore();
  const [opts, setOpts] = useState<DesignerOptions>(() => loadOptions());

  useEffect(() => { saveOptions(opts); }, [opts]);

  const set = <K extends keyof DesignerOptions>(key: K, value: DesignerOptions[K]) =>
    setOpts(prev => ({ ...prev, [key]: value }));

  // P6 — when "Include athlete's actuals" is on, load the week's log
  // once and pass the per-planned-exercise sets map through to render.
  const [loggedByPlannedId, setLoggedByPlannedId] = useState<Map<string, TrainingLogSet[]>>(new Map());
  useEffect(() => {
    if (!opts.showLog) {
      setLoggedByPlannedId(new Map());
      return;
    }
    let cancelled = false;
    fetchWeekLog(athlete.id, weekStart)
      .then(weekLog => {
        if (cancelled) return;
        const map = new Map<string, TrainingLogSet[]>();
        Object.values(weekLog).forEach(day => {
          day.exercises.forEach(le => {
            if (le.log.planned_exercise_id) {
              map.set(le.log.planned_exercise_id, le.sets);
            }
          });
        });
        setLoggedByPlannedId(map);
      })
      .catch(() => {
        // Soft-fail: print continues without log overlay.
      });
    return () => { cancelled = true; };
  }, [opts.showLog, athlete.id, weekStart]);

  const age = calculateAge(athlete.birthdate);

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
  const visibleDays = activeDays
    .map(dayIndex => ({ index: dayIndex, name: getDayLabel(dayIndex), exercises: (plannedExercises[dayIndex] || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) }))
    .filter(d => !opts.hideEmptyDays || d.exercises.length > 0);

  // ── Aggregates ────────────────────────────────────────────────────────
  const categorySummaries: Record<string, { sets: number; reps: number; load: number }> = {};
  Object.values(plannedExercises).forEach(dayExs => {
    dayExs.forEach(ex => {
      if (!ex.exercise.counts_towards_totals) return;
      if (!ex.exercise.category || ex.exercise.category === '— System') return;
      const cat = ex.exercise.category;
      if (!categorySummaries[cat]) categorySummaries[cat] = { sets: 0, reps: 0, load: 0 };
      categorySummaries[cat].sets += ex.summary_total_sets || 0;
      categorySummaries[cat].reps += ex.summary_total_reps || 0;
      if (ex.unit === 'absolute_kg' && ex.summary_avg_load) {
        categorySummaries[cat].load += ex.summary_avg_load * (ex.summary_total_reps || 0);
      }
    });
  });

  let weekSets = 0, weekReps = 0, weekLoad = 0;
  Object.values(plannedExercises).forEach(dayExs => {
    dayExs.forEach(ex => {
      if (!ex.exercise.counts_towards_totals) return;
      weekSets += ex.summary_total_sets || 0;
      weekReps += ex.summary_total_reps || 0;
      if (ex.unit === 'absolute_kg' && ex.summary_avg_load) {
        weekLoad += ex.summary_avg_load * (ex.summary_total_reps || 0);
      }
    });
  });

  const orientationClass = `dz-${opts.orientation}`;
  const densityClass = `dz-density-${opts.density}`;
  const fontClass = `dz-font-${opts.fontSize}`;
  const columnsClass = `dz-cols-${opts.columns}`;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-[calc(100vh-60px)]">
      {/* Sidebar — print:hidden */}
      <aside className="w-72 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto print:hidden">
        <Section title="Page setup">
          <SegmentedControl
            label="Orientation"
            value={opts.orientation}
            options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]}
            onChange={v => set('orientation', v)}
          />
          <SegmentedControl
            label="Density"
            value={opts.density}
            options={[{ value: 'comfortable', label: 'Roomy' }, { value: 'normal', label: 'Normal' }, { value: 'compact', label: 'Tight' }]}
            onChange={v => set('density', v)}
          />
          <SegmentedControl
            label="Font size"
            value={opts.fontSize}
            options={[{ value: 'small', label: 'S' }, { value: 'normal', label: 'M' }, { value: 'large', label: 'L' }]}
            onChange={v => set('fontSize', v)}
          />
          <SegmentedControl
            label="Columns"
            value={opts.columns}
            options={[{ value: 1, label: '1 column' }, { value: 2, label: '2 columns' }]}
            onChange={v => set('columns', v)}
          />
        </Section>

        <Section title="Header">
          <Toggle label="Coach name & club" checked={opts.showCoachHeader} onChange={v => set('showCoachHeader', v)} />
          <Toggle label="Athlete details" checked={opts.showAthleteDetails} onChange={v => set('showAthleteDetails', v)} />
          <Toggle label="Week dates" checked={opts.showWeekDates} onChange={v => set('showWeekDates', v)} />
          <Toggle label="Week notes" checked={opts.showWeekNotes} onChange={v => set('showWeekNotes', v)} />
        </Section>

        <Section title="Summary">
          <Toggle label="Weekly totals" checked={opts.showWeeklyTotals} onChange={v => set('showWeeklyTotals', v)} />
          <Toggle label="Category breakdown" checked={opts.showCategorySummary} onChange={v => set('showCategorySummary', v)} />
          <Toggle label="Per-day totals" checked={opts.showDayTotals} onChange={v => set('showDayTotals', v)} />
        </Section>

        <Section title="Exercise rows">
          <Toggle label="Summary stats (S R Hi Avg)" checked={opts.showSummaryBadges} onChange={v => set('showSummaryBadges', v)} />
          <Toggle label="Notes" checked={opts.showExerciseNotes} onChange={v => set('showExerciseNotes', v)} />
          <Toggle label="Variation notes" checked={opts.showVariationNotes} onChange={v => set('showVariationNotes', v)} />
          <Toggle label="Combo member list" checked={opts.showComboMembers} onChange={v => set('showComboMembers', v)} />
          <Toggle label="Colored accent bar" checked={opts.showColorAccents} onChange={v => set('showColorAccents', v)} />
        </Section>

        <Section title="Layout" defaultOpen={false}>
          <Toggle label="Day divider lines" checked={opts.showDayDividers} onChange={v => set('showDayDividers', v)} />
          <Toggle label="Hide empty days" checked={opts.hideEmptyDays} onChange={v => set('hideEmptyDays', v)} />
          <Toggle label="Footer (generated by EMOS)" checked={opts.showFooter} onChange={v => set('showFooter', v)} />
        </Section>

        <Section title="Log" defaultOpen={false}>
          <Toggle
            label="Include athlete's actuals"
            checked={opts.showLog}
            onChange={v => set('showLog', v)}
          />
        </Section>

        <div className="p-3">
          <button
            onClick={() => setOpts(DEFAULT_OPTIONS)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
          >
            <RotateCcw size={12} />
            Reset to defaults
          </button>
        </div>
      </aside>

      {/* Preview area */}
      <div className="flex-1 overflow-auto bg-gray-200 p-6 print:p-0 print:bg-white print:overflow-visible">
        <div
          id="dz-page"
          className={`dz-page mx-auto bg-white shadow-md print:shadow-none ${orientationClass} ${densityClass} ${fontClass} ${columnsClass}`}
        >
          <div className="dz-inner">

            {/* Header */}
            {(opts.showCoachHeader || opts.showAthleteDetails || opts.showWeekDates) && (
              <header className="dz-header">
                <div className="dz-header-left">
                  {opts.showCoachHeader && activeCoach?.name && (
                    <div className="dz-coach">
                      {activeCoach.name}{activeCoach.club_name ? ` · ${activeCoach.club_name}` : ''}
                    </div>
                  )}
                  {opts.showAthleteDetails && (
                    <>
                      <h1 className="dz-athlete-name">{athlete.name}</h1>
                      <p className="dz-athlete-sub">
                        {age !== null && `${age} years`}
                        {athlete.bodyweight && ` · ${athlete.bodyweight} kg`}
                        {athlete.weight_class && ` · ${athlete.weight_class}`}
                      </p>
                    </>
                  )}
                </div>
                {opts.showWeekDates && (
                  <div className="dz-header-right">
                    <div className="dz-week-range">{formatDateRange(weekStart)}</div>
                    <div className="dz-week-meta">
                      Week {isoWeekNumber(weekStart)} · {new Date(weekStart).getFullYear()}
                    </div>
                  </div>
                )}
              </header>
            )}

            {/* Week notes */}
            {opts.showWeekNotes && weekDescription?.trim() && (
              <div className="dz-week-notes">{weekDescription}</div>
            )}

            {/* Summary band */}
            {(opts.showWeeklyTotals || opts.showCategorySummary) && (weekSets > 0 || Object.keys(categorySummaries).length > 0) && (
              <section className="dz-summary">
                {opts.showWeeklyTotals && weekSets > 0 && (
                  <div className="dz-totals">
                    <div className="dz-total-item">
                      <span className="dz-total-label">Sets</span>
                      <span className="dz-total-value">{weekSets}</span>
                    </div>
                    <div className="dz-total-item">
                      <span className="dz-total-label">Reps</span>
                      <span className="dz-total-value">{weekReps}</span>
                    </div>
                    {weekLoad > 0 && (
                      <div className="dz-total-item">
                        <span className="dz-total-label">Load</span>
                        <span className="dz-total-value">{Math.round(weekLoad)} kg</span>
                      </div>
                    )}
                  </div>
                )}
                {opts.showCategorySummary && Object.keys(categorySummaries).length > 0 && (
                  <div className="dz-cats">
                    {Object.entries(categorySummaries).sort(([a], [b]) => a.localeCompare(b)).map(([cat, t]) => (
                      <div key={cat} className="dz-cat">
                        <div className="dz-cat-name">{cat}</div>
                        <div className="dz-cat-stats">
                          <span><strong>{t.sets}</strong>s</span>
                          <span><strong>{t.reps}</strong>r</span>
                          {t.load > 0 && <span><strong>{Math.round(t.load)}</strong>kg</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Days */}
            <section className={`dz-days ${opts.columns === 2 ? 'dz-days-2col' : ''}`}>
              {visibleDays.map(day => (
                <DayBlock
                  key={day.index}
                  day={day}
                  comboMembers={comboMembers}
                  options={opts}
                  loggedByPlannedId={loggedByPlannedId}
                />
              ))}
            </section>

            {/* Footer */}
            {opts.showFooter && (
              <footer className="dz-footer">
                Generated by EMOS · {formatDateToDDMMYYYY(new Date().toISOString())}
              </footer>
            )}
          </div>
        </div>
      </div>

      <style>{designerCss(opts.orientation)}</style>
    </div>
  );
}

// ─── Day block ────────────────────────────────────────────────────────────

function DayBlock({
  day, comboMembers, options, loggedByPlannedId,
}: {
  day: { index: number; name: string; exercises: (PlannedExercise & { exercise: Exercise })[] };
  comboMembers: Record<string, ComboMemberEntry[]>;
  options: DesignerOptions;
  loggedByPlannedId: Map<string, TrainingLogSet[]>;
}) {
  if (day.exercises.length === 0 && !options.hideEmptyDays) {
    return (
      <div className={`dz-day ${options.showDayDividers ? 'dz-day-divider' : ''}`}>
        <div className="dz-day-header">
          <h2 className="dz-day-name">{day.name}</h2>
        </div>
        <p className="dz-day-empty">— Rest —</p>
      </div>
    );
  }

  const daySets = day.exercises.filter(ex => ex.exercise.counts_towards_totals)
    .reduce((s, ex) => s + (ex.summary_total_sets || 0), 0);
  const dayReps = day.exercises.filter(ex => ex.exercise.counts_towards_totals)
    .reduce((s, ex) => s + (ex.summary_total_reps || 0), 0);

  return (
    <div className={`dz-day ${options.showDayDividers ? 'dz-day-divider' : ''}`}>
      <div className="dz-day-header">
        <h2 className="dz-day-name">{day.name}</h2>
        {options.showDayTotals && (daySets > 0 || dayReps > 0) && (
          <div className="dz-day-totals">
            {daySets > 0 && <span>{daySets} sets</span>}
            {daySets > 0 && dayReps > 0 && <span className="dz-dot">·</span>}
            {dayReps > 0 && <span>{dayReps} reps</span>}
          </div>
        )}
      </div>

      <div className="dz-rows">
        {day.exercises.map(ex => (
          <ExerciseRow
            key={ex.id}
            ex={ex}
            comboMembers={comboMembers}
            options={options}
            loggedSets={loggedByPlannedId.get(ex.id) ?? null}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Exercise row ─────────────────────────────────────────────────────────

function formatLoggedSets(sets: TrainingLogSet[]): string {
  const completed = sets
    .filter(s => s.status === 'completed' || s.status === 'skipped')
    .sort((a, b) => a.set_number - b.set_number);
  if (completed.length === 0) return '';
  return completed
    .map(s => {
      if (s.status === 'skipped') return '—';
      const load = s.performed_load ?? '?';
      const reps = s.performed_reps ?? '?';
      return `${load}×${reps}`;
    })
    .join(', ');
}

function ExerciseRow({
  ex, comboMembers, options, loggedSets,
}: {
  ex: PlannedExercise & { exercise: Exercise };
  comboMembers: Record<string, ComboMemberEntry[]>;
  options: DesignerOptions;
  loggedSets: TrainingLogSet[] | null;
}) {
  const sentinel = getSentinelType(ex.exercise.exercise_code);
  const members = ex.is_combo ? (comboMembers[ex.id] ?? []).slice().sort((a, b) => a.position - b.position) : null;

  if (sentinel === 'text') {
    if (!ex.notes?.trim()) return null;
    return (
      <div className="dz-row dz-row-note">
        <p className="dz-text-note">{ex.notes}</p>
      </div>
    );
  }

  if (sentinel === 'image') {
    if (!ex.notes?.trim()) return null;
    return (
      <div className="dz-row dz-row-image">
        <img
          src={ex.notes}
          alt=""
          className="dz-image"
          onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
        />
      </div>
    );
  }

  if (sentinel === 'video') {
    const url = ex.notes?.trim();
    if (!url) return null;
    const videoId = getYouTubeVideoId(url);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=80x80`;
    return (
      <div className="dz-row dz-row-video">
        <img src={qrUrl} alt="QR" className="dz-qr" />
        <div className="dz-video-meta">
          {videoId && (
            <img src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`} alt="" className="dz-video-thumb" />
          )}
          <div className="dz-video-text">
            <div className="dz-video-label">Video</div>
            <div className="dz-video-url">{url}</div>
          </div>
        </div>
      </div>
    );
  }

  const unitSymbol = getUnitSymbol(ex.unit);
  const hasSummary = ex.summary_total_sets !== null && ex.summary_total_sets > 0;
  const accentColor = ex.is_combo
    ? (ex.combo_color || members?.[0]?.exercise.color || '#94a3b8')
    : ex.exercise.color;

  return (
    <div className="dz-row dz-row-exercise">
      {options.showColorAccents && (
        <div className="dz-row-accent" style={{ backgroundColor: accentColor || '#cbd5e1' }} />
      )}
      <div className="dz-row-body">
        <div className="dz-row-head">
          <h3 className="dz-ex-name">
            {ex.is_combo
              ? (ex.combo_notation || (members?.map(m => m.exercise.name).join(' + ') ?? ex.exercise.name))
              : ex.exercise.name}
          </h3>
          {options.showVariationNotes && ex.variation_note && (
            <span className="dz-variation">{ex.variation_note}</span>
          )}
          {ex.is_combo && <span className="dz-badge dz-badge-combo">Combo</span>}
          {unitSymbol && <span className="dz-badge dz-badge-unit">{unitSymbol}</span>}
          {options.showSummaryBadges && hasSummary && (
            <span className="dz-summary-badge">
              S{ex.summary_total_sets} · R{ex.summary_total_reps}
              {ex.summary_highest_load != null && (
                <> · Hi {Math.round(ex.summary_highest_load)} · Avg {Math.round(ex.summary_avg_load ?? 0)}</>
              )}
            </span>
          )}
        </div>

        {options.showComboMembers && ex.is_combo && members && members.length > 0 && (
          <p className="dz-combo-members">
            {members.map((m, i) => <span key={m.position}>{i > 0 && ' + '}{m.exercise.name}</span>)}
          </p>
        )}

        {ex.prescription_raw && (
          <div className="dz-prescription">
            <PrescriptionBlock prescription={ex.prescription_raw} unit={ex.unit} isCombo={ex.is_combo} />
          </div>
        )}

        {options.showLog && loggedSets && loggedSets.length > 0 && (
          <p className="dz-did">
            <span className="dz-did-label">Did:</span> {formatLoggedSets(loggedSets) || '—'}
          </p>
        )}

        {options.showExerciseNotes && ex.notes && (
          <p className="dz-ex-notes">{ex.notes}</p>
        )}
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────

function designerCss(orientation: Orientation): string {
  const pageSize = orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait';
  // Screen preview width: 210mm portrait, 297mm landscape
  const pageWidth = orientation === 'landscape' ? '297mm' : '210mm';
  const pageMinHeight = orientation === 'landscape' ? '210mm' : '297mm';
  return `
    .dz-page {
      width: ${pageWidth};
      min-height: ${pageMinHeight};
      box-sizing: border-box;
      color: #111827;
      /* design tokens, overridden by density / font classes */
      --row-gap: 4px;
      --section-gap: 10px;
      --base: 11px;
      --pad-h: 12mm;
      --pad-v: 10mm;
      font-size: var(--base);
      line-height: 1.35;
    }
    .dz-inner {
      padding: var(--pad-v) var(--pad-h);
    }

    /* Density */
    .dz-density-comfortable { --row-gap: 7px; --section-gap: 14px; --pad-v: 12mm; }
    .dz-density-normal      { --row-gap: 4px; --section-gap: 10px; --pad-v: 10mm; }
    .dz-density-compact     { --row-gap: 2px; --section-gap: 6px;  --pad-v: 8mm; }

    /* Font size */
    .dz-font-small  { --base: 9.5px; }
    .dz-font-normal { --base: 11px; }
    .dz-font-large  { --base: 12.5px; }

    /* Header */
    .dz-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 6px;
      margin-bottom: var(--section-gap);
      border-bottom: 1px solid #d1d5db;
    }
    .dz-coach {
      font-size: 0.78em;
      color: #6b7280;
      margin-bottom: 1px;
    }
    .dz-athlete-name {
      font-size: 1.45em;
      font-weight: 700;
      line-height: 1.15;
      margin: 0;
    }
    .dz-athlete-sub {
      font-size: 0.85em;
      color: #4b5563;
      margin: 1px 0 0 0;
    }
    .dz-header-right {
      text-align: right;
      flex-shrink: 0;
    }
    .dz-week-range {
      font-size: 1em;
      font-weight: 600;
    }
    .dz-week-meta {
      font-size: 0.78em;
      color: #6b7280;
    }

    /* Week notes */
    .dz-week-notes {
      background: #fefce8;
      border: 1px solid #fde68a;
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 0.88em;
      color: #374151;
      margin-bottom: var(--section-gap);
      white-space: pre-wrap;
      line-height: 1.4;
    }

    /* Summary band */
    .dz-summary {
      display: flex;
      align-items: stretch;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: var(--section-gap);
      padding-bottom: 6px;
      border-bottom: 1px solid #d1d5db;
    }
    .dz-totals {
      display: flex;
      gap: 0;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 4px;
      padding: 4px 0;
      flex-shrink: 0;
    }
    .dz-total-item {
      padding: 0 10px;
      text-align: center;
      border-right: 1px solid #bfdbfe;
    }
    .dz-total-item:last-child { border-right: none; }
    .dz-total-label {
      display: block;
      font-size: 0.65em;
      font-weight: 500;
      letter-spacing: 0.08em;
      color: #1d4ed8;
      text-transform: uppercase;
      line-height: 1;
    }
    .dz-total-value {
      display: block;
      font-size: 1.1em;
      font-weight: 700;
      color: #1e3a8a;
      line-height: 1.2;
    }
    .dz-cats {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 4px;
      flex: 1 1 200px;
    }
    .dz-cat {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 3px;
      padding: 3px 6px;
      line-height: 1.25;
    }
    .dz-cat-name {
      font-size: 0.7em;
      font-weight: 600;
      color: #374151;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dz-cat-stats {
      font-size: 0.78em;
      color: #111827;
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    /* Days */
    .dz-days-2col {
      column-count: 2;
      column-gap: 8mm;
      column-fill: balance;
    }
    .dz-day {
      break-inside: avoid;
      page-break-inside: avoid;
      margin-bottom: var(--section-gap);
    }
    .dz-day-divider {
      padding-top: 4px;
      border-top: 1px solid #e5e7eb;
    }
    .dz-day:first-child.dz-day-divider {
      border-top: none;
      padding-top: 0;
    }
    .dz-day-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      padding-bottom: 3px;
      margin-bottom: 4px;
      border-bottom: 1px solid #d1d5db;
    }
    .dz-day-name {
      font-size: 0.92em;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #111827;
      margin: 0;
    }
    .dz-day-totals {
      font-size: 0.78em;
      color: #6b7280;
      display: flex;
      gap: 4px;
    }
    .dz-dot { color: #9ca3af; }
    .dz-day-empty {
      font-size: 0.85em;
      color: #9ca3af;
      font-style: italic;
      margin: 0;
    }

    /* Rows */
    .dz-rows {
      display: flex;
      flex-direction: column;
      gap: var(--row-gap);
    }
    .dz-row {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .dz-row-exercise {
      display: flex;
      gap: 5px;
      align-items: stretch;
    }
    .dz-row-accent {
      width: 2px;
      align-self: stretch;
      border-radius: 1px;
      flex-shrink: 0;
    }
    .dz-row-body {
      flex: 1;
      min-width: 0;
    }
    .dz-row-head {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
      line-height: 1.2;
    }
    .dz-ex-name {
      font-size: 0.92em;
      font-weight: 700;
      margin: 0;
      color: #111827;
    }
    .dz-variation {
      font-size: 0.78em;
      color: #6b7280;
      font-style: italic;
    }
    .dz-badge {
      font-size: 0.66em;
      font-weight: 500;
      padding: 1px 4px;
      border-radius: 2px;
      line-height: 1.2;
    }
    .dz-badge-combo {
      background: #eff6ff;
      color: #1d4ed8;
    }
    .dz-badge-unit {
      background: #f3f4f6;
      color: #4b5563;
    }
    .dz-summary-badge {
      font-size: 0.78em;
      color: #6b7280;
      margin-left: auto;
      white-space: nowrap;
    }
    .dz-combo-members {
      font-size: 0.75em;
      color: #6b7280;
      margin: 0;
      line-height: 1.25;
    }
    .dz-prescription { line-height: 1.2; }
    .dz-ex-notes {
      font-size: 0.78em;
      color: #4b5563;
      font-style: italic;
      margin: 1px 0 0 0;
      line-height: 1.3;
    }
    .dz-did {
      font-size: 0.78em;
      color: #1f2937;
      margin: 2px 0 0 0;
      line-height: 1.3;
      font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
    }
    .dz-did-label {
      color: #6b7280;
      font-weight: 600;
      font-family: inherit;
      margin-right: 4px;
    }

    /* Prescription notation */
    .dz-rx-row {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 10px;
      align-items: flex-end;
    }
    .dz-rx-cell {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .dz-rx-stack {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      line-height: 1;
    }
    .dz-rx-load,
    .dz-rx-reps {
      font-size: 0.85em;
      font-weight: 600;
      color: #111827;
      min-height: 1em;
    }
    .dz-rx-bar {
      width: 100%;
      border-top: 1px solid #9ca3af;
      margin: 1px 0;
    }
    .dz-rx-sets {
      font-size: 0.85em;
      font-weight: 700;
      color: #111827;
    }
    .dz-no-rx {
      font-size: 0.82em;
      font-style: italic;
      color: #9ca3af;
    }

    /* Sentinel rows */
    .dz-row-note {
      background: #fefce8;
      border: 1px solid #fde68a;
      border-radius: 3px;
      padding: 3px 6px;
    }
    .dz-text-note {
      font-size: 0.82em;
      color: #374151;
      font-style: italic;
      margin: 0;
      white-space: pre-wrap;
      line-height: 1.35;
    }
    .dz-image {
      max-width: 100%;
      max-height: 140px;
      object-fit: contain;
      border: 1px solid #e5e7eb;
      border-radius: 3px;
    }
    .dz-row-video {
      display: flex;
      gap: 6px;
      align-items: center;
      background: #eef2ff;
      border: 1px solid #c7d2fe;
      border-radius: 3px;
      padding: 3px 6px;
    }
    .dz-qr { width: 48px; height: 48px; flex-shrink: 0; }
    .dz-video-meta { display: flex; gap: 6px; align-items: center; min-width: 0; flex: 1; }
    .dz-video-thumb { width: 56px; height: 36px; object-fit: cover; border-radius: 2px; flex-shrink: 0; }
    .dz-video-text { min-width: 0; }
    .dz-video-label { font-size: 0.72em; font-weight: 500; color: #374151; }
    .dz-video-url { font-size: 0.7em; color: #6b7280; overflow-wrap: anywhere; line-height: 1.3; }

    /* Footer */
    .dz-footer {
      margin-top: var(--section-gap);
      padding-top: 4px;
      border-top: 1px solid #e5e7eb;
      font-size: 0.7em;
      color: #9ca3af;
      text-align: center;
    }

    /* ── Print rules ──────────────────────────────────────────────── */
    @media print {
      @page { size: ${pageSize}; margin: 0; }
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
        background: white !important;
      }
      /* The PrintWeek wrapper is position:fixed, which clips to one
         viewport page on print. Reset it so the document flows. */
      body > * { display: none !important; }
      #print-programme-root { display: block !important; }
      #print-programme-root {
        position: static !important;
        inset: auto !important;
        overflow: visible !important;
        height: auto !important;
        background: white !important;
      }
      .dz-page {
        box-shadow: none !important;
        margin: 0 !important;
        width: 100% !important;
        min-height: auto !important;
      }
      .dz-inner {
        padding: var(--pad-v) var(--pad-h);
      }
    }
  `;
}
