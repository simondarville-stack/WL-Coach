import { useEffect, useState } from 'react';
import { X, Printer, FileText, LayoutGrid } from 'lucide-react';
import { useCoachStore } from '../../store/coachStore';
import type { WeekPlan, PlannedExercise, Exercise, Athlete, DefaultUnit, ComboMemberEntry } from '../../lib/database.types';
import { DAYS_OF_WEEK, getUnitSymbol } from '../../lib/constants';
import { formatDateRange, formatDateToDDMMYYYY } from '../../lib/dateUtils';
import { calculateAge } from '../../lib/calculations';
import { parsePrescription, parseComboPrescription } from '../../lib/prescriptionParser';
import { useWeekPlans } from '../../hooks/useWeekPlans';
import { useCombos } from '../../hooks/useCombos';
import { PrintWeekCompact } from './PrintWeekCompact';

interface PrintWeekProps {
  athlete: Athlete;
  weekStart: string;
  onClose: () => void;
  showCategorySummaries?: boolean;
  dayLabels?: Record<number, string> | null;
  weekDescription?: string | null;
}

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

function formatUnit(unit: DefaultUnit | string | null): string {
  if (unit === 'absolute_kg') return 'kg';
  if (unit === 'percentage') return '%';
  if (unit === 'rpe') return 'RPE';
  return '';
}

function InlinePrescription({ prescription, unit, isCombo }: { prescription: string | null; unit: string | null; isCombo?: boolean }) {
  if (!prescription?.trim()) return <span className="text-gray-500 italic">No prescription</span>;
  const unitSym = unit === 'percentage' ? '%' : unit === 'rpe' ? ' RPE' : '';
  if (isCombo) {
    const parsed = parseComboPrescription(prescription);
    if (parsed.length === 0) return <span>{prescription}</span>;
    return (
      <div className="flex flex-wrap gap-4">
        {parsed.map((line, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="inline-flex flex-col items-center">
              <span className="text-sm font-semibold text-gray-900">
                {line.loadMax != null ? `${line.load}-${line.loadMax}${unitSym}` : `${line.load}${unitSym}`}
              </span>
              <div className="border-t border-gray-400 w-full my-0.5" />
              <span className="text-sm font-semibold text-gray-900">{line.repsText}</span>
            </div>
            {line.sets > 1 && <span className="text-sm font-bold text-gray-900">{line.sets}</span>}
          </div>
        ))}
      </div>
    );
  }
  const parsed = parsePrescription(prescription);
  if (parsed.length === 0) return <span>{prescription}</span>;
  return (
    <div className="flex flex-wrap gap-4">
      {parsed.map((line, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="inline-flex flex-col items-center">
            <span className="text-sm font-semibold text-gray-900">
              {line.loadMax != null ? `${line.load}-${line.loadMax}${unitSym}` : `${line.load}${unitSym}`}
            </span>
            <div className="border-t border-gray-400 w-full my-0.5" />
            <span className="text-sm font-semibold text-gray-900">{line.reps}</span>
          </div>
          {line.sets > 1 && <span className="text-sm font-bold text-gray-900">{line.sets}</span>}
        </div>
      ))}
    </div>
  );
}

export function PrintWeek({ athlete, weekStart, onClose, showCategorySummaries = true, dayLabels = null, weekDescription = null }: PrintWeekProps) {
  const { fetchWeekPlanForAthlete, fetchPlannedExercisesFlat } = useWeekPlans();
  const { fetchProgrammeData } = useCombos();
  const { activeCoach } = useCoachStore();

  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<Record<number, (PlannedExercise & { exercise: Exercise })[]>>({});
  const [comboMembers, setComboMembers] = useState<Record<string, ComboMemberEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [printMode, setPrintMode] = useState<'programme' | 'compact'>('programme');

  useEffect(() => { void loadWeekData(); }, [athlete.id, weekStart]);

  const loadWeekData = async () => {
    try {
      setLoading(true);
      const plan = await fetchWeekPlanForAthlete(athlete.id, weekStart);
      if (!plan) { setLoading(false); return; }
      setWeekPlan(plan);
      const [exercises, { comboMembers: membersMap }] = await Promise.all([
        fetchPlannedExercisesFlat(plan.id),
        fetchProgrammeData(plan.id),
      ]);
      const grouped: Record<number, (PlannedExercise & { exercise: Exercise })[]> = {};
      DAYS_OF_WEEK.forEach(d => { grouped[d.index] = []; });
      (exercises || []).forEach(item => {
        if (!grouped[item.day_index]) grouped[item.day_index] = [];
        grouped[item.day_index].push(item as PlannedExercise & { exercise: Exercise });
      });
      setPlannedExercises(grouped);
      setComboMembers(membersMap);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const WEEKDAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const getDayLabel = (dayIndex: number): string => {
    const labels = dayLabels || weekPlan?.day_labels;
    const base = (labels?.[dayIndex]) || DAYS_OF_WEEK.find(d => d.index === dayIndex)?.name || `Day ${dayIndex}`;
    const schedule = weekPlan?.day_schedule as Record<number, { weekday: number; time: string | null }> | null;
    const entry = schedule?.[dayIndex];
    if (!entry) return base;
    const wdName = WEEKDAY_NAMES_FULL[entry.weekday];
    const timeSuffix = entry.time ? ` ${entry.time}` : '';
    return `${base} (${wdName}${timeSuffix})`;
  };

  const activeDays = weekPlan?.active_days || [1, 2, 3, 4, 5, 6, 7];
  const visibleDays = activeDays.map(dayIndex => ({ index: dayIndex, name: getDayLabel(dayIndex) }));

  const calculateCategorySummaries = () => {
    const totals: Record<string, { sets: number; reps: number; totalLoad: number; avgLoad: number; loadCount: number }> = {};
    Object.values(plannedExercises).forEach(dayExs => {
      dayExs.forEach(ex => {
        if (ex.exercise.counts_towards_totals && ex.exercise.category && ex.exercise.category !== '— System') {
          if (!totals[ex.exercise.category]) totals[ex.exercise.category] = { sets: 0, reps: 0, totalLoad: 0, avgLoad: 0, loadCount: 0 };
          totals[ex.exercise.category].sets += ex.summary_total_sets || 0;
          totals[ex.exercise.category].reps += ex.summary_total_reps || 0;
          if (ex.unit === 'absolute_kg' && ex.summary_avg_load) {
            totals[ex.exercise.category].totalLoad += ex.summary_avg_load * (ex.summary_total_reps || 0);
            totals[ex.exercise.category].avgLoad += ex.summary_avg_load;
            totals[ex.exercise.category].loadCount += 1;
          }
        }
      });
    });
    Object.keys(totals).forEach(cat => {
      if (totals[cat].loadCount > 0) totals[cat].avgLoad = totals[cat].avgLoad / totals[cat].loadCount;
    });
    return totals;
  };

  const calculateWeeklyTotal = () => {
    let totalSets = 0; let totalReps = 0; let totalLoad = 0;
    Object.values(plannedExercises).forEach(dayExs => {
      dayExs.forEach(ex => {
        if (ex.exercise.counts_towards_totals) {
          totalSets += ex.summary_total_sets || 0;
          totalReps += ex.summary_total_reps || 0;
          if (ex.unit === 'absolute_kg' && ex.summary_avg_load) totalLoad += ex.summary_avg_load * (ex.summary_total_reps || 0);
        }
      });
    });
    return { totalSets, totalReps, totalLoad };
  };

  const categorySummaries = calculateCategorySummaries();
  const weeklyTotal = calculateWeeklyTotal();

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <p className="text-gray-600">Loading week plan...</p>
        </div>
      </div>
    );
  }

  if (!weekPlan) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md">
          <h2 className="text-xl font-bold text-gray-900 mb-4">No Week Plan</h2>
          <p className="text-gray-600 mb-6">No training plan found for this week.</p>
          <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Close</button>
        </div>
      </div>
    );
  }

  const age = calculateAge(athlete.birthdate);

  return (
    <div className="fixed inset-0 bg-white z-50 overflow-auto">
      <div className="print:hidden bg-gray-100 border-b border-gray-300 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-gray-900">Print Preview</h2>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden bg-white">
            <button
              onClick={() => setPrintMode('programme')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${printMode === 'programme' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <FileText size={14} />
              Programme
            </button>
            <button
              onClick={() => setPrintMode('compact')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border-l border-gray-300 transition-colors ${printMode === 'compact' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <LayoutGrid size={14} />
              Compact
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Printer size={18} />
            Print
          </button>
          <button onClick={onClose} className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg">
            <X size={20} />
          </button>
        </div>
      </div>

      {printMode === 'compact' ? (
        <PrintWeekCompact
          athlete={athlete}
          weekPlan={weekPlan}
          plannedExercises={plannedExercises}
          comboMembers={comboMembers}
          weekStart={weekStart}
          weekDescription={weekDescription}
          dayLabels={dayLabels}
        />
      ) : (<>
      <style>{`@media print { @page { margin: 1.5cm; } }`}</style>
      <div className="print-content max-w-[210mm] mx-auto bg-white p-8 print:p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-300">
          <div>
            {activeCoach?.name && <p className="text-xs text-gray-500 mb-0.5">{activeCoach.name}{activeCoach.club_name ? ` · ${activeCoach.club_name}` : ''}</p>}
            <h1 className="text-2xl font-bold text-gray-900 mb-1">{athlete.name}</h1>
            <p className="text-sm text-gray-600">
              {age !== null && `${age} years old`}
              {athlete.bodyweight && ` • ${athlete.bodyweight}kg`}
              {athlete.weight_class && ` • ${athlete.weight_class}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-gray-900">{formatDateRange(weekStart)}</p>
            <p className="text-xs text-gray-500 mt-1">Generated {formatDateToDDMMYYYY(new Date().toISOString())}</p>
          </div>
        </div>

        {/* Weekly totals */}
        {weeklyTotal.totalSets > 0 && (
          <div className="mb-6 pb-4 border-b-2 border-gray-300">
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-3">Total Weekly Summary</h2>
            <div className="flex items-center gap-6 bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
              <div>
                <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Total Sets</p>
                <p className="text-2xl font-bold text-blue-900">{weeklyTotal.totalSets}</p>
              </div>
              <div>
                <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Total Reps</p>
                <p className="text-2xl font-bold text-blue-900">{weeklyTotal.totalReps}</p>
              </div>
              {weeklyTotal.totalLoad > 0 && (
                <div>
                  <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Total Load</p>
                  <p className="text-2xl font-bold text-blue-900">{Math.round(weeklyTotal.totalLoad)} kg</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Category summaries */}
        {showCategorySummaries && Object.keys(categorySummaries).length > 0 && (
          <div className="mb-6 pb-4 border-b border-gray-300">
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-3">Week Summary by Category</h2>
            <div className="grid grid-cols-6 gap-2">
              {Object.entries(categorySummaries).sort(([a], [b]) => a.localeCompare(b)).map(([cat, t]) => (
                <div key={cat} className="bg-gray-50 rounded p-2 border border-gray-200">
                  <div className="text-xs font-semibold text-gray-700 mb-1">{cat}</div>
                  <div className="text-xs text-gray-900 space-y-0.5">
                    <div><span className="font-bold">{t.sets}</span> sets</div>
                    <div><span className="font-bold">{t.reps}</span> reps</div>
                    {t.totalLoad > 0 && (
                      <>
                        <div><span className="font-bold">{Math.round(t.totalLoad)}</span> kg</div>
                        <div className="text-gray-600">avg {Math.round(t.avgLoad)}kg</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Week notes */}
        {weekDescription?.trim() && (
          <div className="mb-6 pb-4 border-b border-gray-300">
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">Week Notes</h2>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{weekDescription}</p>
            </div>
          </div>
        )}

        {/* Days */}
        {visibleDays.map(day => {
          const dayExs = (plannedExercises[day.index] || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
          if (dayExs.length === 0) return null;

          const daySets = dayExs.filter(ex => ex.exercise.counts_towards_totals).reduce((s, ex) => s + (ex.summary_total_sets || 0), 0);
          const dayReps = dayExs.filter(ex => ex.exercise.counts_towards_totals).reduce((s, ex) => s + (ex.summary_total_reps || 0), 0);

          return (
            <div key={day.index} className="mb-6 break-inside-avoid">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-300">
                <h2 className="text-lg font-bold text-gray-900 uppercase">{day.name}</h2>
                {(daySets > 0 || dayReps > 0) && (
                  <div className="text-xs text-gray-600">
                    {daySets > 0 && `${daySets} sets`}
                    {daySets > 0 && dayReps > 0 && ' • '}
                    {dayReps > 0 && `${dayReps} reps`}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {dayExs.map(ex => {
                  const sentinel = getSentinelType(ex.exercise.exercise_code);
                  const unitSymbol = getUnitSymbol(ex.unit);
                  const hasSummary = ex.summary_total_sets !== null && ex.summary_total_sets > 0;
                  const members = ex.is_combo ? (comboMembers[ex.id] ?? []).sort((a, b) => a.position - b.position) : null;
                  const borderColor = sentinel
                    ? (sentinel === 'text' ? 'transparent' : '#d1d5db')
                    : ex.is_combo ? (ex.combo_color || members?.[0]?.exercise.color || '#94a3b8') : ex.exercise.color;

                  // Sentinel rendering
                  if (sentinel === 'text') {
                    if (!ex.notes?.trim()) return null;
                    return (
                      <div key={ex.id} className="break-inside-avoid bg-amber-50 border border-amber-200 rounded px-3 py-2">
                        <p className="text-sm text-gray-700 italic whitespace-pre-wrap">{ex.notes}</p>
                      </div>
                    );
                  }
                  if (sentinel === 'image') {
                    if (!ex.notes?.trim()) return null;
                    return (
                      <div key={ex.id} className="break-inside-avoid">
                        <img src={ex.notes} alt="" className="max-w-full rounded border border-gray-200" style={{ maxHeight: '200px', objectFit: 'contain' }} onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
                      </div>
                    );
                  }
                  if (sentinel === 'video') {
                    const url = ex.notes?.trim();
                    if (!url) return null;
                    const videoId = getYouTubeVideoId(url);
                    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=80x80`;
                    return (
                      <div key={ex.id} className="break-inside-avoid flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded px-3 py-2">
                        <img src={qrUrl} alt="QR code" className="w-16 h-16 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-700 mb-0.5">Video</p>
                          {videoId && (
                            <img src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`} alt="" className="rounded w-24 h-14 object-cover mb-1" />
                          )}
                          <p className="text-[10px] text-gray-500 break-all">{url}</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={ex.id} className="break-inside-avoid">
                      <div className="flex items-start gap-2">
                        <div className="w-1 min-h-[40px] rounded" style={{ backgroundColor: borderColor }} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-bold text-gray-900">
                              {ex.is_combo
                                ? (ex.combo_notation || (members?.map(m => m.exercise.name).join(' + ') ?? ex.exercise.name))
                                : ex.exercise.name}
                            </h3>
                            {ex.variation_note && (
                              <span className="text-xs text-gray-500 italic">{ex.variation_note}</span>
                            )}
                            {ex.is_combo && (
                              <span className="text-[9px] bg-blue-50 text-blue-600 font-medium px-1.5 py-0.5 rounded">Combo</span>
                            )}
                            {unitSymbol && <span className="text-[10px] font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{unitSymbol}</span>}
                          </div>
                          {ex.is_combo && members && members.length > 0 && (
                            <p className="text-xs text-gray-500 mb-1">
                              {members.map((m, i) => <span key={m.position}>{i > 0 && ' + '}{m.exercise.name}</span>)}
                            </p>
                          )}
                          {ex.prescription_raw && (
                            <div className="mb-1">
                              <InlinePrescription prescription={ex.prescription_raw} unit={ex.unit} isCombo={ex.is_combo} />
                            </div>
                          )}
                          {hasSummary && (
                            <p className="text-xs text-gray-500">
                              S {ex.summary_total_sets} | R {ex.summary_total_reps}
                              {ex.summary_highest_load != null && <> | Hi {ex.summary_highest_load.toFixed(0)} | Avg {ex.summary_avg_load?.toFixed(0)}</>}
                            </p>
                          )}
                          {ex.notes && <p className="text-xs text-gray-600 italic mt-1">{ex.notes}</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print-content { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
          .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </>)}
    </div>
  );
}
