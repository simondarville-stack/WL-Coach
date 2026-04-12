import { Dumbbell, SkipForward, CheckCircle } from 'lucide-react';
import type { RecentSession } from '../../hooks/useCoachDashboardV2';
import { formatDateToDDMMYYYY } from '../../lib/dateUtils';
import { getRawColor } from '../../lib/calculations';

interface Props {
  sessions: RecentSession[];
}

export function ActivityFeed({ sessions }: Props) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="px-3 py-2 border-b border-gray-100">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Recent activity</h3>
      </div>
      {sessions.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">No recent sessions</div>
      ) : (
        <div className="divide-y divide-gray-50 max-h-[300px] overflow-y-auto">
          {sessions.map((s, i) => (
            <SessionRow key={i} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({ session }: { session: RecentSession }) {
  const isCompleted = session.status === 'completed';
  const isSkipped = session.status === 'skipped';

  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <div className={`p-1 rounded ${isCompleted ? 'bg-green-50' : isSkipped ? 'bg-gray-100' : 'bg-blue-50'}`}>
        {isCompleted ? (
          <CheckCircle size={12} className="text-green-500" />
        ) : isSkipped ? (
          <SkipForward size={12} className="text-gray-400" />
        ) : (
          <Dumbbell size={12} className="text-blue-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-gray-800">{session.athleteName}</span>
        <span className="text-[11px] text-gray-400 ml-1.5">
          {isCompleted ? 'trained' : isSkipped ? 'skipped' : session.status}
        </span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {session.rawTotal !== null && (
          <span className={`text-[11px] font-medium ${getRawColor(session.rawTotal)}`}>
            RAW {session.rawTotal}
          </span>
        )}
        {session.sessionRpe !== null && (
          <span className="text-[11px] text-gray-400">
            RPE {session.sessionRpe}
          </span>
        )}
        <span className="text-[10px] text-gray-400">
          {formatDateToDDMMYYYY(session.date)}
        </span>
      </div>
    </div>
  );
}
