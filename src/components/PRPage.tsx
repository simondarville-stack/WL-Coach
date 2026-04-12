import { Trophy } from 'lucide-react';
import { useAthleteStore } from '../store/athleteStore';
import { PRTrackingPanel } from './planner/PRTrackingPanel';

export function PRPage() {
  const { selectedAthlete } = useAthleteStore();

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
    <div className="max-w-5xl mx-auto px-4 py-6">
      <PRTrackingPanel athlete={selectedAthlete} />
    </div>
  );
}
