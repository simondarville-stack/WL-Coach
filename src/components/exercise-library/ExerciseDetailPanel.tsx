import { useState, useEffect } from 'react';
import { X, ExternalLink, Edit2, Archive, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { estimateWeightAtReps, roundToHalf } from '../../lib/xrmUtils';
import type { Exercise, Athlete } from '../../lib/database.types';
import type { Category } from '../../hooks/useExercises';

// ── Types ──────────────────────────────────────────────────────────

interface AthletePRRow {
  id: string;
  athlete_id: string;
  exercise_id: string;
  pr_value_kg: number | null;
  pr_date: string | null;
  athleteName: string;
  athleteInitials: string;
}

interface UsageWeek {
  weekStart: string;
  dayIndex: number;
}

interface ExerciseDetailPanelProps {
  exercise: Exercise;
  category: Category | null;
  athlete: Athlete | null;
  allAthletes: Athlete[];
  onClose: () => void;
  onEdit: (exercise: Exercise) => void;
  onArchive: (exerciseId: string) => void;
  onSelectExercise: (exerciseId: string) => void;
  relatedExercises: Exercise[];
  allExercises: Exercise[];
}

// ── Helpers ────────────────────────────────────────────────────────

const UNIT_DISPLAY: Record<string, string> = {
  absolute_kg: 'kg',
  percentage: '%',
  rpe: 'RPE',
  free_text: 'Free text',
  free_text_reps: 'Reps',
  other: 'Other',
};

function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── xRM Table Modal ────────────────────────────────────────────────

function XrmTableModal({ oneRM, exerciseName, onClose }: {
  oneRM: number;
  exerciseName: string;
  onClose: () => void;
}) {
  const rows = Array.from({ length: 10 }, (_, i) => {
    const reps = i + 1;
    const weight = reps === 1 ? oneRM : roundToHalf(estimateWeightAtReps(oneRM, reps));
    const pct = Math.round((weight / oneRM) * 100);
    return { reps, weight, pct };
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-72 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <div className="text-sm font-semibold text-gray-900">xRM Table</div>
            <div className="text-[10px] text-gray-500">{exerciseName} · 1RM = {oneRM} kg</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
            <X size={15} />
          </button>
        </div>
        <div className="px-4 py-2">
          {rows.map(({ reps, weight, pct }) => (
            <div key={reps} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
              <div className="w-8 text-[11px] font-medium text-gray-500">{reps}RM</div>
              <div className="flex-1">
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: reps === 1 ? '#3B82F6' : '#93c5fd' }}
                />
              </div>
              <div className="text-[11px] font-semibold text-gray-900 w-16 text-right tabular-nums">
                {weight} kg
              </div>
              <div className="text-[9px] text-gray-400 w-8 text-right">{pct}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Usage History Chart ────────────────────────────────────────────

function UsageHistoryChart({ weeks }: { weeks: UsageWeek[] }) {
  if (weeks.length === 0) {
    return (
      <div className="text-[10px] text-gray-400 italic py-2">No usage history found.</div>
    );
  }

  // Group by week, show last 24 weeks
  const sorted = [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const uniqueWeeks = [...new Set(sorted.map(w => w.weekStart))].slice(-24);

  // Count sessions per week
  const countMap = new Map<string, number>();
  for (const w of weeks) {
    countMap.set(w.weekStart, (countMap.get(w.weekStart) ?? 0) + 1);
  }

  const maxCount = Math.max(...uniqueWeeks.map(ws => countMap.get(ws) ?? 0), 1);

  return (
    <div>
      <div className="flex items-end gap-px h-10 mt-1">
        {uniqueWeeks.map(ws => {
          const count = countMap.get(ws) ?? 0;
          const h = (count / maxCount) * 100;
          return (
            <div
              key={ws}
              className="flex-1 rounded-t-sm min-w-0 transition-all group relative"
              style={{
                height: `${Math.max(h, 8)}%`,
                backgroundColor: '#3B82F6cc',
              }}
              title={`${formatWeekLabel(ws)}: ${count} session${count !== 1 ? 's' : ''}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[8px] text-gray-400">{formatWeekLabel(uniqueWeeks[0])}</span>
        <span className="text-[8px] text-gray-400">{formatWeekLabel(uniqueWeeks[uniqueWeeks.length - 1])}</span>
      </div>
      <div className="text-[9px] text-gray-400 mt-0.5">
        {uniqueWeeks.length} weeks · {weeks.length} total sessions
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────

export function ExerciseDetailPanel({
  exercise,
  category,
  athlete,
  allAthletes,
  onClose,
  onEdit,
  onArchive,
  onSelectExercise,
  relatedExercises,
  allExercises,
}: ExerciseDetailPanelProps) {
  const [athletePRs, setAthletePRs] = useState<AthletePRRow[]>([]);
  const [usageWeeks, setUsageWeeks] = useState<UsageWeek[]>([]);
  const [athleteCount, setAthleteCount] = useState<number>(0);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(exercise.notes ?? '');
  const [loadingData, setLoadingData] = useState(true);
  const [showXrmModal, setShowXrmModal] = useState(false);

  const prRefExercise = exercise.pr_reference_exercise_id
    ? allExercises.find(e => e.id === exercise.pr_reference_exercise_id)
    : null;

  useEffect(() => {
    setNotesValue(exercise.notes ?? '');
    setShowXrmModal(false);
    loadData();
  }, [exercise.id, athlete?.id]);

  async function loadData() {
    setLoadingData(true);
    try {
      await Promise.all([loadPRs(), loadUsage()]);
    } finally {
      setLoadingData(false);
    }
  }

  async function loadPRs() {
    if (athlete) {
      const { data } = await supabase
        .from('athlete_prs')
        .select('*')
        .eq('athlete_id', athlete.id)
        .eq('exercise_id', exercise.id)
        .limit(1);
      setAthletePRs((data || []).map(r => ({
        ...r,
        athleteName: athlete.name,
        athleteInitials: initials(athlete.name),
      })));
    } else {
      const { data } = await supabase
        .from('athlete_prs')
        .select('*')
        .eq('exercise_id', exercise.id)
        .eq('owner_id', getOwnerId())
        .order('pr_value_kg', { ascending: false });
      const athleteMap = new Map(allAthletes.map(a => [a.id, a]));
      const rows: AthletePRRow[] = (data || [])
        .filter((r: any) => r.pr_value_kg !== null)
        .map((r: any) => {
          const a = athleteMap.get(r.athlete_id);
          return {
            ...r,
            athleteName: a?.name ?? 'Unknown',
            athleteInitials: a ? initials(a.name) : '?',
          };
        })
        .sort((a: AthletePRRow, b: AthletePRRow) => (b.pr_value_kg ?? 0) - (a.pr_value_kg ?? 0));
      setAthletePRs(rows);

      const uniqueAthletes = new Set(rows.map(r => r.athlete_id));
      setAthleteCount(uniqueAthletes.size);
    }
  }

  async function loadUsage() {
    // day_index lives on planned_exercises, week_start/athlete_id on week_plans
    const { data } = await supabase
      .from('planned_exercises')
      .select('day_index, week_plans(week_start, athlete_id)')
      .eq('exercise_id', exercise.id);

    const weeks: UsageWeek[] = [];
    for (const r of (data || []) as any[]) {
      const wp = r.week_plans;
      if (!wp) continue;
      if (athlete && wp.athlete_id !== athlete.id) continue;
      weeks.push({ weekStart: wp.week_start, dayIndex: r.day_index ?? 0 });
    }
    setUsageWeeks(weeks);
  }

  async function saveNotes() {
    setEditingNotes(false);
    if (notesValue === (exercise.notes ?? '')) return;
    await supabase.from('exercises').update({ notes: notesValue || null }).eq('id', exercise.id);
  }

  const currentPR = athlete ? athletePRs[0] : null;
  const maxPR = Math.max(...athletePRs.map(r => r.pr_value_kg ?? 0), 1);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-gray-200 flex-shrink-0">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: exercise.color }} />
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-gray-900 truncate">{exercise.name}</div>
          <div className="text-[11px] text-gray-500">
            {exercise.exercise_code && <span className="font-mono">{exercise.exercise_code} · </span>}
            {exercise.category as unknown as string}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">

        {/* Structured exercise properties */}
        {(() => {
          const catName = exercise.category as unknown as string;
          const unitLabel = UNIT_DISPLAY[exercise.default_unit as string] ?? exercise.default_unit ?? 'kg';
          const rows: { label: string; value: string; mono?: boolean; valueColor?: string }[] = [
            { label: 'Category', value: category?.name ?? catName ?? '—' },
            { label: 'Default unit', value: unitLabel },
            { label: 'Track PR', value: exercise.track_pr ? 'Yes' : 'No', valueColor: exercise.track_pr ? 'text-blue-600' : 'text-gray-400' },
            { label: 'Counts towards totals', value: exercise.counts_towards_totals ? 'Yes' : 'No', valueColor: exercise.counts_towards_totals ? 'text-green-600' : 'text-gray-400' },
            { label: 'Competition lift', value: exercise.is_competition_lift ? 'Yes' : 'No', valueColor: exercise.is_competition_lift ? 'text-red-600' : 'text-gray-400' },
            ...(exercise.exercise_code ? [{ label: 'Code', value: exercise.exercise_code, mono: true }] : []),
            ...(prRefExercise ? [{ label: '% derived from', value: prRefExercise.name }] : []),
          ];
          return (
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              {rows.map(({ label, value, mono, valueColor }, i) => (
                <div key={label} className={`flex items-center px-3 py-2 ${i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                  <span className="w-[148px] flex-shrink-0 text-[11px] text-gray-400">{label}</span>
                  <span className={`text-[11px] font-medium truncate ${valueColor ?? 'text-gray-800'} ${mono ? 'font-mono' : ''}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── Athlete view ───────────────────────────────────────── */}
        {athlete ? (
          <>
            {/* Current PR — clickable to open xRM table */}
            <div>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Personal Record</div>
              <button
                onClick={() => currentPR?.pr_value_kg != null && setShowXrmModal(true)}
                disabled={currentPR?.pr_value_kg == null}
                className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
                  currentPR?.pr_value_kg != null
                    ? 'border-blue-200 bg-blue-50 hover:bg-blue-100 cursor-pointer'
                    : 'border-gray-100 bg-gray-50 cursor-default'
                }`}
              >
                <div className="flex items-end justify-between">
                  <div>
                    <div className={`text-3xl font-bold tabular-nums ${currentPR?.pr_value_kg != null ? 'text-blue-700' : 'text-gray-400'}`}>
                      {currentPR?.pr_value_kg != null ? `${currentPR.pr_value_kg}` : '—'}
                      {currentPR?.pr_value_kg != null && <span className="text-base font-medium ml-1 text-blue-500">kg</span>}
                    </div>
                    {currentPR?.pr_date && (
                      <div className="text-[10px] text-blue-400 mt-0.5">{formatDate(currentPR.pr_date)}</div>
                    )}
                  </div>
                  {currentPR?.pr_value_kg != null && (
                    <div className="flex items-center gap-1 text-[10px] text-blue-400">
                      <span>xRM table</span>
                      <ChevronRight size={12} />
                    </div>
                  )}
                </div>
              </button>
            </div>

            {/* Usage history chart */}
            <div>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Usage history</div>
              {loadingData ? (
                <div className="text-[10px] text-gray-400">Loading…</div>
              ) : (
                <UsageHistoryChart weeks={usageWeeks} />
              )}
            </div>
          </>
        ) : (
          /* ── Coach view ──────────────────────────────────────── */
          <>
            {/* Roster stats */}
            <div className="bg-gray-50 rounded-xl p-3.5">
              <div className="text-[9px] text-gray-400 mb-1">Athletes using</div>
              <div className="text-2xl font-bold text-gray-900">
                {loadingData ? '—' : `${athleteCount} / ${allAthletes.filter(a => a.is_active).length}`}
              </div>
            </div>

            {/* Roster PR table */}
            {athletePRs.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Roster PRs</div>
                <div className="flex flex-col gap-1.5">
                  {athletePRs.map(row => (
                    <div key={row.id} className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-600 flex-shrink-0">
                        {row.athleteInitials}
                      </div>
                      <span className="flex-1 text-[11px] text-gray-700 truncate">{row.athleteName}</span>
                      <span className="font-mono text-sm font-semibold text-gray-900">
                        {row.pr_value_kg} kg
                      </span>
                      <span className="text-[9px] text-gray-400 w-16 text-right">{formatDate(row.pr_date)}</span>
                    </div>
                  ))}
                </div>
                {/* Bar chart */}
                <div className="mt-3 flex items-end gap-0.5 h-8">
                  {athletePRs.slice(0, 14).map(row => {
                    const pct = maxPR > 0 ? ((row.pr_value_kg ?? 0) / maxPR) * 100 : 0;
                    return (
                      <div key={row.id} className="flex-1 rounded-t-sm"
                        title={`${row.athleteName}: ${row.pr_value_kg} kg`}
                        style={{ height: `${Math.max(pct, 4)}%`, backgroundColor: (category?.color ?? '#888') + '99' }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Roster usage chart */}
            {usageWeeks.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Usage history (all athletes)</div>
                <UsageHistoryChart weeks={usageWeeks} />
              </div>
            )}
          </>
        )}

        {/* Related exercises */}
        {relatedExercises.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Related ({exercise.category as unknown as string})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {relatedExercises.map(rex => (
                <button key={rex.id}
                  onClick={() => onSelectExercise(rex.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 border border-gray-200 rounded-full text-[10px] text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: rex.color }} />
                  {rex.exercise_code || rex.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Notes</span>
            {!editingNotes && (
              <button onClick={() => setEditingNotes(true)} className="text-gray-400 hover:text-gray-600 p-px">
                <Edit2 size={10} />
              </button>
            )}
          </div>
          {editingNotes ? (
            <textarea
              autoFocus
              className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              rows={3}
              value={notesValue}
              onChange={e => setNotesValue(e.target.value)}
              onBlur={saveNotes}
            />
          ) : (
            <p className="text-sm text-gray-500 cursor-text min-h-[28px] leading-relaxed"
              onClick={() => setEditingNotes(true)}>
              {notesValue || <span className="italic text-gray-300 text-[11px]">Click to add notes…</span>}
            </p>
          )}
        </div>

        {/* External link */}
        {exercise.link && (
          <div>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Reference</div>
            <a href={exercise.link} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-600 truncate">
              <ExternalLink size={12} />
              {exercise.link}
            </a>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex gap-2 px-4 py-3 border-t border-gray-200 flex-shrink-0">
        <button onClick={() => onEdit(exercise)}
          className="flex-1 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">
          Edit
        </button>
        <button onClick={() => onArchive(exercise.id)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
          <Archive size={13} />
          Archive
        </button>
      </div>

      {/* xRM Modal */}
      {showXrmModal && currentPR?.pr_value_kg != null && (
        <XrmTableModal
          oneRM={currentPR.pr_value_kg}
          exerciseName={exercise.name}
          onClose={() => setShowXrmModal(false)}
        />
      )}
    </div>
  );
}
