import { User } from 'lucide-react';
import type { AthleteSnapshot } from '../../hooks/useCoachDashboardV2';

interface Props {
  athletes: AthleteSnapshot[];
}

function rawToColor(raw: number | null): string {
  if (raw === null) return 'bg-gray-100';
  if (raw >= 10) return 'bg-green-400';
  if (raw >= 9) return 'bg-green-300';
  if (raw >= 8) return 'bg-green-200';
  if (raw >= 7) return 'bg-yellow-200';
  if (raw >= 6) return 'bg-yellow-300';
  if (raw >= 5) return 'bg-orange-300';
  return 'bg-red-400';
}

function rawToTextColor(raw: number | null): string {
  if (raw === null) return 'text-gray-400';
  if (raw >= 7) return 'text-gray-800';
  return 'text-white';
}

export function ReadinessHeatmap({ athletes }: Props) {
  const sorted = [...athletes].sort((a, b) => (b.rawAverage ?? -1) - (a.rawAverage ?? -1));

  if (athletes.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="px-3 py-2 border-b border-gray-100">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Readiness overview</h3>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
          {sorted.map(snap => {
            const bg = rawToColor(snap.rawAverage);
            const text = rawToTextColor(snap.rawAverage);
            return (
              <div
                key={snap.athlete.id}
                className={`${bg} rounded-lg p-2 flex flex-col items-center justify-center text-center transition-transform hover:scale-105`}
                title={`${snap.athlete.name}: RAW ${snap.rawAverage?.toFixed(1) ?? 'N/A'}`}
              >
                {snap.athlete.photo_url ? (
                  <img src={snap.athlete.photo_url} alt="" className="w-7 h-7 rounded-full object-cover mb-1" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-white/30 flex items-center justify-center mb-1">
                    <User size={12} className={text} />
                  </div>
                )}
                <span className={`text-[10px] font-medium ${text} leading-tight truncate w-full`}>
                  {snap.athlete.name.split(' ')[0]}
                </span>
                <span className={`text-[11px] font-bold ${text}`}>
                  {snap.rawAverage !== null ? snap.rawAverage.toFixed(1) : '-'}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-center gap-1 mt-3">
          <span className="text-[9px] text-gray-400">Low</span>
          <div className="flex gap-0.5">
            {['bg-red-400', 'bg-orange-300', 'bg-yellow-300', 'bg-yellow-200', 'bg-green-200', 'bg-green-300', 'bg-green-400'].map((c, i) => (
              <div key={i} className={`w-4 h-2 rounded-sm ${c}`} />
            ))}
          </div>
          <span className="text-[9px] text-gray-400">High</span>
        </div>
      </div>
    </div>
  );
}
