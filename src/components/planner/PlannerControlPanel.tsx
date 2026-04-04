import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight,
  Settings2, Copy, ClipboardPaste, Printer, BarChart2,
  ChevronDown, ChevronRight as ChevronRightSmall,
  Users,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type {
  Athlete, TrainingGroup, AthletePR, Exercise, PlannedExercise,
  GeneralSettings, MacroPhase,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { formatDateRange } from '../../lib/dateUtils';
import { calculateAge } from '../../lib/calculations';

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
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">

        {/* LEFT: avatar + name */}
        <div className="flex items-center gap-2 flex-shrink-0 min-w-0" style={{ width: 180 }}>
          {selectedGroup ? (
            <>
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Users size={14} className="text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate leading-tight">{selectedGroup.name}</p>
              </div>
            </>
          ) : selectedAthlete ? (
            <>
              {selectedAthlete.photo_url ? (
                <img
                  src={selectedAthlete.photo_url}
                  alt={selectedAthlete.name}
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-gray-200"
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-700 flex-shrink-0">
                  {athleteInitials}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate leading-tight">{selectedAthlete.name}</p>
                {subLabel && <p className="text-[10px] text-gray-400 leading-tight truncate">{subLabel}</p>}
              </div>
            </>
          ) : null}
        </div>

        {/* CENTER: week navigation */}
        <div className="flex-1 flex items-center justify-center gap-1">
          <button
            onClick={onPrevWeek}
            className="flex items-center gap-0.5 px-2 py-1 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
          >
            <ChevronLeft size={13} />
            <span className="text-[11px]">Prev</span>
          </button>

          <div className="flex flex-col items-center px-2">
            <span className="text-sm font-medium text-gray-900 leading-tight select-none">
              {formatDateRange(selectedDate, 7)}
            </span>
            {macroContext && (
              <span className="text-[10px] text-gray-400 leading-none">
                Week {macroContext.weekNumber}{macroContext.totalWeeks > 0 ? ` of ${macroContext.totalWeeks}` : ''}
              </span>
            )}
          </div>

          <button
            onClick={onNextWeek}
            className="flex items-center gap-0.5 px-2 py-1 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
          >
            <span className="text-[11px]">Next</span>
            <ChevronRight size={13} />
          </button>
        </div>

        {/* RIGHT: tool buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onDayConfig}
            title="Day settings"
            className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <Settings2 size={14} />
          </button>
          {canCopyPaste && (
            <>
              <button
                onClick={onCopy}
                title="Copy week"
                className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={onPaste}
                disabled={!copiedWeekStart}
                title="Paste week"
                className={`p-1.5 rounded transition-colors ${
                  copiedWeekStart ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-900' : 'text-gray-300 cursor-not-allowed'
                }`}
              >
                <ClipboardPaste size={14} />
              </button>
            </>
          )}
          <button
            onClick={onPrint}
            title="Print week"
            className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <Printer size={14} />
          </button>
          <button
            onClick={onToggleLoadDistribution}
            title="Load distribution chart"
            className={`p-1.5 rounded transition-colors ${
              showLoadDistribution ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <BarChart2 size={14} />
          </button>
        </div>
      </div>

      {/* ── ROW 2: Metrics strip + week description ─────────────────────────── */}
      <div className="px-4 py-1.5 flex items-center gap-0 text-xs">

        {visibleMetrics.includes('sets') && (
          <>
            <span className="text-[10px] uppercase text-gray-400 mr-1">S</span>
            <span className="font-medium text-gray-900">{metrics.totalSets}</span>
          </>
        )}

        {visibleMetrics.includes('reps') && (
          <>
            <span className="text-gray-300 mx-2">·</span>
            <span className="text-[10px] uppercase text-gray-400 mr-1">R</span>
            <span className="font-medium text-gray-900">{metrics.totalReps}</span>
            {macroWeekTarget != null && (
              <span className="text-gray-400 ml-1">/ {macroWeekTarget}</span>
            )}
            {repsProgress !== null && (
              <span className={`ml-1 font-medium ${complianceColor(repsProgress)}`}>({repsProgress}%)</span>
            )}
          </>
        )}

        {visibleMetrics.includes('tonnage') && metrics.totalTonnage > 0 && (
          <>
            <span className="text-gray-300 mx-2">·</span>
            <span className="text-[10px] uppercase text-gray-400 mr-1">T</span>
            <span className="font-medium text-gray-900">{metrics.totalTonnage.toLocaleString()}</span>
            <span className="text-gray-400 ml-0.5">kg</span>
          </>
        )}

        {showStress && metrics.totalStress > 0 && (
          <>
            <span className="text-gray-300 mx-2">·</span>
            <span className="text-[10px] uppercase text-gray-400 mr-1">Stress</span>
            <span className="font-medium text-gray-900">{metrics.totalStress}</span>
          </>
        )}

        {metrics.categories.length > 0 && (
          <>
            <span className="text-gray-300 mx-2">·</span>
            <button
              onClick={() => setShowCategories(v => !v)}
              className="flex items-center gap-0.5 text-gray-400 hover:text-gray-700 transition-colors"
            >
              {showCategories ? <ChevronDown size={11} /> : <ChevronRightSmall size={11} />}
              <span className="text-[11px]">Categories</span>
            </button>
          </>
        )}

        {macroContext && (
          <>
            <span className="text-gray-300 mx-2">·</span>
            <button
              onClick={() => navigate('/macrocycles')}
              className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors truncate"
            >
              {macroContext.macroName} — <span className={`font-medium px-1 py-px rounded border text-[9px] ${weekTypeBadgeStyle(macroContext.weekType)}`}>{macroContext.weekTypeText || macroContext.weekType}</span>
            </button>
          </>
        )}

        {/* Week description inline */}
        <input
          value={localDesc}
          onChange={e => setLocalDesc(e.target.value)}
          onBlur={e => { void onSaveWeekDescription(e.target.value); }}
          placeholder="Week notes…"
          className="ml-3 flex-1 text-[11px] text-gray-500 italic placeholder-gray-300 bg-transparent border-0 focus:outline-none min-w-0"
        />
      </div>

      {/* ── Categories strip (collapsible) ──────────────────────────────────── */}
      {showCategories && metrics.categories.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-x-4 gap-y-0.5 border-t border-gray-50 pt-1.5">
          {metrics.categories.map(cat => (
            <div key={cat.category} className="flex items-center gap-2 text-[11px]">
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

      {/* ── MACRO phase timeline (conditional) ──────────────────────────────── */}
      {macroContext && (
        <div
          className="h-4 flex cursor-pointer"
          onClick={() => navigate('/macrocycles')}
          title="Open macro cycles"
        >
          <div className="flex w-full">
            {phases.length > 0 ? (
              phases.map(phase => {
                const duration = phase.end_week_number - phase.start_week_number + 1;
                const pct      = (duration / totalWeeks) * 100;
                const showText = pct > 15;
                return (
                  <div
                    key={phase.id}
                    className="relative flex items-center justify-center overflow-hidden"
                    style={{ width: `${pct}%`, backgroundColor: phase.color || '#D1D5DB' }}
                    title={`${phase.name} — Wk ${phase.start_week_number}–${phase.end_week_number}`}
                  >
                    {showText && (
                      <span className="text-[8px] font-medium text-white/90 px-0.5 truncate leading-none">
                        {phase.name}
                      </span>
                    )}
                    {/* Current-week marker */}
                    {macroContext.weekNumber >= phase.start_week_number && macroContext.weekNumber <= phase.end_week_number && totalWeeks > 0 && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-gray-900/50 pointer-events-none"
                        style={{ left: `${((macroContext.weekNumber - phase.start_week_number) / duration) * 100}%` }}
                      />
                    )}
                  </div>
                );
              })
            ) : (
              <div
                className="flex-1 flex items-center justify-center"
                style={{ backgroundColor: macroContext.phaseColor || '#93C5FD' }}
              >
                {macroContext.phaseName && (
                  <span className="text-[8px] font-medium text-white/90 truncate">
                    {macroContext.phaseName}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
