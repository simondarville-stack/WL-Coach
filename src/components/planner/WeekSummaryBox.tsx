// WeekSummaryBox — the redesigned "week box" header that sits above the day
// cards. It boxes the week: identity + macro context, a by-category load
// breakdown, a live load-across-the-week distribution (tonnage / sets /
// intensity) with peak + balance readouts, and a totals footer.
//
// Adapted from the "EMOS Weekly Designer Dock v2" design to EMOS's own design
// tokens. Categories are data-driven (exercise.category) so the panel stays
// coach-flexible. Drag-to-dock (whole-week copy) is wired in a later phase.

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Athlete, Exercise, PlannedExercise, WeekTypeConfig } from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { getWeekTypeColor } from '../../lib/weekUtils';
import { formatDateRange } from '../../lib/dateUtils';

type PlannedRow = PlannedExercise & { exercise: Exercise };

interface WeekSummaryBoxProps {
  selectedAthlete: Athlete | null;
  selectedDate: string;
  macroContext: MacroContext | null;
  plannedExercises: Record<number, PlannedRow[]>;
  activeDays: number[];
  dayDisplayOrder: number[];
  dayLabels: Record<number, string>;
  weekTypes: WeekTypeConfig[];
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

type DistMode = 'tonnage' | 'sets' | 'intensity';

// Deterministic, stable colour per category name so any coach-defined category
// gets a consistent swatch without a hardcoded category enum.
const CAT_PALETTE = [
  '#E58CA8', '#5891CB', '#E89866', '#9C95E2', '#5DBA94',
  '#E2C56F', '#7AAEDD', '#D85A30', '#1D9E75', '#B0AEA7',
];
function categoryColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
}

function fmtTon(kg: number): string {
  if (kg <= 0) return '–';
  return kg >= 1000 ? `${(kg / 1000).toFixed(1)}t` : `${Math.round(kg)}kg`;
}

function exTonnage(ex: PlannedRow): number {
  if (ex.exercise.counts_towards_totals === false) return 0;
  if (ex.unit !== 'absolute_kg') return 0;
  return (ex.summary_avg_load ?? 0) * (ex.summary_total_reps ?? 0);
}

interface DayAgg {
  index: number;
  label: string;
  tonnage: number;
  sets: number;
  reps: number;
  avgLoad: number;
  hasData: boolean;
}

interface CatAgg {
  category: string;
  color: string;
  tonnage: number;
  sets: number;
  reps: number;
}

export function WeekSummaryBox({
  selectedAthlete,
  selectedDate,
  macroContext,
  plannedExercises,
  activeDays,
  dayDisplayOrder,
  dayLabels,
  weekTypes,
  onPrevWeek,
  onNextWeek,
}: WeekSummaryBoxProps) {
  const [mode, setMode] = useState<DistMode>('tonnage');

  const { cats, days, totals } = useMemo(() => {
    const catMap = new Map<string, CatAgg>();
    const visibleDays = dayDisplayOrder.filter(d => activeDays.includes(d));

    let wkTon = 0, wkSets = 0, wkReps = 0, wkWeighted = 0;

    const days: DayAgg[] = visibleDays.map(index => {
      const rows = plannedExercises[index] ?? [];
      let ton = 0, sets = 0, reps = 0, weighted = 0;
      for (const ex of rows) {
        if (ex.exercise.counts_towards_totals === false) continue;
        const s = ex.summary_total_sets ?? 0;
        const r = ex.summary_total_reps ?? 0;
        const avg = ex.summary_avg_load ?? 0;
        const t = exTonnage(ex);
        sets += s; reps += r; ton += t; weighted += avg * r;

        const category = ex.exercise.category;
        if (category && category !== '— System') {
          const prev = catMap.get(category) ?? {
            category, color: categoryColor(category), tonnage: 0, sets: 0, reps: 0,
          };
          catMap.set(category, { ...prev, tonnage: prev.tonnage + t, sets: prev.sets + s, reps: prev.reps + r });
        }
      }
      wkTon += ton; wkSets += sets; wkReps += reps; wkWeighted += weighted;
      return {
        index,
        label: dayLabels[index] || `Day ${index}`,
        tonnage: ton, sets, reps,
        avgLoad: reps > 0 ? Math.round(weighted / reps) : 0,
        hasData: rows.length > 0,
      };
    });

    const cats = Array.from(catMap.values()).sort((a, b) => b.tonnage - a.tonnage);
    const sessions = days.filter(d => d.hasData).length;
    const competitionTotal = selectedAthlete?.competition_total ?? null;
    const wkAvg = wkReps > 0 ? Math.round(wkWeighted / wkReps) : 0;
    const wkK = (competitionTotal && competitionTotal > 0 && wkAvg > 0)
      ? Math.round((wkAvg / competitionTotal) * 100)
      : null;

    return {
      cats,
      days,
      totals: { wkTon, wkSets, wkReps, wkAvg, wkK, sessions, dayCount: days.length },
    };
  }, [plannedExercises, activeDays, dayDisplayOrder, dayLabels, selectedAthlete?.competition_total]);

  // ── Distribution helpers ──────────────────────────────────────────────
  const dayValue = (d: DayAgg): number =>
    mode === 'tonnage' ? d.tonnage : mode === 'sets' ? d.sets : d.avgLoad;
  const maxVal = Math.max(1, ...days.map(dayValue));
  const maxCatTon = Math.max(1, ...cats.map(c => c.tonnage));

  // Peak + coefficient of variation across active (non-empty) days, on tonnage.
  const { peak, cvPct, verdict, verdictColor } = useMemo(() => {
    const active = days.filter(d => d.tonnage > 0);
    if (active.length === 0) {
      return { peak: null as DayAgg | null, cvPct: 0, verdict: '', verdictColor: 'var(--color-text-tertiary)' };
    }
    const peak = active.reduce((a, b) => (b.tonnage > a.tonnage ? b : a));
    const mean = active.reduce((s, d) => s + d.tonnage, 0) / active.length;
    const variance = active.reduce((s, d) => s + (d.tonnage - mean) ** 2, 0) / active.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    const cvPct = Math.round(cv * 100);
    const verdict = cv < 0.25 ? 'even' : cv < 0.5 ? 'moderate' : 'concentrated';
    const verdictColor = cv < 0.25 ? 'var(--color-success-text)'
      : cv < 0.5 ? 'var(--color-warning-text)' : 'var(--color-danger-text)';
    return { peak, cvPct, verdict, verdictColor };
  }, [days]);

  const dateRange = formatDateRange(selectedDate, 7);
  const weekTypeColor = macroContext ? getWeekTypeColor(macroContext.weekType, weekTypes) : null;

  const eyebrow: React.CSSProperties = {
    fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
    textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500,
  };
  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };

  return (
    <div
      style={{
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        overflow: 'hidden',
        marginBottom: 16,
      }}
    >
      {/* ── Identity row ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button onClick={onPrevWeek} title="Previous week" style={navBtn}><ChevronLeft size={15} /></button>
          <button onClick={onNextWeek} title="Next week" style={navBtn}><ChevronRight size={15} /></button>
        </div>
        <span style={{ ...mono, fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {dateRange}
        </span>
        {macroContext && weekTypeColor && (
          <span style={{
            padding: '2px 8px', borderRadius: 'var(--radius-sm)',
            background: weekTypeColor + '1A', color: weekTypeColor,
            fontSize: 'var(--text-caption)', fontWeight: 500,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            ...mono,
          }}>
            {macroContext.weekTypeText || macroContext.weekType}
          </span>
        )}
        {macroContext && (
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
            {macroContext.macroName}
            {macroContext.totalWeeks > 0 && (
              <span style={{ ...mono, marginLeft: 6 }}>
                W{macroContext.weekNumber}/{macroContext.totalWeeks}
              </span>
            )}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {selectedAthlete && (
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
            {selectedAthlete.name}
            {selectedAthlete.bodyweight != null && (
              <span style={{ ...mono, color: 'var(--color-text-tertiary)', marginLeft: 6 }}>
                {selectedAthlete.bodyweight}kg
              </span>
            )}
          </span>
        )}
      </div>

      {/* ── Body: category breakdown + weekly distribution ───────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr' }}>
        {/* LEFT — by category */}
        <div style={{ padding: '10px 14px', borderRight: '0.5px solid var(--color-border-tertiary)' }}>
          <div style={eyebrow}>Planned · by category</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {cats.length === 0 && (
              <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                Nothing planned yet.
              </span>
            )}
            {cats.map(cat => {
              const pct = totals.wkTon > 0 ? Math.round((cat.tonnage / totals.wkTon) * 100) : 0;
              return (
                <div key={cat.category} style={{ display: 'grid', gridTemplateColumns: '9px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ width: 9, height: 15, borderRadius: 2, background: cat.color }} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cat.category}
                      </span>
                      <span style={{ ...mono, fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        {fmtTon(cat.tonnage)}
                      </span>
                      <span style={{ ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', width: 30, textAlign: 'right' }}>
                        {pct}%
                      </span>
                    </div>
                    <div style={{ height: 4, background: 'var(--color-bg-tertiary)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
                      <div style={{ height: '100%', borderRadius: 2, width: `${(cat.tonnage / maxCatTon) * 100}%`, background: cat.color, transition: 'width 0.2s' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — load across the week */}
        <div style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={eyebrow}>Load across the week</div>
            <div style={{ display: 'inline-flex', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              {(['tonnage', 'sets', 'intensity'] as DistMode[]).map((m, i) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    ...mono,
                    padding: '2px 8px', fontSize: 'var(--text-caption)', cursor: 'pointer', border: 'none',
                    borderLeft: i > 0 ? '0.5px solid var(--color-border-tertiary)' : 'none',
                    background: mode === m ? 'var(--color-text-primary)' : 'transparent',
                    color: mode === m ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
                  }}
                >
                  {m === 'tonnage' ? 't' : m === 'sets' ? 'sets' : 'avg'}
                </button>
              ))}
            </div>
          </div>

          {/* bars */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, 1fr)`, gap: 6, alignItems: 'end', marginTop: 8, height: 72 }}>
            {days.map(d => {
              const v = dayValue(d);
              const h = v > 0 ? Math.max(3, (v / maxVal) * 52) : 2;
              const isPeak = peak?.index === d.index && mode === 'tonnage';
              const label = mode === 'tonnage' ? fmtTon(d.tonnage)
                : mode === 'sets' ? (d.sets || '–')
                : (d.avgLoad || '–');
              return (
                <div key={d.index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0 }}>
                  <span style={{ ...mono, fontSize: 9, color: v > 0 ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)', height: 11 }}>
                    {label}
                  </span>
                  <div style={{
                    width: '70%', height: h, minHeight: 2, borderRadius: '2px 2px 0 0',
                    background: v > 0
                      ? (isPeak ? 'var(--color-accent)' : 'var(--color-accent-border)')
                      : 'var(--color-border-tertiary)',
                    opacity: v > 0 ? 1 : 0.5,
                    transition: 'height 0.2s',
                  }} />
                  <span style={{
                    ...mono, fontSize: 9, color: 'var(--color-text-tertiary)',
                    borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 2,
                    width: '100%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {d.label.replace(/^Day\s/, 'D')}
                  </span>
                </div>
              );
            })}
          </div>

          {/* captions */}
          {peak && (
            <div style={{ display: 'flex', gap: 14, marginTop: 8, ...mono, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
              <span>peak <b style={{ color: 'var(--color-text-secondary)' }}>{peak.label.replace(/^Day\s/, 'D')} · {fmtTon(peak.tonnage)}</b></span>
              <span>balance <b style={{ color: 'var(--color-text-secondary)' }}>CV {cvPct}%</b></span>
              <span style={{ color: verdictColor }}>{verdict}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Totals footer ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 18,
        padding: '7px 14px', borderTop: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-bg-secondary)',
      }}>
        <TotalStat label="Σ Tonnage" value={fmtTon(totals.wkTon)} strong />
        <TotalStat label="Sets" value={String(totals.wkSets)} />
        <TotalStat label="Reps" value={String(totals.wkReps)} />
        <TotalStat label="Avg" value={totals.wkAvg > 0 ? `${totals.wkAvg}kg` : '–'} />
        {totals.wkK != null && <TotalStat label="K" value={`${totals.wkK}%`} />}
        <span style={{ flex: 1 }} />
        <TotalStat label="Sessions" value={`${totals.sessions}/${totals.dayCount}`} />
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--color-text-secondary)', padding: '2px 4px', borderRadius: 'var(--radius-sm)',
};

function TotalStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
      <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
        fontSize: strong ? 'var(--text-body)' : 'var(--text-label)',
        fontWeight: strong ? 600 : 500, color: 'var(--color-text-primary)',
      }}>
        {value}
      </span>
    </span>
  );
}
