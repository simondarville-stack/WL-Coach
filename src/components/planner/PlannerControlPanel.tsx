import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight,
  Settings2, Copy, ClipboardPaste, Printer, BarChart2,
  ChevronDown, ChevronRight as ChevronRightSmall,
  Users, X, User as UserIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type {
  Athlete, TrainingGroup, AthletePR, Exercise, PlannedExercise,
  GeneralSettings, MacroPhase,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { formatDateRange } from '../../lib/dateUtils';
import { calculateAge } from '../../lib/calculations';
import { calculateRestInfo } from '../../lib/restCalculation';

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

function weekTypeBadgeStyle(weekType: string): string {
  switch (weekType) {
    case 'High':        return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'Medium':      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Low':         return 'bg-green-100 text-green-700 border-green-200';
    case 'Deload':      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'Competition': return 'bg-red-100 text-red-700 border-red-200';
    case 'Taper':       return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'Testing':     return 'bg-purple-100 text-purple-700 border-purple-200';
    default:            return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

function complianceColor(pct: number): string {
  if (pct >= 90) return 'text-green-600';
  if (pct >= 70) return 'text-amber-500';
  return 'text-red-500';
}

// ─── types ───────────────────────────────────────────────────────────────────

interface CompetitionPR {
  exerciseName: string;
  value: number;
}

interface AdjacentWeek {
  weekNumber: number;
  weekType: string;
  totalRepsTarget: number | null;
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
}: PlannerControlPanelProps) {
  const navigate = useNavigate();

  const [competitionPRs, setCompetitionPRs] = useState<CompetitionPR[]>([]);
  const [phases, setPhases]                 = useState<MacroPhase[]>([]);
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
    if (!macroContext) { setPhases([]); return; }
    void loadPhases(macroContext.macroId);
  }, [macroContext?.macroId]);

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

  // ── metrics ──────────────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const prMap = new Map<string, number>(
      athletePRs.filter(pr => pr.pr_value_kg).map(pr => [pr.exercise_id, pr.pr_value_kg!])
    );
    let totalSets = 0, totalReps = 0, totalTonnage = 0, totalStress = 0;
    const catMap = new Map<string, { category: string; sets: number; reps: number; tonnage: number }>();
    Object.values(plannedExercises).forEach(dayExs => {
      dayExs.forEach(ex => {
        if (!ex.exercise.counts_towards_totals) return;
        const s = ex.summary_total_sets ?? 0;
        const r = ex.summary_total_reps ?? 0;
        const avg = ex.summary_avg_load ?? 0;
        const ton = ex.unit === 'absolute_kg' ? avg * r : 0;
        totalSets += s; totalReps += r; totalTonnage += ton;
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
      totalSets, totalReps,
      totalTonnage: Math.round(totalTonnage),
      totalStress: Math.round(totalStress * 10) / 10,
      categories: Array.from(catMap.values()).sort((a, b) => b.reps - a.reps),
    };
  }, [plannedExercises, athletePRs]);

  const visibleMetrics = settings?.visible_summary_metrics ?? ['sets', 'reps', 'tonnage'];
  const showStress     = settings?.show_stress_metric ?? false;
  const repsProgress   = macroWeekTarget && metrics.totalReps > 0
    ? Math.min(100, Math.round((metrics.totalReps / macroWeekTarget) * 100))
    : null;

  const athleteInitials = selectedAthlete?.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) ?? '';
  const athleteAge      = selectedAthlete?.birthdate ? calculateAge(selectedAthlete.birthdate) : null;
  const totalWeeks      = macroContext?.totalWeeks ?? 1;

  const subLabel = [
    athleteAge !== null ? `${athleteAge} yr` : null,
    selectedAthlete?.bodyweight ? `${selectedAthlete.bodyweight} kg` : null,
    selectedAthlete?.weight_class ? `-${selectedAthlete.weight_class}` : null,
    ...competitionPRs.slice(0, 2).map(pr => `${abbreviateExercise(pr.exerciseName)} ${pr.value}`),
  ].filter(Boolean).join(' · ');

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white border-b border-gray-200 flex-shrink-0">

      {/* ── ROW 1: Athlete + Week nav + Tools ──────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">

        {/* LEFT: avatar + name — double-click to view athlete profile */}
        <div
          className="flex items-center gap-3 flex-shrink-0 min-w-0"
          style={{ width: 200 }}
          onDoubleClick={() => selectedAthlete && setShowAthleteProfile(true)}
          title={selectedAthlete ? 'Double-click to view athlete profile' : undefined}
        >
          {selectedGroup ? (
            <>
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Users size={18} className="text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold text-gray-900 truncate leading-tight">{selectedGroup.name}</p>
              </div>
            </>
          ) : selectedAthlete ? (
            <>
              {selectedAthlete.photo_url ? (
                <img
                  src={selectedAthlete.photo_url}
                  alt={selectedAthlete.name}
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0 border border-gray-200"
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-700 flex-shrink-0">
                  {athleteInitials}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-base font-semibold text-gray-900 truncate leading-tight">{selectedAthlete.name}</p>
                {subLabel && <p className="text-xs text-gray-400 leading-tight truncate mt-0.5">{subLabel}</p>}
              </div>
            </>
          ) : null}
        </div>

        {/* CENTER: week navigation */}
        <div className="flex-1 flex items-center justify-center gap-2">
          <button
            onClick={onPrevWeek}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeft size={15} />
            <span>Prev</span>
          </button>

          <div className="flex flex-col items-center px-3">
            <span className="text-base font-semibold text-gray-900 leading-tight select-none">
              {formatDateRange(selectedDate, 7)}
            </span>
            {macroContext && (
              <span className="text-xs text-gray-400 leading-none mt-0.5">
                Week {macroContext.weekNumber}{macroContext.totalWeeks > 0 ? ` of ${macroContext.totalWeeks}` : ''}
              </span>
            )}
          </div>

          <button
            onClick={onNextWeek}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <span>Next</span>
            <ChevronRight size={15} />
          </button>
        </div>

        {/* RIGHT: tool buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={onDayConfig}
            title="Day settings"
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <Settings2 size={16} />
          </button>
          {canCopyPaste && (
            <>
              <button
                onClick={() => { onCopy(); setCopyFlash(true); setTimeout(() => setCopyFlash(false), 1200); }}
                title="Copy week"
                className={`p-2 rounded-lg transition-colors ${copyFlash ? 'bg-green-50 text-green-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}
              >
                <Copy size={16} />
              </button>
              <button
                onClick={onPaste}
                disabled={!copiedWeekStart}
                title="Paste week"
                className={`p-2 rounded-lg transition-colors ${
                  copiedWeekStart ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-900' : 'text-gray-300 cursor-not-allowed'
                }`}
              >
                <ClipboardPaste size={16} />
              </button>
            </>
          )}
          <button
            onClick={onPrint}
            title="Print week"
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <Printer size={16} />
          </button>
          <button
            onClick={onToggleLoadDistribution}
            title="Load distribution chart"
            className={`p-2 rounded-lg transition-colors ${
              showLoadDistribution ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <BarChart2 size={16} />
          </button>
        </div>
      </div>

      {/* ── ROW 2: Metrics strip ─────────────────────────────────────────────── */}
      <div className="px-4 py-2 flex items-center gap-0 text-sm">

        {visibleMetrics.includes('sets') && (
          <>
            <span className="text-xs uppercase text-gray-400 mr-1 font-medium">S</span>
            <span className="font-semibold text-gray-900">{metrics.totalSets}</span>
          </>
        )}

        {visibleMetrics.includes('reps') && (
          <>
            <span className="text-gray-300 mx-2.5">·</span>
            <span className="text-xs uppercase text-gray-400 mr-1 font-medium">R</span>
            <span className="font-semibold text-gray-900">{metrics.totalReps}</span>
            {macroWeekTarget != null && (
              <span className="text-gray-400 ml-1 text-sm">/ {macroWeekTarget}</span>
            )}
            {repsProgress !== null && (
              <span className={`ml-1.5 font-semibold text-sm ${complianceColor(repsProgress)}`}>({repsProgress}%)</span>
            )}
          </>
        )}

        {visibleMetrics.includes('tonnage') && metrics.totalTonnage > 0 && (
          <>
            <span className="text-gray-300 mx-2.5">·</span>
            <span className="text-xs uppercase text-gray-400 mr-1 font-medium">T</span>
            <span className="font-semibold text-gray-900">{metrics.totalTonnage.toLocaleString()}</span>
            <span className="text-gray-400 ml-1">kg</span>
          </>
        )}

        {showStress && metrics.totalStress > 0 && (
          <>
            <span className="text-gray-300 mx-2.5">·</span>
            <span className="text-xs uppercase text-gray-400 mr-1 font-medium">Stress</span>
            <span className="font-semibold text-gray-900">{metrics.totalStress}</span>
          </>
        )}

        {metrics.categories.length > 0 && (
          <>
            <span className="text-gray-300 mx-2.5">·</span>
            <button
              onClick={() => setShowCategories(v => !v)}
              className="flex items-center gap-1 text-gray-400 hover:text-gray-700 transition-colors text-sm"
            >
              {showCategories ? <ChevronDown size={12} /> : <ChevronRightSmall size={12} />}
              <span>Categories</span>
            </button>
          </>
        )}

        {macroContext && (
          <>
            <span className="text-gray-300 mx-2.5">·</span>
            <button
              onClick={() => navigate('/macrocycles')}
              className="text-sm text-gray-400 hover:text-gray-700 transition-colors truncate flex items-center gap-1.5"
            >
              {macroContext.macroName}
              <span className={`inline-block font-medium px-1.5 py-0.5 rounded border text-[10px] ${weekTypeBadgeStyle(macroContext.weekType)}`}>
                {macroContext.weekTypeText || macroContext.weekType}
              </span>
            </button>
          </>
        )}
      </div>

      {/* ── Categories strip (collapsible) ──────────────────────────────────── */}
      {showCategories && metrics.categories.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-gray-50 pt-2">
          {metrics.categories.map(cat => (
            <div key={cat.category} className="flex items-center gap-2.5 text-sm">
              <span className="text-gray-500 truncate max-w-[120px]">{cat.category}</span>
              <span className="text-gray-400">S <span className="text-gray-700 font-medium">{cat.sets}</span></span>
              <span className="text-gray-400">R <span className="text-gray-700 font-medium">{cat.reps}</span></span>
              {cat.tonnage > 0 && (
                <span className="text-gray-400">T <span className="text-gray-700 font-medium">{cat.tonnage.toLocaleString()}</span></span>
              )}
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
          <div className="px-4 py-1.5 border-t border-gray-100 flex items-center gap-2 text-[10px] text-gray-400 flex-wrap">
            {slots.map(s => {
              const e = daySchedule[s];
              return (
                <span key={s} className="text-gray-600 font-medium">
                  {WEEKDAY_SHORT[e.weekday]}{e.time ? ` ${e.time}` : ''}
                </span>
              );
            }).reduce((acc: React.ReactNode[], el, i) => {
              if (i > 0) acc.push(<span key={`dot-${i}`} className="text-gray-200">·</span>);
              acc.push(el);
              return acc;
            }, [])}
            {avgRestHours !== null && (
              <span className="ml-auto text-gray-400">{avgRestHours}h avg rest</span>
            )}
          </div>
        );
      })()}

      {/* ── MACRO phase + week timeline ──────────────────────────────────────── */}
      {macroContext && totalWeeks > 0 && (
        <div
          className="flex cursor-pointer overflow-hidden"
          style={{ height: 32 }}
          onClick={() => navigate('/macrocycles')}
          title="Open macro cycles"
        >
          {Array.from({ length: totalWeeks }, (_, i) => {
            const weekNum = i + 1;
            const phase = phases.find(p => weekNum >= p.start_week_number && weekNum <= p.end_week_number);
            const baseColor = phase?.color || macroContext.phaseColor || '#93C5FD';
            const isCurrentWeek = weekNum === macroContext.weekNumber;

            // Show phase label on the first week of each phase (if phase is wide enough)
            const isFirstOfPhase = phase ? weekNum === phase.start_week_number : false;
            const phaseDuration = phase ? phase.end_week_number - phase.start_week_number + 1 : 0;
            const showPhaseLabel = isFirstOfPhase && phaseDuration >= Math.ceil(totalWeeks * 0.12);

            return (
              <div
                key={weekNum}
                className="relative flex items-center justify-center flex-shrink-0"
                style={{
                  width: `${100 / totalWeeks}%`,
                  backgroundColor: baseColor,
                  borderRight: i < totalWeeks - 1 ? '1px solid rgba(255,255,255,0.3)' : undefined,
                }}
                title={`Week ${weekNum}${phase ? ` · ${phase.name}` : ''}`}
              >
                {/* Current-week highlight overlay */}
                {isCurrentWeek && (
                  <div className="absolute inset-0" style={{ backgroundColor: 'rgba(255,255,255,0.28)' }} />
                )}

                {/* Phase name label (positioned at start of phase, spanning full phase) */}
                {showPhaseLabel && (
                  <span
                    className="absolute left-1 top-0.5 text-[9px] font-semibold text-white/90 leading-none truncate pointer-events-none z-10"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {phase!.name}
                  </span>
                )}

                {/* Week number */}
                <span
                  className={`text-[11px] leading-none z-10 relative select-none ${
                    isCurrentWeek ? 'font-bold text-white drop-shadow' : 'font-semibold text-white/85'
                  }`}
                >
                  {weekNum}
                </span>

                {/* Current-week bottom accent bar */}
                {isCurrentWeek && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/60" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── WEEK NOTES: between bar and cards ───────────────────────────────── */}
      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/40">
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
          className="w-full text-sm text-gray-700 placeholder-gray-300 bg-transparent border-0 focus:outline-none leading-relaxed resize-none overflow-hidden"
          style={{ minHeight: '1.5rem' }}
        />
      </div>

      {/* ── Athlete profile dialog ───────────────────────────────────────────── */}
      {showAthleteProfile && selectedAthlete && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 animate-backdrop-in"
          onClick={() => setShowAthleteProfile(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-sm animate-dialog-in"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between p-5 pb-4">
              <div className="flex items-center gap-4">
                {selectedAthlete.photo_url ? (
                  <img
                    src={selectedAthlete.photo_url}
                    alt={selectedAthlete.name}
                    className="w-14 h-14 rounded-full object-cover border border-gray-200 flex-shrink-0"
                    onError={e => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <UserIcon size={22} className="text-blue-600" />
                  </div>
                )}
                <div>
                  <h2 className="text-base font-semibold text-gray-900 leading-tight">{selectedAthlete.name}</h2>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {athleteAge !== null && (
                      <span className="text-xs text-gray-500">{athleteAge} y/o</span>
                    )}
                    {selectedAthlete.weight_class && (
                      <span className="text-xs text-gray-500">-{selectedAthlete.weight_class} kg</span>
                    )}
                    {selectedAthlete.bodyweight && (
                      <span className="text-xs text-gray-500">{selectedAthlete.bodyweight} kg</span>
                    )}
                    {selectedAthlete.club && (
                      <span className="text-xs text-gray-400">{selectedAthlete.club}</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowAthleteProfile(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X size={16} />
              </button>
            </div>

            {/* Competition PRs */}
            {competitionPRs.length > 0 && (
              <div className="px-5 pb-4 border-t border-gray-100 pt-4">
                <div className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-2">Competition lifts</div>
                <div className="flex flex-wrap gap-3">
                  {competitionPRs.map(pr => (
                    <div key={pr.exerciseName} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{pr.exerciseName}</div>
                      <div className="text-lg font-semibold text-gray-900 mt-0.5">{pr.value} <span className="text-sm font-normal text-gray-400">kg</span></div>
                    </div>
                  ))}
                  {competitionPRs.length >= 2 && (
                    <div className="bg-blue-50 rounded-lg px-3 py-2 border border-blue-100">
                      <div className="text-[10px] text-blue-400 uppercase tracking-wide font-medium">Total</div>
                      <div className="text-lg font-semibold text-blue-700 mt-0.5">
                        {competitionPRs.reduce((s, p) => s + p.value, 0)} <span className="text-sm font-normal text-blue-400">kg</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notes */}
            {selectedAthlete.notes && (
              <div className="px-5 pb-4 border-t border-gray-100 pt-4">
                <div className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-1.5">Notes</div>
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{selectedAthlete.notes}</p>
              </div>
            )}

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => { setShowAthleteProfile(false); navigate('/athletes'); }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Open full profile →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
