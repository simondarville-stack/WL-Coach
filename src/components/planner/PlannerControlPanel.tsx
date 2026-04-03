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
  const [prevWeekAdj, setPrevWeekAdj]       = useState<AdjacentWeek | null>(null);
  const [nextWeekAdj, setNextWeekAdj]       = useState<AdjacentWeek | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [localDesc, setLocalDesc]           = useState(weekDescription);

  useEffect(() => { setLocalDesc(weekDescription); }, [weekDescription]);

  useEffect(() => {
    if (!selectedAthlete) { setCompetitionPRs([]); return; }
    void loadCompetitionPRs(selectedAthlete.id);
  }, [selectedAthlete?.id]);

  useEffect(() => {
    if (!macroContext) { setPhases([]); setPrevWeekAdj(null); setNextWeekAdj(null); return; }
    void loadPhases(macroContext.macroId);
    void loadAdjacentWeeks(macroContext.macroId, macroContext.weekNumber);
  }, [macroContext?.macroId, macroContext?.weekNumber]);

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

  async function loadAdjacentWeeks(macroId: string, currentWk: number) {
    const { data } = await supabase
      .from('macro_weeks')
      .select('week_number, week_type, total_reps_target')
      .eq('macrocycle_id', macroId)
      .in('week_number', [currentWk - 1, currentWk + 1]);
    if (!data) return;
    type Row = { week_number: number; week_type: string; total_reps_target: number | null };
    const prev = (data as Row[]).find(w => w.week_number === currentWk - 1);
    const next = (data as Row[]).find(w => w.week_number === currentWk + 1);
    setPrevWeekAdj(prev ? { weekNumber: prev.week_number, weekType: prev.week_type, totalRepsTarget: prev.total_reps_target } : null);
    setNextWeekAdj(next ? { weekNumber: next.week_number, weekType: next.week_type, totalRepsTarget: next.total_reps_target } : null);
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
  const repsProgress   = macroWeekTarget
    ? Math.min(100, Math.round((metrics.totalReps / macroWeekTarget) * 100))
    : null;

  const athleteInitials = selectedAthlete?.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) ?? '';
  const athleteAge      = selectedAthlete?.birthdate ? calculateAge(selectedAthlete.birthdate) : null;
  const totalWeeks      = macroContext?.totalWeeks ?? 1;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mx-4 mt-4 mb-1 flex-shrink-0">

      {/* ── LAYER 1: Athlete info + tool buttons ─────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100">

        {/* LEFT: athlete/group info */}
        {selectedGroup ? (
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 border border-blue-200">
              <Users size={16} className="text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 leading-tight">{selectedGroup.name}</p>
              {selectedGroup.description && (
                <p className="text-[11px] text-gray-400 leading-tight mt-0.5 truncate">{selectedGroup.description}</p>
              )}
            </div>
            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium flex-shrink-0">Group</span>
          </div>
        ) : selectedAthlete ? (
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {selectedAthlete.photo_url ? (
              <img
                src={selectedAthlete.photo_url}
                alt={selectedAthlete.name}
                className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-gray-200"
                onError={e => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-700 flex-shrink-0 border border-blue-200">
                {athleteInitials}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 leading-tight">{selectedAthlete.name}</p>
              {(athleteAge !== null || selectedAthlete.bodyweight || selectedAthlete.weight_class || competitionPRs.length > 0) && (
                <p className="text-[11px] text-gray-400 leading-tight mt-0.5">
                  {[
                    athleteAge !== null ? `${athleteAge} yr` : null,
                    selectedAthlete.bodyweight ? `${selectedAthlete.bodyweight} kg` : null,
                    selectedAthlete.weight_class ? `-${selectedAthlete.weight_class}` : null,
                    ...competitionPRs.slice(0, 3).map(pr => `${abbreviateExercise(pr.exerciseName)} ${pr.value}`),
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* RIGHT: tool pills */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={onDayConfig}
            className="flex items-center gap-1 text-xs py-1 px-2 bg-gray-50 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <Settings2 size={11} />
            Days
          </button>
          {canCopyPaste && (
            <>
              <button
                onClick={onCopy}
                className="flex items-center gap-1 text-xs py-1 px-2 bg-gray-50 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <Copy size={11} />
                Copy
              </button>
              <button
                onClick={onPaste}
                disabled={!copiedWeekStart}
                className={[
                  'flex items-center gap-1 text-xs py-1 px-2 border rounded-md transition-colors',
                  copiedWeekStart
                    ? 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed',
                ].join(' ')}
              >
                <ClipboardPaste size={11} />
                Paste
              </button>
            </>
          )}
          <button
            onClick={onPrint}
            className="flex items-center gap-1 text-xs py-1 px-2 bg-gray-50 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <Printer size={11} />
            Print
          </button>
          <button
            onClick={onToggleLoadDistribution}
            className={[
              'flex items-center gap-1 text-xs py-1 px-2 border rounded-md transition-colors',
              showLoadDistribution
                ? 'bg-blue-50 border-blue-200 text-blue-600'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100',
            ].join(' ')}
          >
            <BarChart2 size={11} />
            Charts
          </button>
        </div>
      </div>

      {/* ── LAYER 2: Week navigation with peek cards ─────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">

        {/* Prev week card */}
        <button
          onClick={onPrevWeek}
          className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-md py-1.5 px-2.5 hover:bg-gray-100 transition-colors text-left"
          style={{ minWidth: 96 }}
        >
          <ChevronLeft size={13} className="text-gray-400 flex-shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-[9px] uppercase text-gray-400 tracking-wide leading-none">Last week</span>
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              {prevWeekAdj ? (
                <>
                  <span className={`text-[9px] font-medium px-1 py-px rounded border ${weekTypeBadgeStyle(prevWeekAdj.weekType)}`}>
                    {prevWeekAdj.weekType}
                  </span>
                  {prevWeekAdj.totalRepsTarget != null && (
                    <span className="text-[9px] text-gray-400">R {prevWeekAdj.totalRepsTarget}</span>
                  )}
                </>
              ) : (
                <span className="text-[9px] text-gray-300 italic">—</span>
              )}
            </div>
          </div>
        </button>

        {/* Center: date + "Week X of Y" */}
        <div className="flex-1 flex flex-col items-center gap-0.5">
          <span className="text-[15px] font-medium text-gray-900 select-none leading-tight">
            {formatDateRange(selectedDate, 7)}
          </span>
          {macroContext && (
            <span className="text-[10px] text-gray-400 leading-none">
              Week {macroContext.weekNumber}{macroContext.totalWeeks > 0 ? ` of ${macroContext.totalWeeks}` : ''}
            </span>
          )}
        </div>

        {/* Next week card */}
        <button
          onClick={onNextWeek}
          className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-md py-1.5 px-2.5 hover:bg-gray-100 transition-colors text-right"
          style={{ minWidth: 96 }}
        >
          <div className="flex flex-col items-end min-w-0 flex-1">
            <span className="text-[9px] uppercase text-gray-400 tracking-wide leading-none">Next week</span>
            <div className="mt-1 flex items-center gap-1 flex-wrap justify-end">
              {nextWeekAdj ? (
                <>
                  {nextWeekAdj.totalRepsTarget != null && (
                    <span className="text-[9px] text-gray-400">R {nextWeekAdj.totalRepsTarget}</span>
                  )}
                  <span className={`text-[9px] font-medium px-1 py-px rounded border ${weekTypeBadgeStyle(nextWeekAdj.weekType)}`}>
                    {nextWeekAdj.weekType}
                  </span>
                </>
              ) : (
                <span className="text-[9px] text-gray-300 italic">—</span>
              )}
            </div>
          </div>
          <ChevronRight size={13} className="text-gray-400 flex-shrink-0" />
        </button>
      </div>

      {/* ── LAYER 3: Macro phase timeline ────────────────────────────────── */}
      {macroContext && (
        <div
          className="bg-gray-50/60 border-b border-gray-100 px-4 py-2 cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={() => navigate('/macrocycles')}
          title="Open macro cycles"
        >
          <div className="flex items-center gap-3">

            {/* LEFT: macro name + week */}
            <div className="flex-shrink-0 w-28">
              <p className="text-[10px] text-gray-500 truncate leading-tight">{macroContext.macroName}</p>
              <p className="text-[10px] font-semibold text-gray-700 leading-tight">
                Wk {macroContext.weekNumber}{macroContext.totalWeeks > 0 ? `/${macroContext.totalWeeks}` : ''}
              </p>
            </div>

            {/* CENTER: phase timeline bar */}
            <div className="flex-1 relative h-5">
              <div className="flex h-full rounded overflow-hidden bg-gray-200">
                {phases.length > 0 ? (
                  phases.map(phase => {
                    const duration = phase.end_week_number - phase.start_week_number + 1;
                    const pct      = (duration / totalWeeks) * 100;
                    const showText = pct > 12;
                    return (
                      <div
                        key={phase.id}
                        className="relative flex items-center justify-center overflow-hidden"
                        style={{ width: `${pct}%`, backgroundColor: phase.color || '#D1D5DB' }}
                        title={`${phase.name} — Wk ${phase.start_week_number}–${phase.end_week_number}`}
                      >
                        {showText && (
                          <span className="text-[8px] font-semibold text-white/90 px-0.5 truncate leading-none drop-shadow-sm">
                            {phase.name}
                          </span>
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
                      <span className="text-[8px] font-semibold text-white/90 truncate">
                        {macroContext.phaseName}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {/* Current-week position marker */}
              {macroContext.totalWeeks > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-[2px] bg-gray-900 rounded pointer-events-none"
                  style={{ left: `calc(${((macroContext.weekNumber - 1) / macroContext.totalWeeks) * 100}% + 1px)` }}
                />
              )}
            </div>

            {/* RIGHT: week type badge */}
            <div className="flex-shrink-0">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${weekTypeBadgeStyle(macroContext.weekType)}`}>
                {macroContext.weekTypeText || macroContext.weekType}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── LAYER 4: Metric cards ─────────────────────────────────────────── */}
      <div className="px-4 py-2.5">
        <div className="flex items-start gap-2.5 flex-wrap">

          {visibleMetrics.includes('sets') && (
            <div className="bg-gray-50 rounded-md py-2 px-3 min-w-[52px]">
              <p className="text-[9px] uppercase text-gray-400 tracking-[0.3px] leading-none mb-1">Sets</p>
              <p className="text-lg font-medium text-gray-900 leading-none">{metrics.totalSets}</p>
            </div>
          )}

          {visibleMetrics.includes('reps') && (
            <div className="bg-gray-50 rounded-md py-2 px-3 min-w-[52px]">
              <p className="text-[9px] uppercase text-gray-400 tracking-[0.3px] leading-none mb-1">Reps</p>
              <div className="flex items-baseline gap-1 leading-none">
                <p className="text-lg font-medium text-gray-900 leading-none">{metrics.totalReps}</p>
                {macroWeekTarget != null && (
                  <span className="text-xs text-gray-400">/ {macroWeekTarget}</span>
                )}
              </div>
              {repsProgress !== null && (
                <p className={[
                  'text-[9px] font-medium mt-0.5 leading-none',
                  repsProgress >= 90 ? 'text-green-600' : repsProgress >= 70 ? 'text-amber-500' : 'text-red-500',
                ].join(' ')}>{repsProgress}%</p>
              )}
            </div>
          )}

          {visibleMetrics.includes('tonnage') && metrics.totalTonnage > 0 && (
            <div className="bg-gray-50 rounded-md py-2 px-3 min-w-[52px]">
              <p className="text-[9px] uppercase text-gray-400 tracking-[0.3px] leading-none mb-1">Tonnage</p>
              <p className="text-lg font-medium text-gray-900 leading-none">{metrics.totalTonnage.toLocaleString()}</p>
            </div>
          )}

          {showStress && metrics.totalStress > 0 && (
            <div className="bg-gray-50 rounded-md py-2 px-3 min-w-[52px]">
              <p className="text-[9px] uppercase text-gray-400 tracking-[0.3px] leading-none mb-1">Stress</p>
              <p className="text-lg font-medium text-gray-900 leading-none">{metrics.totalStress}</p>
            </div>
          )}

          {metrics.categories.length > 0 && (
            <button
              onClick={() => setShowCategories(v => !v)}
              className="ml-auto self-center flex items-center gap-0.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showCategories ? <ChevronDown size={12} /> : <ChevronRightSmall size={12} />}
              Categories
            </button>
          )}
        </div>

        {showCategories && metrics.categories.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
            {metrics.categories.map(cat => (
              <div key={cat.category} className="flex items-center gap-3 text-xs">
                <span className="text-gray-600 flex-1 truncate">{cat.category}</span>
                <span className="text-gray-500">S <strong className="text-gray-900">{cat.sets}</strong></span>
                <span className="text-gray-500">R <strong className="text-gray-900">{cat.reps}</strong></span>
                {cat.tonnage > 0 && (
                  <span className="text-gray-500">T <strong className="text-gray-900">{cat.tonnage.toLocaleString()}</strong></span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Week description ─────────────────────────────────────────────── */}
      <div className="px-4 pb-2.5 border-t border-gray-100">
        <textarea
          value={localDesc}
          onChange={e => setLocalDesc(e.target.value)}
          onBlur={e => { void onSaveWeekDescription(e.target.value); }}
          placeholder="Week notes / description…"
          rows={1}
          className="w-full text-xs text-gray-700 italic placeholder-gray-400 bg-transparent resize-none border-0 focus:outline-none focus:border-b focus:border-gray-200 leading-relaxed pt-2"
        />
      </div>

    </div>
  );
}
