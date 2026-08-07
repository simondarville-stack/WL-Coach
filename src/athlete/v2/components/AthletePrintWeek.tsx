/**
 * AthletePrintWeek — print overlay for the athlete app.
 *
 * Thin wrapper around the coach PrintWeek (athlete variant: Programme
 * layout + compact options row). It resolves the coach header line from
 * the plan owner's profile because the coach store is empty in an
 * athlete's browser. PrintWeek is imported lazily — a no-op while the
 * app builds as one chunk (PlannerModals imports it statically), but it
 * keeps the athlete bundle lean if the app is ever code-split.
 *
 * The caller passes a pre-resolved weekPlanId so the individual-plan →
 * group-plan fallback used by /athlete/week is honoured.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchCoachHeaderProfile } from '../../../lib/trainingLogService';
import type { Athlete, TrainingGroup, CoachProfile } from '../../../lib/database.types';

const PrintWeek = lazy(() =>
  import('../../../components/planner/PrintWeek').then(m => ({ default: m.PrintWeek })),
);

interface AthletePrintWeekProps {
  athlete?: Athlete | null;
  group?: TrainingGroup | null;
  weekPlanId: string;
  weekStart: string;
  onClose: () => void;
}

export function AthletePrintWeek({ athlete = null, group = null, weekPlanId, weekStart, onClose }: AthletePrintWeekProps) {
  const [coach, setCoach] = useState<Pick<CoachProfile, 'name' | 'club_name'> | null>(null);
  const ownerId = athlete?.owner_id ?? group?.owner_id ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!ownerId) return;
    fetchCoachHeaderProfile(ownerId)
      .then(c => { if (!cancelled) setCoach(c); })
      .catch(() => { /* header line is optional — print without it */ });
    return () => { cancelled = true; };
  }, [ownerId]);

  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-white" />
        </div>
      }
    >
      <PrintWeek
        variant="athlete"
        athlete={athlete}
        group={group}
        weekPlanId={weekPlanId}
        weekStart={weekStart}
        coach={coach}
        onClose={onClose}
      />
    </Suspense>
  );
}
