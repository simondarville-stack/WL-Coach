import { Trophy } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAthleteStore } from '../store/athleteStore';
import { PRTrackingPanel } from './planner/PRTrackingPanel';

export function PRPage() {
  const { selectedAthlete } = useAthleteStore();
  // ?ex=<exercise_id>&rep=<n> deep-links from a dashboard PR activity and
  // highlights that cell in the table.
  const [searchParams] = useSearchParams();
  const highlightExerciseId = searchParams.get('ex');
  const repParam = searchParams.get('rep');
  const highlightRepCount = repParam != null && repParam !== '' ? Number(repParam) : null;

  if (!selectedAthlete) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Trophy size={40} className="text-gray-200" />
        <h2 className="text-base font-medium text-gray-500">Select an athlete</h2>
        <p className="text-sm text-gray-400">
          Choose an athlete from the top-right selector to view their PR records.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <PRTrackingPanel
        athlete={selectedAthlete}
        highlightExerciseId={highlightExerciseId}
        highlightRepCount={highlightRepCount}
      />
    </div>
  );
}
