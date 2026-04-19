import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight,
  Settings2, Copy, ClipboardPaste, Printer, BarChart2,
  ChevronDown, ChevronRight as ChevronRightSmall,
  Users, User as UserIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type {
  Athlete, TrainingGroup, AthletePR, Exercise, PlannedExercise,
  GeneralSettings, MacroPhase, MacroWeek,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { formatDateRange } from '../../lib/dateUtils';
import { calculateAge } from '../../lib/calculations';
import { calculateRestInfo } from '../../lib/restCalculation';
import { computeMetrics, DEFAULT_VISIBLE_METRICS, type MetricKey } from '../../lib/metrics';
import { Button, Modal } from '../ui';
import { MacroPhaseBar, type MacroPhaseBarEvent } from '../planning';
import { buildCellsForSingleMacro, fetchMacroPhaseBarEvents } from '../../lib/macroPhaseBarData';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── helpers ────────────────────────────────────────────────────────────────

function abbreviateExercise(name: string): string {
  const l = name.toLowerCase();
  if (l.includes('snatch'))                     return 'Sn';
  if (l.includes('clean') && l.includes('jerk')) return 'C&J';
  if (l.includes('clean'))                      return 'Clean';
  if (l.includes('jerk'))                       return 'Jerk';
  if (l.includes('squat'))                      return 'Sq';
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
}

// Maps macro week type to token-based colors for the badge pill.
function weekTypeBadgeColor(weekType: string): { bg: string; text: string } {
  switch (weekType) {
    case 'High':        return { bg: 'var(--color-amber-50)',  text: 'var(--color-amber-800)' };
    case 'Medium':      return { bg: 'var(--color-blue-50)',   text: 'var(--color-blue-800)' };
    case 'Low':         return { bg: 'var(--color-green-50)',  text: 'var(--color-green-800)' };
    case 'Deload':      return { bg: 'var(--color-teal-50)',   text: 'var(--color-teal-800)' };
    case 'Competition': return { bg: 'var(--color-red-50)',    text: 'var(--color-red-800)' };
    case 'Taper':       return { bg: 'var(--color-amber-50)',  text: 'var(--color-amber-800)' };
    case 'Testing':     return { bg: 'var(--color-purple-50)', text: 'var(--color-purple-800)' };
    default:            return { bg: 'var(--color-bg-secondary)', text: 'var(--color-text-secondary)' };
  }
}

// Compliance color (for the percentage after the reps count)
function complianceColorToken(pct: number): string {
  if (pct >= 90) return 'var(--color-success-text)';
  if (pct >= 70) return 'var(--color-warning-text)';
  return 'var(--color-danger-text)';
}

// ─── local UI helpers ────────────────────────────────────────────────────────

interface IconButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  highlight?: 'success' | 'info';
}

function IconButton({ children, onClick, title, disabled, highlight }: IconButtonProps) {
  const [hovered, setHovered] = useState(false);

  const bg = highlight === 'success'
    ? 'var(--color-success-bg)'
    : highlight === 'info'
    ? 'var(--color-info-bg)'
    : hovered && !disabled
    ? 'var(--color-bg-secondary)'
    : 'transparent';

  const color = highlight === 'success'
    ? 'var(--color-success-text)'
    : highlight === 'info'
    ? 'var(--color-info-text)'
    : disabled
    ? 'var(--color-text-tertiary)'
    : hovered
    ? 'var(--color-text-primary)'
    : 'var(--color-text-secondary)';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: 'var(--space-sm)',
        border: 'none',
        background: bg,
        color,
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 100ms ease-out',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

interface MetricItemProps {
  label: string;
  value: React.ReactNode;
}

function MetricItem({ label, value }: MetricItemProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
      <span
        style={{
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-tertiary)',
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </span>
    </span>
  );
}

function MetricSeparator() {
  return (
    <span
      style={{
        color: 'var(--color-border-tertiary)',
        margin: '0 var(--space-sm)',
        userSelect: 'none',
      }}
    >
      ·
    </span>
  );
}

function CategoryMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px' }}>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-caption)' }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </span>
    </span>
  );
}

// ─── types ───────────────────────────────────────────────────────────────────

interface CompetitionPR {
  exerciseName: string;
  value: number;
}

export interface PlannerControlPanelProps {
  selectedAthlete: Athlete | null;
  selectedGroup: TrainingGroup | null;
  selectedDate: string;
  macroContext: MacroContext | null;
  macroWeekTarget: number | null;
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  athletePRs: AthletePR[];
  settings: GeneralSettings | null;
  weekDescription: string;
  daySchedule: Record<number, { weekday: number; time: string | null }> | null;
  canCopyPaste: boolean;
  copiedWeekStart: string | null;
  showLoadDistribution: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onSaveWeekDescription: (value: string) => Promise<void>;
  onDayConfig: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onPrint: () => void;
  onToggleLoadDistribution: () => void;
  onResolvePercentages?: () => Promise<void>;
  weekTypesByNum?: Record<number, string>;
  macroEvents?: MacroPhaseBarEvent[];
}

// ─── component ───────────────────────────────────────────────────────────────

export function PlannerControlPanel({
  selectedAthlete,
  selectedGroup,
  selectedDate,
  macroContext,
  macroWeekTarget,
  plannedExercises,
  athletePRs,
  settings,
  weekDescription,
  daySchedule,
  canCopyPaste,
  copiedWeekStart,
  showLoadDistribution,
  onPrevWeek,
  onNextWeek,
  onSaveWeekDescription,
  onDayConfig,
  onCopy,
  onPaste,
  onPrint,
  onToggleLoadDistribution,
  onResolvePercentages,
  weekTypesByNum,
  macroEvents = [],
}: PlannerControlPanelProps) {
  const navigate = useNavigate();

  const [competitionPRs, setCompetitionPRs] = useState<CompetitionPR[]>([]);
  const [phases, setPhases]                 = useState<MacroPhase[]>([]);
  const [macroWeeks, setMacroWeeks]         = useState<MacroWeek[]>([]);
  const [fetchedEvents, setFetchedEvents]   = useState<MacroPhaseBarEvent[]>([]);
  const [showCategories, setShowCategories] = useState(false);
  const [localDesc, setLocalDesc]           = useState(weekDescription);
  const [copyFlash, setCopyFlash]           = useState(false);
  const [showAthleteProfile, setShowAthleteProfile] = useState(false);

  useEffect(() => { setLocalDesc(weekDescription); }, [weekDescription]);

  useEffect(() => {
    if (!selectedAthlete) { setCompetitionPRs([]); return; }
    void loadCompetitionPRs(selectedAthlete.id);
  }, [selectedAthlete?.id]);

  useEffect(() => {
    if (!macroContext) { setPhases([]); setMacroWeeks([]); return; }
    void loadPhases(macroContext.macroId);
    void loadMacroWeeks(macroContext.macroId);
  }, [macroContext?.macroId]);

  useEffect(() => {
    if (!selectedAthlete || macroWeeks.length === 0) {
      setFetchedEvents([]);
      return;
    }
    const rangeStart = macroWeeks[0].week_start;
    const lastWeek = macroWeeks[macroWeeks.length - 1];
    const lastMonday = new Date(lastWeek.week_start + 'T00:00:00');
    lastMonday.setDate(lastMonday.getDate() + 6);
    const rangeEnd = lastMonday.toISOString().split('T')[0];

    void fetchMacroPhaseBarEvents([selectedAthlete.id], rangeStart, rangeEnd)
      .then(setFetchedEvents);
  }, [selectedAthlete?.id, macroWeeks]);

  async function loadCompetitionPRs(athleteId: string) {
    const { data } = await supabase
      .from('athlete_prs')
      .select('pr_value_kg, exercise:exercises(name, is_competition_lift)')
      .eq('athlete_id', athleteId)
      .not('pr_value_kg', 'is', null);
    if (!data) return;
    const prs = (data as Array<{ pr_value_kg: number; exercise: { name: string; is_competition_lift: boolean } | null }>)
      .filter(d => d.exercise?.is_competition_lift)
      .map(d => ({ exerciseName: d.exercise!.name, value: d.pr_value_kg }))
      .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
    setCompetitionPRs(prs);
  }

  async function loadPhases(macroId: string) {
    const { data } = await supabase
      .from('macro_phases')
      .select('*')
      .eq('macrocycle_id', macroId)
      .order('start_week_number');
    setPhases((data as MacroPhase[]) ?? []);
  }

  async function loadMacroWeeks(macroId: string) {
    const { data } = await supabase
      .from('macro_weeks')
      .select('*')
      .eq('macrocycle_id', macroId)
      .order('week_number');
    setMacroWeeks((data as MacroWeek[]) ?? []);
  }

  // ── metrics ──────────────────────────────────────────────────────────────

  const { metrics, totalStress, categories } = useMemo(() => {
    const prMap = new Map<string, number>(
      athletePRs.filter(pr => pr.pr_value_kg).map(pr => [pr.exercise_id, pr.pr_value_kg!])
    );
    let totalStress = 0;
    const catMap = new Map<string, { category: string; sets: number; reps: number; tonnage: number }>();
    const allExercises: Array<{ summary_total_sets: number | null; summary_total_reps: number | null; summary_highest_load: number | null; summary_avg_load: number | null; counts_towards_totals: boolean; unit: string | null; exercise_id: string }> = [];
    Object.values(plannedExercises).forEach(dayExs => {
      dayExs.forEach(ex => {
        allExercises.push({ ...ex, counts_towards_totals: ex.exercise.counts_towards_totals });
        if (!ex.exercise.counts_towards_totals) return;
        const s = ex.summary_total_sets ?? 0;
        const r = ex.summary_total_reps ?? 0;
        const avg = ex.summary_avg_load ?? 0;
        const ton = ex.unit === 'absolute_kg' ? avg * r : 0;
        if (ex.unit === 'absolute_kg' && avg > 0) {
          const pr = prMap.get(ex.exercise_id);
          if (pr && pr > 0) totalStress += r * Math.pow(avg / pr, 2);
        }
        if (ex.exercise.category !== '— System') {
          const prev = catMap.get(ex.exercise.category) || { category: ex.exercise.category, sets: 0, reps: 0, tonnage: 0 };
          catMap.set(ex.exercise.category, { ...prev, sets: prev.sets + s, reps: prev.reps + r, tonnage: prev.tonnage + ton });
        }
      });
    });
    return {
      metrics: computeMetrics(allExercises, selectedAthlete?.competition_total ?? null),
      totalStress: Math.round(totalStress * 10) / 10,
      categories: Array.from(catMap.values()).sort((a, b) => b.reps - a.reps),
    };
  }, [plannedExercises, athletePRs, selectedAthlete?.competition_total]);

  const visibleMetrics: MetricKey[] = (settings?.visible_summary_metrics as MetricKey[] | undefined) ?? DEFAULT_VISIBLE_METRICS;
  const showStress     = settings?.show_stress_metric ?? false;
  const repsProgress   = macroWeekTarget && metrics.reps > 0
    ? Math.min(100, Math.round((metrics.reps / macroWeekTarget) * 100))
    : null;

  const athleteInitials = selectedAthlete?.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) ?? '';
  const athleteAge      = selectedAthlete?.birthdate ? calculateAge(selectedAthlete.birthdate) : null;
  const totalWeeks      = macroContext?.totalWeeks ?? 1;

  const phaseBarCells = macroContext && macroWeeks.length > 0
    ? buildCellsForSingleMacro(
        { id: macroContext.macroId, name: macroContext.macroName },
        {
          macros: [{ id: macroContext.macroId, name: macroContext.macroName }],
          phases,
          weeks: macroWeeks,
          weekTypeConfigs: settings?.week_types ?? [],
        }
      )
    : [];

  const phaseBarSelectedWeekStart = macroContext
    ? macroWeeks.find(w => w.week_number === macroContext.weekNumber)?.week_start ?? null
    : null;

  const subLabel = [
    athleteAge !== null ? `${athleteAge} yr` : null,
    selectedAthlete?.bodyweight ? `${selectedAthlete.bodyweight} kg` : null,
    selectedAthlete?.weight_class ? `-${selectedAthlete.weight_class}` : null,
    ...competitionPRs.slice(0, 2).map(pr => `${abbreviateExercise(pr.exerciseName)} ${pr.value}`),
  ].filter(Boolean).join(' · ');

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: 'var(--color-bg-primary)',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        flexShrink: 0,
      }}
    >

      {/* ── ROW 1: Athlete + Week nav + Tools ─────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-md)',
          padding: 'var(--space-md) var(--space-lg)',
          borderBottom: '0.5px solid var(--color-border-tertiary)',
        }}
      >

        {/* LEFT: avatar + name */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-md)',
            flexShrink: 0,
            minWidth: 0,
            width: 200,
            cursor: selectedAthlete ? 'pointer' : 'default',
          }}
          onDoubleClick={() => selectedAthlete && setShowAthleteProfile(true)}
          title={selectedAthlete ? 'Double-click to view athlete profile' : undefined}
        >
          {selectedGroup ? (
            <>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: 'var(--color-accent-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Users size={18} style={{ color: 'var(--color-accent)' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    fontSize: 'var(--text-section)',
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                    lineHeight: 1.2,
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {selectedGroup.name}
                </p>
              </div>
            </>
          ) : selectedAthlete ? (
            <>
              {selectedAthlete.photo_url ? (
                <img
                  src={selectedAthlete.photo_url}
                  alt={selectedAthlete.name}
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    objectFit: 'cover',
                    flexShrink: 0,
                    border: '0.5px solid var(--color-border-tertiary)',
                  }}
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: 'var(--color-accent-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--text-label)',
                    fontWeight: 500,
                    color: 'var(--color-accent)',
                    flexShrink: 0,
                  }}
                >
                  {athleteInitials}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    fontSize: 'var(--text-section)',
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                    lineHeight: 1.2,
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {selectedAthlete.name}
                </p>
                {subLabel && (
                  <p
                    style={{
                      fontSize: 'var(--text-caption)',
                      color: 'var(--color-text-tertiary)',
                      lineHeight: 1.2,
                      margin: '2px 0 0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {subLabel}
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* CENTER: week navigation */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-sm)',
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            icon={<ChevronLeft size={14} />}
            onClick={onPrevWeek}
          >
            Prev
          </Button>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '0 var(--space-md)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--text-section)',
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                lineHeight: 1.2,
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                userSelect: 'none',
              }}
            >
              {formatDateRange(selectedDate, 7)}
            </span>
            {macroContext && (
              <span
                style={{
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-tertiary)',
                  lineHeight: 1,
                  marginTop: '2px',
                }}
              >
                Week {macroContext.weekNumber}{macroContext.totalWeeks > 0 ? ` of ${macroContext.totalWeeks}` : ''}
              </span>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            icon={<ChevronRight size={14} />}
            iconPosition="right"
            onClick={onNextWeek}
          >
            Next
          </Button>
        </div>

        {/* RIGHT: tool buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flexShrink: 0,
          }}
        >
          <IconButton title="Day settings" onClick={onDayConfig}>
            <Settings2 size={16} />
          </IconButton>

          {canCopyPaste && (
            <>
              <IconButton
                title="Copy week"
                onClick={() => { onCopy(); setCopyFlash(true); setTimeout(() => setCopyFlash(false), 1200); }}
                highlight={copyFlash ? 'success' : undefined}
              >
                <Copy size={16} />
              </IconButton>
              <IconButton
                title="Paste week"
                onClick={onPaste}
                disabled={!copiedWeekStart}
              >
                <ClipboardPaste size={16} />
              </IconButton>
            </>
          )}

          <IconButton title="Print week" onClick={onPrint}>
            <Printer size={16} />
          </IconButton>

          <IconButton
            title="Load distribution chart"
            onClick={onToggleLoadDistribution}
            highlight={showLoadDistribution ? 'info' : undefined}
          >
            <BarChart2 size={16} />
          </IconButton>

          {onResolvePercentages && selectedAthlete && athletePRs.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onResolvePercentages}
              title="Convert percentage prescriptions to kg using athlete PRs"
            >
              → kg
            </Button>
          )}
        </div>
      </div>

      {/* ── ROW 2: Metrics strip ───────────────────────────────────────────── */}
      <div
        style={{
          padding: 'var(--space-sm) var(--space-lg)',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-xs)',
          fontSize: 'var(--text-label)',
        }}
      >
        {visibleMetrics.includes('sets') && (
          <MetricItem label="S" value={metrics.sets} />
        )}

        {visibleMetrics.includes('reps') && (
          <>
            {visibleMetrics.includes('sets') && <MetricSeparator />}
            <MetricItem
              label="R"
              value={
                <>
                  <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{metrics.reps}</span>
                  {macroWeekTarget != null && (
                    <span style={{ color: 'var(--color-text-tertiary)', marginLeft: '4px' }}>/ {macroWeekTarget}</span>
                  )}
                  {repsProgress !== null && (
                    <span
                      style={{
                        marginLeft: '6px',
                        fontWeight: 500,
                        color: complianceColorToken(repsProgress),
                      }}
                    >
                      ({repsProgress}%)
                    </span>
                  )}
                </>
              }
            />
          </>
        )}

        {visibleMetrics.includes('max') && metrics.max > 0 && (
          <>
            <MetricSeparator />
            <MetricItem label="Max" value={metrics.max} />
          </>
        )}

        {visibleMetrics.includes('avg') && metrics.avg > 0 && (
          <>
            <MetricSeparator />
            <MetricItem label="Avg" value={metrics.avg} />
          </>
        )}

        {visibleMetrics.includes('tonnage') && metrics.tonnage > 0 && (
          <>
            <MetricSeparator />
            <MetricItem
              label="T"
              value={
                <>
                  <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{metrics.tonnage.toLocaleString()}</span>
                  <span style={{ color: 'var(--color-text-tertiary)', marginLeft: '4px' }}>kg</span>
                </>
              }
            />
          </>
        )}

        {visibleMetrics.includes('k') && metrics.k != null && (
          <>
            <MetricSeparator />
            <MetricItem label="K" value={`${(metrics.k * 100).toFixed(0)}%`} />
          </>
        )}

        {showStress && totalStress > 0 && (
          <>
            <MetricSeparator />
            <MetricItem label="Stress" value={totalStress} />
          </>
        )}

        {categories.length > 0 && (
          <>
            <MetricSeparator />
            <button
              onClick={() => setShowCategories(v => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'transparent',
                border: 'none',
                padding: '2px 4px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontSize: 'var(--text-label)',
                color: 'var(--color-text-tertiary)',
                transition: 'color 100ms ease-out',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
            >
              {showCategories ? <ChevronDown size={12} /> : <ChevronRightSmall size={12} />}
              <span>Categories</span>
            </button>
          </>
        )}

        {macroContext && (
          <>
            <MetricSeparator />
            <button
              onClick={() => navigate('/macrocycles')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'transparent',
                border: 'none',
                padding: '2px 4px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontSize: 'var(--text-label)',
                color: 'var(--color-text-tertiary)',
                transition: 'color 100ms ease-out',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100%',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {macroContext.macroName}
              </span>
              {(() => {
                const { bg, text } = weekTypeBadgeColor(macroContext.weekType);
                return (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '1px 6px',
                      borderRadius: '999px',
                      fontSize: 'var(--text-caption)',
                      fontWeight: 500,
                      background: bg,
                      color: text,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {macroContext.weekTypeText || macroContext.weekType}
                  </span>
                );
              })()}
            </button>
          </>
        )}
      </div>

      {/* ── Categories strip (collapsible) ───────────────────────────────── */}
      {showCategories && categories.length > 0 && (
        <div
          style={{
            padding: 'var(--space-sm) var(--space-lg) var(--space-md)',
            display: 'flex',
            flexWrap: 'wrap',
            columnGap: 'var(--space-xl)',
            rowGap: '4px',
            borderTop: '0.5px solid var(--color-border-tertiary)',
          }}
        >
          {categories.map(cat => (
            <div
              key={cat.category}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-sm)',
                fontSize: 'var(--text-label)',
              }}
            >
              <span
                style={{
                  color: 'var(--color-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '120px',
                }}
              >
                {cat.category}
              </span>
              <CategoryMetric label="S" value={cat.sets} />
              <CategoryMetric label="R" value={cat.reps} />
              {cat.tonnage > 0 && <CategoryMetric label="T" value={cat.tonnage.toLocaleString()} />}
            </div>
          ))}
        </div>
      )}

      {/* ── Schedule indicator (calendar-mapped mode only) ───────────────────── */}
      {daySchedule && Object.keys(daySchedule).length > 0 && (() => {
        const slots = Object.keys(daySchedule).map(Number).sort((a, b) => {
          const wa = daySchedule[a].weekday * 24 + (daySchedule[a].time ? parseInt(daySchedule[a].time!.replace(':', ''), 10) / 100 : 12);
          const wb = daySchedule[b].weekday * 24 + (daySchedule[b].time ? parseInt(daySchedule[b].time!.replace(':', ''), 10) / 100 : 12);
          return wa - wb;
        });
        const restInfos = calculateRestInfo(slots, daySchedule);
        const avgRest = restInfos.filter(r => r.hoursFromPrevious !== null);
        const avgRestHours = avgRest.length > 0
          ? Math.round(avgRest.reduce((s, r) => s + r.hoursFromPrevious!, 0) / avgRest.length)
          : null;
        return (
          <div
            style={{
              padding: '6px var(--space-lg)',
              borderTop: '0.5px solid var(--color-border-tertiary)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              flexWrap: 'wrap',
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            {slots.map(s => {
              const e = daySchedule[s];
              return (
                <span
                  key={s}
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontWeight: 500,
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {WEEKDAY_SHORT[e.weekday]}{e.time ? ` ${e.time}` : ''}
                </span>
              );
            }).reduce((acc: React.ReactNode[], el, i) => {
              if (i > 0) acc.push(
                <span
                  key={`dot-${i}`}
                  style={{ color: 'var(--color-border-tertiary)', userSelect: 'none' }}
                >
                  ·
                </span>
              );
              acc.push(el);
              return acc;
            }, [])}
            {avgRestHours !== null && (
              <span style={{ marginLeft: 'auto', color: 'var(--color-text-tertiary)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                  {avgRestHours}h
                </span>
                <span style={{ marginLeft: '4px' }}>avg rest</span>
              </span>
            )}
          </div>
        );
      })()}

      {/* ── MACRO phase + week timeline ──────────────────────────────────────── */}
      {phaseBarCells.length > 0 && (
        <div
          style={{
            padding: 'var(--space-sm) var(--space-lg)',
            borderTop: '0.5px solid var(--color-border-tertiary)',
          }}
        >
          <MacroPhaseBar
            cells={phaseBarCells}
            events={fetchedEvents}
            selectedWeekStart={phaseBarSelectedWeekStart}
            onCellClick={() => navigate('/macrocycles')}
          />
        </div>
      )}

      {/* ── WEEK NOTES ───────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '10px var(--space-lg)',
          borderTop: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <textarea
          value={localDesc}
          onChange={e => {
            setLocalDesc(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onBlur={e => { void onSaveWeekDescription(e.target.value); }}
          placeholder="Week brief — tell the athlete what to expect this week…"
          rows={1}
          className="planner-week-notes"
          style={{
            width: '100%',
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-primary)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            overflow: 'hidden',
            lineHeight: 1.55,
            minHeight: '1.5rem',
            fontFamily: 'var(--font-sans)',
          }}
        />
      </div>

      {/* ── Athlete profile dialog ───────────────────────────────────────────── */}
      {showAthleteProfile && selectedAthlete && (
        <Modal
          isOpen={true}
          onClose={() => setShowAthleteProfile(false)}
          size="sm"
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
              {selectedAthlete.photo_url ? (
                <img
                  src={selectedAthlete.photo_url}
                  alt={selectedAthlete.name}
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '0.5px solid var(--color-border-tertiary)',
                  }}
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: 'var(--color-accent-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <UserIcon size={18} style={{ color: 'var(--color-accent)' }} />
                </div>
              )}
              <div>
                <div style={{ fontSize: 'var(--text-section)', fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
                  {selectedAthlete.name}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0 var(--space-md)',
                    marginTop: '4px',
                    fontSize: 'var(--text-caption)',
                    color: 'var(--color-text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {athleteAge !== null && <span>{athleteAge} y/o</span>}
                  {selectedAthlete.weight_class && <span>−{selectedAthlete.weight_class} kg</span>}
                  {selectedAthlete.bodyweight && <span>{selectedAthlete.bodyweight} kg</span>}
                  {selectedAthlete.club && (
                    <span style={{ fontFamily: 'var(--font-sans)' }}>{selectedAthlete.club}</span>
                  )}
                </div>
              </div>
            </div>
          }
          footer={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowAthleteProfile(false); navigate('/athletes'); }}
            >
              Open full profile →
            </Button>
          }
        >
          {/* Competition PRs */}
          {competitionPRs.length > 0 && (
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <div
                style={{
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-tertiary)',
                  fontWeight: 500,
                  marginBottom: 'var(--space-sm)',
                }}
              >
                Competition lifts
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                {competitionPRs.map(pr => (
                  <div
                    key={pr.exerciseName}
                    style={{
                      background: 'var(--color-bg-secondary)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-sm) var(--space-md)',
                      border: '0.5px solid var(--color-border-tertiary)',
                      minWidth: '80px',
                    }}
                  >
                    <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                      {pr.exerciseName}
                    </div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 500,
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        marginTop: '2px',
                      }}
                    >
                      {pr.value}
                      <span
                        style={{
                          fontSize: 'var(--text-label)',
                          fontWeight: 400,
                          color: 'var(--color-text-tertiary)',
                          fontFamily: 'var(--font-sans)',
                          marginLeft: '3px',
                        }}
                      >
                        kg
                      </span>
                    </div>
                  </div>
                ))}
                {competitionPRs.length >= 2 && (
                  <div
                    style={{
                      background: 'var(--color-info-bg)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-sm) var(--space-md)',
                      border: '0.5px solid var(--color-info-border)',
                      minWidth: '80px',
                    }}
                  >
                    <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-info-text)' }}>
                      Total
                    </div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 500,
                        color: 'var(--color-info-text)',
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        marginTop: '2px',
                      }}
                    >
                      {competitionPRs.reduce((s, p) => s + p.value, 0)}
                      <span
                        style={{
                          fontSize: 'var(--text-label)',
                          fontWeight: 400,
                          opacity: 0.7,
                          fontFamily: 'var(--font-sans)',
                          marginLeft: '3px',
                        }}
                      >
                        kg
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {selectedAthlete.notes && (
            <div>
              <div
                style={{
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-tertiary)',
                  fontWeight: 500,
                  marginBottom: '6px',
                }}
              >
                Notes
              </div>
              <p
                style={{
                  fontSize: 'var(--text-body)',
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-line',
                  margin: 0,
                }}
              >
                {selectedAthlete.notes}
              </p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
