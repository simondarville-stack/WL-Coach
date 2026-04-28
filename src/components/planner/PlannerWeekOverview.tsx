import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { StandardPage, Button } from '../ui';
import { MacroPhaseBar } from '../planning';
import {
  formatMetricValue,
  METRICS,
  DEFAULT_VISIBLE_METRICS,
  type MetricKey,
} from '../../lib/metrics';
import { MetricStrip } from '../ui/MetricStrip';
import type { Athlete, TrainingGroup } from '../../lib/database.types';
import { usePlannerWeekOverview, type MacroBlock, type PhaseBlock } from '../../hooks/usePlannerWeekOverview';
import { useState } from 'react';

// ── Constants ──────────────────────────────────────────────────────

const WEEKS_BACK = 2;
const WEEKS_FORWARD = 2;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function addWeeks(dateStr: string, weeks: number): string {
  return addDays(dateStr, weeks * 7);
}

function getTodayMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getTodayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ── Props ──────────────────────────────────────────────────────────

interface PlannerWeekOverviewProps {
  athlete: Athlete | null;
  group: TrainingGroup | null;
  onSelectWeek: (weekStart: string) => void;
  visibleMetrics?: MetricKey[];
  visibleSummaryMetrics?: MetricKey[];
  competitionTotal?: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────

function getMacroForWeek(macroBlocks: MacroBlock[], weekStart: string): MacroBlock | null {
  return macroBlocks.find(m => weekStart >= m.startDate && weekStart <= m.endDate) || null;
}

function getPhaseForWeek(macroBlocks: MacroBlock[], weekStart: string): { macro: MacroBlock; phase: PhaseBlock } | null {
  for (const macro of macroBlocks) {
    for (const phase of macro.phases) {
      if (weekStart >= phase.startWeek && weekStart <= phase.endWeek) {
        return { macro, phase };
      }
    }
  }
  return null;
}

function getPhaseLabel(macroBlocks: MacroBlock[], weekStart: string, prevWeekStart: string | null): string | null {
  const current = getPhaseForWeek(macroBlocks, weekStart);
  const prev = prevWeekStart ? getPhaseForWeek(macroBlocks, prevWeekStart) : null;

  if (current && (!prev || prev.phase.phaseId !== current.phase.phaseId)) {
    return current.phase.phaseName;
  }

  const currentMacro = getMacroForWeek(macroBlocks, weekStart);
  const prevMacro = prevWeekStart ? getMacroForWeek(macroBlocks, prevWeekStart) : null;
  if (currentMacro && (!prevMacro || prevMacro.macroId !== currentMacro.macroId)) {
    return currentMacro.macroName;
  }

  return null;
}

// ── Component ──────────────────────────────────────────────────────

export function PlannerWeekOverview({
  athlete,
  group,
  onSelectWeek,
  visibleMetrics = DEFAULT_VISIBLE_METRICS,
  visibleSummaryMetrics = DEFAULT_VISIBLE_METRICS,
  competitionTotal = null,
}: PlannerWeekOverviewProps) {
  const [centerDate, setCenterDate] = useState(() => getTodayMonday());
  const currentWeekRef = useRef<HTMLDivElement>(null);

  const today = getTodayMonday();
  const rangeStart = addWeeks(centerDate, -WEEKS_BACK);
  const rangeEnd = addWeeks(centerDate, WEEKS_FORWARD);

  const targetId = athlete?.id || null;
  const targetGroupId = group?.id || null;

  const navigate = useNavigate();
  const { weeks, macroBlocks, rawMacroWeeks, rawPhases, barEvents, loading, loadData, phaseBarCells } = usePlannerWeekOverview();

  useEffect(() => {
    loadData({ targetId, targetGroupId, rangeStart, rangeEnd, competitionTotal });
  }, [loadData, targetId, targetGroupId, rangeStart, rangeEnd, competitionTotal]);

  const handleTodayClick = () => {
    const newCenter = getTodayMonday();
    setCenterDate(newCenter);
    setTimeout(() => {
      currentWeekRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };

  // ── Derive macro context for header ─────────────────────────────
  const currentMacro = getMacroForWeek(macroBlocks, today);
  const currentPhaseInfo = getPhaseForWeek(macroBlocks, today);

  // ── Render ───────────────────────────────────────────────────────

  if (!athlete && !group) {
    return (
      <StandardPage>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '16rem', fontSize: 'var(--text-body)', color: 'var(--color-text-tertiary)',
        }}>
          Select an athlete or group to view the weekly overview.
        </div>
      </StandardPage>
    );
  }

  if (loading) {
    return (
      <StandardPage>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '16rem', fontSize: 'var(--text-body)', color: 'var(--color-text-tertiary)',
        }}>
          Loading weeks…
        </div>
      </StandardPage>
    );
  }

  const maxTonnage = Math.max(...weeks.map(w => w.totalTonnage), 1);
  void maxTonnage; // retained for future bar use

  // Ribbon shows the full active macro (all weeks, all phases), not just the visible window.
  // Fall back to the visible window if no macro is active today.
  const fullMacroWeekStarts = currentMacro
    ? rawMacroWeeks
        .filter(w => w.macrocycle_id === currentMacro.macroId)
        .sort((a, b) => a.week_number - b.week_number)
        .map(w => w.week_start)
    : weeks.map(w => w.weekStart);
  const phaseBarCellsData = phaseBarCells(fullMacroWeekStarts);

  return (
    <StandardPage>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', padding: 'var(--space-lg)' }}>
      {/* Macro context bar */}
      {currentMacro && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
          paddingBottom: 'var(--space-md)', borderBottom: '0.5px solid var(--color-border-tertiary)',
        }}>
          <span style={{
            padding: '2px 10px', fontSize: 'var(--text-caption)', fontWeight: 500,
            borderRadius: '999px', border: `0.5px solid ${currentPhaseInfo?.phase.color || '#7F77DD'}`,
            color: currentPhaseInfo?.phase.color || '#7F77DD',
            background: `${currentPhaseInfo?.phase.color || '#7F77DD'}15`,
          }}>
            {currentMacro.macroName}
          </span>
          {currentPhaseInfo && (
            <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
              {currentPhaseInfo.phase.phaseName}
            </span>
          )}
          <span style={{
            marginLeft: 'auto', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
            fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
          }}>
            {formatDateShort(currentMacro.startDate)} – {formatDateShort(currentMacro.endDate)}
          </span>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLeft size={14} />}
          onClick={() => setCenterDate(addWeeks(centerDate, -1))}
        >
          Earlier
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<CalendarDays size={13} />}
          onClick={handleTodayClick}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronRight size={14} />}
          iconPosition="right"
          onClick={() => setCenterDate(addWeeks(centerDate, 1))}
        >
          Later
        </Button>
      </div>

      {/* Macro phase bar */}
      {phaseBarCellsData.length > 0 && (
        <div style={{ paddingLeft: '76px', paddingRight: '170px' }}>
          <MacroPhaseBar
            cells={phaseBarCellsData}
            events={barEvents}
            selectedWeekStart={today}
            playheadDate={getTodayISO()}
            onCellClick={(cell) => onSelectWeek(cell.weekStart)}
            onPhaseClick={(cell) => {
              if (cell.macroId === null) return;
              const phase = rawPhases
                .filter(p => p.macrocycle_id === cell.macroId)
                .find(p => p.name === cell.phase);
              if (phase) navigate(`/macrocycles?phase=${phase.id}`);
            }}
          />
        </div>
      )}

      {/* Column header row */}
      <div style={{
        display: 'flex', gap: 12,
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        paddingBottom: 'var(--space-xs)',
      }}>
        <div style={{ width: 76, flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', gap: 4 }}>
          {DAY_LABELS.map(label => (
            <div key={label} style={{
              flex: 1, textAlign: 'center',
              fontSize: 'var(--text-caption)', fontWeight: 500,
              color: 'var(--color-text-tertiary)',
            }}>
              {label}
            </div>
          ))}
        </div>
        <div style={{
          width: 170, flexShrink: 0,
          paddingLeft: 'var(--space-md)',
          borderLeft: '0.5px solid var(--color-border-tertiary)',
          display: 'flex', gap: 4, alignItems: 'center',
        }}>
          <div style={{ width: 40 }} />
          <div style={{ flex: 1, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
            Target
          </div>
          <div style={{ flex: 1, fontSize: 'var(--text-caption)', fontWeight: 500, color: 'var(--color-text-secondary)', textAlign: 'right' }}>
            Planned
          </div>
        </div>
      </div>

      {/* Week rows */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {weeks.map((week, idx) => {
          const isCurrent = week.weekStart === today;
          const isPast = week.weekStart < today;
          const isFuture = week.weekStart > today;
          const isEmpty = week.weekPlanId === null;
          const endDate = addDays(week.weekStart, 6);

          const prevWeek = idx > 0 ? weeks[idx - 1].weekStart : null;
          const sectionLabel = getPhaseLabel(macroBlocks, week.weekStart, prevWeek);

          const macro = getMacroForWeek(macroBlocks, week.weekStart);
          let weekNum: string | null = null;
          if (macro) {
            const macroStart = new Date(macro.startDate + 'T00:00:00');
            const weekDate = new Date(week.weekStart + 'T00:00:00');
            const diffWeeks = Math.floor((weekDate.getTime() - macroStart.getTime()) / (7 * 86400000)) + 1;
            if (diffWeeks > 0) weekNum = `W${diffWeeks}`;
          }

          return (
            <div key={week.weekStart} ref={isCurrent ? currentWeekRef : undefined}>
              {sectionLabel && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) 0', marginTop: 'var(--space-sm)' }}>
                  <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                    {sectionLabel}
                  </span>
                  <span style={{ flex: 1, height: '0.5px', background: 'var(--color-border-tertiary)' }} />
                </div>
              )}
              <div
                onClick={() => onSelectWeek(week.weekStart)}
                style={{
                  display: 'flex', flexDirection: 'column',
                  padding: 'var(--space-md)', margin: '0 calc(-1 * var(--space-md))',
                  borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer',
                  border: isCurrent
                    ? '0.5px solid var(--color-accent)'
                    : '0.5px solid transparent',
                  background: isCurrent ? 'var(--color-info-bg)' : 'transparent',
                  transition: 'background 100ms ease-out, border-color 100ms ease-out',
                }}
                onMouseEnter={e => {
                  if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-secondary)';
                }}
                onMouseLeave={e => {
                  if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                }}
              >
                {/* ── Top row: meta + day blocks + stats ── */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                  {/* Meta column */}
                  <div style={{ width: 76, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <span style={{
                      fontSize: 'var(--text-body)', fontWeight: 500,
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {weekNum || formatDateShort(week.weekStart).split(' ')[1]}
                    </span>
                    <div style={{
                      fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginTop: 2,
                      fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {formatDateShort(week.weekStart)}–{formatDateShort(endDate).split(' ')[1]}
                    </div>
                    {week.compliance !== null && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{
                          height: 3, background: 'var(--color-bg-tertiary)',
                          borderRadius: '999px', overflow: 'hidden', width: '100%',
                        }}>
                          <div
                            style={{
                              height: '100%', borderRadius: '999px',
                              width: `${Math.round(week.compliance * 100)}%`,
                              background: week.compliance >= 0.9
                                ? 'var(--color-success-border)'
                                : week.compliance >= 0.5
                                ? 'var(--color-accent)'
                                : 'var(--color-warning-border)',
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginTop: 2, display: 'block' }}>
                          Done: {Math.round(week.compliance * 100)}%{isCurrent && week.compliance < 1 ? ' (prog.)' : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Day blocks */}
                  <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'stretch', minHeight: 90 }}>
                    {week.days.map((day) => {
                      const di = day.dayIndex;
                      const dayIsFuture = isFuture || (isCurrent && di >= new Date().getDay() - 1);
                      const hasData = day.exercises.length > 0;
                      const faded = dayIsFuture && !isPast;

                      let dayBlockStyle: React.CSSProperties;
                      if (day.isRest) {
                        dayBlockStyle = {
                          background: 'var(--color-bg-secondary)',
                          opacity: 0.35,
                          border: 'none',
                        };
                      } else if (isEmpty) {
                        dayBlockStyle = {
                          border: '0.5px dashed var(--color-border-tertiary)',
                          background: 'transparent',
                        };
                      } else if (faded) {
                        dayBlockStyle = {
                          border: `0.5px dashed ${isCurrent ? 'var(--color-accent-border)' : 'var(--color-border-secondary)'}`,
                          background: isCurrent ? 'rgba(255,255,255,0.7)' : 'var(--color-bg-secondary)',
                          opacity: 0.6,
                        };
                      } else {
                        dayBlockStyle = {
                          border: `0.5px solid ${isCurrent ? 'var(--color-accent-border)' : 'var(--color-border-tertiary)'}`,
                          background: 'var(--color-bg-primary)',
                        };
                      }

                      return (
                        <div
                          key={di}
                          style={{
                            flex: 1, borderRadius: 'var(--radius-md)',
                            display: 'flex', flexDirection: 'column',
                            padding: '4px 4px 6px', minWidth: 0,
                            ...dayBlockStyle,
                          }}
                        >
                          {/* Exercise bands */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                            {day.exercises.slice(0, 6).map((ex, ei) => (
                              <div
                                key={ei}
                                style={{
                                  borderRadius: 2, padding: '1px 4px',
                                  display: 'flex', alignItems: 'center', gap: 4, minWidth: 0,
                                  backgroundColor: ex.color + (faded ? '15' : '22'),
                                  borderLeft: `2.5px solid ${ex.color}${faded ? '55' : 'cc'}`,
                                }}
                              >
                                <span style={{
                                  fontSize: 'var(--text-caption)', lineHeight: 1.3, fontWeight: 500,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  color: faded ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                                }}>
                                  {ex.name}
                                </span>
                              </div>
                            ))}
                            {day.exercises.length > 6 && (
                              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', paddingLeft: 4 }}>
                                +{day.exercises.length - 6}
                              </span>
                            )}
                          </div>

                          {/* Metric strip */}
                          {hasData && (
                            <div style={{ opacity: faded ? 0.4 : 1, marginTop: 4, textAlign: 'center' }}>
                              <MetricStrip
                                metrics={day.dayMetrics}
                                visibleMetrics={visibleMetrics}
                                size="sm"
                                showLabels={false}
                                separator="·"
                                className="leading-tight"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Stats column */}
                  <div style={{
                    width: 170, flexShrink: 0, display: 'flex', flexDirection: 'column',
                    justifyContent: 'center', paddingLeft: 'var(--space-md)',
                    borderLeft: '0.5px solid var(--color-border-tertiary)',
                  }}>
                    {METRICS.filter(m => (visibleSummaryMetrics as string[]).includes(m.key)).map(m => {
                      const actualVal = week.weekMetrics[m.key] as number | null;
                      const targetVal = week.macroTargets
                        ? m.key === 'reps' ? week.macroTargets.reps
                          : m.key === 'tonnage' ? week.macroTargets.tonnage
                          : m.key === 'avg' ? week.macroTargets.avg
                          : null
                        : null;
                      return (
                        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 0' }}>
                          <div style={{
                            width: 40, fontSize: 'var(--text-caption)', fontWeight: 500,
                            color: 'var(--color-text-secondary)',
                          }}>
                            {m.label}
                          </div>
                          <div style={{
                            flex: 1, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
                            textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                          }}>
                            {formatMetricValue(m.key, targetVal)}
                          </div>
                          <div style={{
                            flex: 1, fontSize: 'var(--text-caption)', fontWeight: 500,
                            color: 'var(--color-text-primary)',
                            textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                          }}>
                            {formatMetricValue(m.key, actualVal)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Hint */}
      <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', textAlign: 'center', paddingTop: 'var(--space-sm)' }}>
        Click any week to open the planner
      </div>
    </div>
    </StandardPage>
  );
}
