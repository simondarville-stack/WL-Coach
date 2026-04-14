import { useState, useEffect } from 'react';
import { X, ExternalLink, Edit2, Archive } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
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

interface PlanUsageRow {
  weekStart: string;
  macroName: string | null;
  athleteName: string | null;
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

function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
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
  const [planUsage, setPlanUsage] = useState<PlanUsageRow[]>([]);
  const [usageCount, setUsageCount] = useState<number>(0);
  const [athleteCount, setAthleteCount] = useState<number>(0);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(exercise.notes ?? '');
  const [loadingData, setLoadingData] = useState(true);

  // Derive PR reference exercise name
  const prRefExercise = exercise.pr_reference_exercise_id
    ? allExercises.find(e => e.id === exercise.pr_reference_exercise_id)
    : null;

  // Load panel data when exercise or athlete changes
  useEffect(() => {
    setNotesValue(exercise.notes ?? '');
    loadData();
  }, [exercise.id, athlete?.id]);

  async function loadData() {
    setLoadingData(true);
    try {
      await Promise.all([loadPRs(), loadPlanUsage(), loadUsageCount()]);
    } finally {
      setLoadingData(false);
    }
  }

  async function loadPRs() {
    if (athlete) {
      // Athlete view: single PR
      const { data } = await supabase
        .from('athlete_prs')
        .select('*')
        .eq('athlete_id', athlete.id)
        .eq('exercise_id', exercise.id)
        .limit(1);
      const rows: AthletePRRow[] = (data || []).map(r => ({
        ...r,
        athleteName: athlete.name,
        athleteInitials: initials(athlete.name),
      }));
      setAthletePRs(rows);
    } else {
      // Coach view: all athletes
      const { data } = await supabase
        .from('athlete_prs')
        .select('*')
        .eq('exercise_id', exercise.id)
        .eq('owner_id', getOwnerId())
        .order('pr_value_kg', { ascending: false });
      const athleteMap = new Map(allAthletes.map(a => [a.id, a]));
      const rows: AthletePRRow[] = (data || [])
        .filter(r => r.pr_value_kg !== null)
        .map(r => {
          const a = athleteMap.get(r.athlete_id);
          return {
            ...r,
            athleteName: a?.name ?? 'Unknown',
            athleteInitials: a ? initials(a.name) : '?',
          };
        })
        .sort((a, b) => (b.pr_value_kg ?? 0) - (a.pr_value_kg ?? 0));
      setAthletePRs(rows);
    }
  }

  async function loadPlanUsage() {
    let q = supabase
      .from('planned_exercises')
      .select('weekplan_id, week_plans(week_start, athlete_id, group_id, macrocycles(name))')
      .eq('exercise_id', exercise.id)
      .order('weekplan_id');

    const { data } = await q;
    const seen = new Set<string>();
    const rows: PlanUsageRow[] = [];
    for (const r of (data || []) as any[]) {
      const wp = r.week_plans;
      if (!wp) continue;
      if (athlete && wp.athlete_id !== athlete.id) continue;
      if (seen.has(r.weekplan_id)) continue;
      seen.add(r.weekplan_id);
      const macro = Array.isArray(wp.macrocycles) ? wp.macrocycles[0] : wp.macrocycles;
      rows.push({
        weekStart: wp.week_start,
        macroName: macro?.name ?? null,
        athleteName: null,
      });
    }
    rows.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    setPlanUsage(rows.slice(0, 10));
  }

  async function loadUsageCount() {
    // Count distinct weekplans and athletes
    const { data: wpData } = await supabase
      .from('planned_exercises')
      .select('weekplan_id, week_plans(athlete_id)')
      .eq('exercise_id', exercise.id);

    const uniquePlans = new Set((wpData || []).map((r: any) => r.weekplan_id));
    const uniqueAthletes = new Set(
      (wpData || [])
        .map((r: any) => (r.week_plans as any)?.athlete_id)
        .filter(Boolean)
    );
    setUsageCount(uniquePlans.size);
    setAthleteCount(uniqueAthletes.size);
  }

  async function saveNotes() {
    setEditingNotes(false);
    if (notesValue === (exercise.notes ?? '')) return;
    await supabase.from('exercises').update({ notes: notesValue || null }).eq('id', exercise.id);
  }

  const maxPR = Math.max(...athletePRs.map(r => r.pr_value_kg ?? 0), 1);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: exercise.color }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{exercise.name}</div>
          <div className="text-[10px] text-gray-500">
            {exercise.exercise_code && <span className="font-mono">{exercise.exercise_code} · </span>}
            {exercise.category}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {exercise.is_competition_lift && (
            <span className="px-2 py-0.5 text-[9px] font-medium bg-red-50 text-red-600 border border-red-200 rounded-full">
              Competition lift
            </span>
          )}
          {exercise.track_pr && (
            <span className="px-2 py-0.5 text-[9px] font-medium bg-blue-50 text-blue-600 border border-blue-200 rounded-full">
              PR tracked
            </span>
          )}
          {exercise.counts_towards_totals && (
            <span className="px-2 py-0.5 text-[9px] font-medium bg-green-50 text-green-600 border border-green-200 rounded-full">
              Counts totals
            </span>
          )}
          {exercise.default_unit && exercise.default_unit !== 'kg' && (
            <span className="px-2 py-0.5 text-[9px] font-medium bg-gray-100 text-gray-600 rounded-full">
              {exercise.default_unit}
            </span>
          )}
          {exercise.use_stacked_notation && (
            <span className="px-2 py-0.5 text-[9px] font-medium bg-purple-50 text-purple-600 border border-purple-200 rounded-full">
              Stacked
            </span>
          )}
          {category && (
            <span
              className="px-2 py-0.5 text-[9px] font-medium rounded-full border"
              style={{ color: category.color, borderColor: category.color + '55', backgroundColor: category.color + '15' }}
            >
              {category.name}
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          {athlete ? (
            <>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-[9px] text-gray-400 mb-0.5">Current PR</div>
                <div className="text-base font-bold text-gray-900">
                  {athletePRs[0]?.pr_value_kg != null
                    ? `${athletePRs[0].pr_value_kg} kg`
                    : '—'}
                </div>
                {athletePRs[0]?.pr_date && (
                  <div className="text-[9px] text-gray-400">{formatDate(athletePRs[0].pr_date)}</div>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-[9px] text-gray-400 mb-0.5">Used in plans</div>
                <div className="text-base font-bold text-gray-900">{usageCount}</div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-[9px] text-gray-400 mb-0.5">Athletes using</div>
                <div className="text-base font-bold text-gray-900">
                  {loadingData ? '—' : `${athleteCount} / ${allAthletes.filter(a => a.is_active).length}`}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-[9px] text-gray-400 mb-0.5">Total plans</div>
                <div className="text-base font-bold text-gray-900">
                  {loadingData ? '—' : usageCount}
                </div>
              </div>
            </>
          )}
        </div>

        {/* PR Reference */}
        {prRefExercise && (
          <div className="text-[10px] text-gray-500">
            Derives % from: <span className="font-medium text-gray-700">{prRefExercise.name}</span>
          </div>
        )}

        {/* PRs section */}
        {athlete ? (
          // Athlete view: single PR (minimal)
          athletePRs.length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-gray-500 mb-1.5">Personal Record</div>
              <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                <div className="w-6 h-6 rounded-full bg-blue-200 flex items-center justify-center text-[9px] font-bold text-blue-700">
                  {athletePRs[0].athleteInitials}
                </div>
                <span className="flex-1 text-[11px] text-gray-700">{athletePRs[0].athleteName}</span>
                <span className="font-mono font-bold text-sm text-gray-900">{athletePRs[0].pr_value_kg} kg</span>
                <span className="text-[9px] text-gray-400">{formatDate(athletePRs[0].pr_date)}</span>
              </div>
            </div>
          )
        ) : (
          // Coach view: roster-wide PR table + bar chart
          athletePRs.length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-gray-500 mb-1.5">Roster PRs</div>
              <div className="flex flex-col gap-1">
                {athletePRs.map(row => (
                  <div key={row.id} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[8px] font-bold text-gray-600 flex-shrink-0">
                      {row.athleteInitials}
                    </div>
                    <span className="flex-1 text-[10px] text-gray-700 truncate">{row.athleteName}</span>
                    <span className="font-mono text-[10px] font-semibold text-gray-900 w-14 text-right">
                      {row.pr_value_kg} kg
                    </span>
                    <span className="text-[9px] text-gray-400 w-16 text-right">{formatDate(row.pr_date)}</span>
                  </div>
                ))}
              </div>
              {/* Bar chart */}
              <div className="mt-2 flex items-end gap-0.5 h-8">
                {athletePRs.slice(0, 12).map(row => {
                  const pct = maxPR > 0 ? ((row.pr_value_kg ?? 0) / maxPR) * 100 : 0;
                  return (
                    <div
                      key={row.id}
                      className="flex-1 rounded-t-sm transition-all"
                      title={`${row.athleteName}: ${row.pr_value_kg} kg`}
                      style={{
                        height: `${Math.max(pct, 4)}%`,
                        backgroundColor: (category?.color ?? '#888') + '99',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* Plan usage */}
        {planUsage.length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-gray-500 mb-1.5">Used in plans</div>
            <div className="flex flex-col gap-0.5">
              {planUsage.map((row, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: category?.color ?? '#888' }}
                  />
                  <span className="text-[10px] text-gray-600 flex-1 truncate">
                    {row.macroName ?? 'No macro'} · {row.weekStart}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Related exercises */}
        {relatedExercises.length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-gray-500 mb-1.5">Related ({exercise.category})</div>
            <div className="flex flex-wrap gap-1">
              {relatedExercises.map(rex => (
                <button
                  key={rex.id}
                  onClick={() => onSelectExercise(rex.id)}
                  className="flex items-center gap-1 px-2 py-0.5 border border-gray-200 rounded-full text-[9px] text-gray-600 hover:bg-gray-50"
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
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-medium text-gray-500">Notes</span>
            {!editingNotes && (
              <button
                onClick={() => setEditingNotes(true)}
                className="text-gray-400 hover:text-gray-600 p-px"
              >
                <Edit2 size={10} />
              </button>
            )}
          </div>
          {editingNotes ? (
            <textarea
              autoFocus
              className="w-full text-[11px] text-gray-700 border border-gray-200 rounded-md p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              rows={3}
              value={notesValue}
              onChange={e => setNotesValue(e.target.value)}
              onBlur={saveNotes}
            />
          ) : (
            <p
              className="text-[11px] text-gray-500 cursor-text min-h-[28px]"
              onClick={() => setEditingNotes(true)}
            >
              {notesValue || <span className="italic text-gray-300">Click to add notes…</span>}
            </p>
          )}
        </div>

        {/* External link */}
        {exercise.link && (
          <div>
            <div className="text-[10px] font-medium text-gray-500 mb-1">Reference</div>
            <a
              href={exercise.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-blue-500 hover:text-blue-600 truncate"
            >
              <ExternalLink size={11} />
              {exercise.link}
            </a>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex gap-2 px-4 py-3 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={() => onEdit(exercise)}
          className="flex-1 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          Edit
        </button>
        <button
          onClick={() => onArchive(exercise.id)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-500 border border-red-200 rounded-lg hover:bg-red-50"
        >
          <Archive size={12} />
          Archive
        </button>
      </div>
    </div>
  );
}
