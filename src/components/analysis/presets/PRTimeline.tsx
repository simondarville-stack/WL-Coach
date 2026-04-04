import { useState, useEffect } from 'react';
import { fetchPRTimeline } from '../../../hooks/useAnalysis';

interface Props { athleteId: string; startDate: string; endDate: string; }

export function PRTimeline({ athleteId, startDate, endDate }: Props) {
  const [prs, setPrs] = useState<Array<{ date: string; exerciseName: string; load: number; isCompetition: boolean }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPRTimeline(athleteId, startDate, endDate)
      .then(setPrs)
      .finally(() => setLoading(false));
  }, [athleteId, startDate, endDate]);

  if (loading) return <div className="h-32 flex items-center justify-center"><div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-5 h-5" /></div>;
  if (!prs.length) return (
    <div className="h-32 flex items-center justify-center text-gray-400 text-sm">
      No personal records found. PRs are tracked from training log entries.
    </div>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">PR timeline</h3>
      <div className="relative">
        <div className="absolute left-0 right-0 top-4 h-0.5 bg-gray-200" />
        <div className="flex flex-wrap gap-3">
          {prs.map((pr, i) => (
            <div key={i} className="relative flex flex-col items-center" style={{ minWidth: 80 }}>
              <div
                className="w-3 h-3 rounded-full border-2 border-white shadow z-10"
                style={{ backgroundColor: pr.isCompetition ? '#E24B4A' : '#378ADD' }}
              />
              <div className="mt-2 text-center">
                <div className="text-[11px] font-medium text-gray-700">{pr.exerciseName}</div>
                <div className="text-[13px] font-medium text-gray-900">{pr.load} kg</div>
                <div className="text-[10px] text-gray-400">{new Date(pr.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
