import { Scale, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { AthleteSnapshot } from '../../hooks/useCoachDashboardV2';

interface Props {
  athletes: AthleteSnapshot[];
}

export function BodyweightPanel({ athletes }: Props) {
  const withBw = athletes
    .filter(a => a.latestBodyweight !== null)
    .sort((a, b) => a.athlete.name.localeCompare(b.athlete.name));

  if (withBw.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="px-3 py-2 border-b border-gray-100">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Bodyweight tracker</h3>
      </div>
      <div className="divide-y divide-gray-50 max-h-[240px] overflow-y-auto">
        {withBw.map(snap => {
          const TrendIcon = snap.bodyweightTrend === 'up' ? TrendingUp
            : snap.bodyweightTrend === 'down' ? TrendingDown
            : Minus;
          const trendColor = snap.bodyweightTrend === 'up' ? 'text-red-400'
            : snap.bodyweightTrend === 'down' ? 'text-green-500'
            : 'text-gray-300';

          const wc = snap.athlete.weight_class;
          let wcStatus: 'over' | 'under' | 'ok' | null = null;
          if (wc && snap.latestBodyweight !== null) {
            const limit = parseFloat(wc);
            if (!isNaN(limit)) {
              const diff = snap.latestBodyweight - limit;
              wcStatus = diff > 0 ? 'over' : diff < -2 ? 'under' : 'ok';
            }
          }

          return (
            <div key={snap.athlete.id} className="flex items-center gap-2.5 px-3 py-1.5">
              <Scale size={11} className="text-gray-300 flex-shrink-0" />
              <span className="text-xs text-gray-700 flex-1 truncate">{snap.athlete.name}</span>
              <span className="text-xs font-bold text-gray-800">{snap.latestBodyweight} kg</span>
              <TrendIcon size={12} className={trendColor} />
              {wc && (
                <span className={`text-[10px] px-1 py-0.5 rounded ${
                  wcStatus === 'over' ? 'bg-red-50 text-red-600' :
                  wcStatus === 'under' ? 'bg-blue-50 text-blue-600' :
                  wcStatus === 'ok' ? 'bg-green-50 text-green-600' :
                  'text-gray-400'
                }`}>
                  {wc}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
