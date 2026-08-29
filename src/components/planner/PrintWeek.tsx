/**
 * PrintWeek — print host for a single training week.
 *
 * Loads the week's data and renders the print DESIGNER. The fixed
 * "programme" layout was retired (0.45.0) in favour of the option-driven
 * designer, which both the coach planner and the athlete app now share.
 * The athlete variant defaults to honouring the coach's eye
 * (athlete-visibility) settings; the coach can toggle the same option to
 * proof what the athlete printout will reveal.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer } from 'lucide-react';
import type { WeekPlan, PlannedExercise, Exercise, Athlete, ComboMemberEntry, TrainingGroup, CoachProfile } from '../../lib/database.types';
import { DAYS_OF_WEEK } from '../../lib/constants';
import { useWeekPlans } from '../../hooks/useWeekPlans';
import { useCombos } from '../../hooks/useCombos';
import { PrintWeekDesigner } from './PrintWeekDesigner';
import { Button } from '../ui';

interface PrintWeekProps {
  /** Either an athlete OR a group must be provided. When `group` is set
   *  the printout uses the group plan as its data source and the header
   *  shows the group name. */
  athlete?: Athlete | null;
  group?: TrainingGroup | null;
  weekStart: string;
  onClose: () => void;
  /** Retired with the fixed programme layout — the designer has its own
   *  category-summary toggle. Accepted for caller compatibility. */
  showCategorySummaries?: boolean;
  dayLabels?: Record<number, string> | null;
  /** When omitted (athlete app), falls back to weekPlan.week_description. */
  weekDescription?: string | null;
  /** 'athlete' defaults the designer to the athlete view (eye settings
   *  honoured); 'coach' starts with everything visible. */
  variant?: 'coach' | 'athlete';
  /** Pre-resolved plan id. The athlete app passes it so the group-plan
   *  fallback of /athlete/week (resolveAthleteWeekPlanId) is honoured;
   *  athlete/group are then only used for the printout header. */
  weekPlanId?: string | null;
  /** Coach header line for browsers where the coach store is empty
   *  (athlete app). Falls back to useCoachStore().activeCoach. */
  coach?: Pick<CoachProfile, 'name' | 'club_name'> | null;
}

export function PrintWeek({
  athlete = null,
  group = null,
  weekStart,
  onClose,
  dayLabels = null,
  weekDescription,
  variant = 'coach',
  weekPlanId = null,
  coach = null,
}: PrintWeekProps) {
  const { fetchWeekPlanForAthlete, fetchWeekPlanForGroup, fetchWeekPlanById, fetchPlannedExercisesFlat } = useWeekPlans();
  const { fetchProgrammeData } = useCombos();

  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<Record<number, (PlannedExercise & { exercise: Exercise })[]>>({});
  const [comboMembers, setComboMembers] = useState<Record<string, ComboMemberEntry[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { void loadWeekData(); }, [athlete?.id, group?.id, weekStart, weekPlanId]);

  const loadWeekData = async () => {
    try {
      setLoading(true);
      const plan = weekPlanId
        ? await fetchWeekPlanById(weekPlanId)
        : athlete
        ? await fetchWeekPlanForAthlete(athlete.id, weekStart)
        : group
        ? await fetchWeekPlanForGroup(group.id, weekStart)
        : null;
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

  // The planner injects its (possibly unsaved) week description; the athlete
  // app omits the prop and reads the saved one off the plan.
  const effectiveWeekDescription = weekDescription !== undefined ? weekDescription : (weekPlan?.week_description ?? null);

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
          <button onClick={onClose} className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg hover:bg-[var(--color-accent-hover)]">Close</button>
        </div>
      </div>
    );
  }

  return createPortal((
    <div id="print-programme-root" className="fixed inset-0 bg-white z-50 overflow-auto">
      <div className="print:hidden bg-gray-100 border-b border-gray-300 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <h2 className="text-base font-bold text-gray-900">Print week</h2>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => window.print()} icon={<Printer size={16} />}>
            Print
          </Button>
          <button onClick={onClose} className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg" aria-label="Close">
            <X size={20} />
          </button>
        </div>
      </div>

      <PrintWeekDesigner
        athlete={athlete}
        group={group}
        weekPlan={weekPlan}
        plannedExercises={plannedExercises}
        comboMembers={comboMembers}
        weekStart={weekStart}
        weekDescription={effectiveWeekDescription}
        dayLabels={dayLabels}
        variant={variant}
        coach={coach}
      />
    </div>
  ), document.body);
}
