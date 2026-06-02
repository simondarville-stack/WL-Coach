// Activity feed — recent events from the EMOS data layer with click-to-jump.

import { CheckCircle2, XCircle, Sparkles, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ActivityEvent, AthleteStatus } from '../../hooks/useCoachDashboard';

type Tone = 'success' | 'danger' | 'accent';

const TYPE_META: Record<ActivityEvent['type'], { label: string; tone: Tone; icon: ReactNode }> = {
  training_logged:    { label: 'Training logged',  tone: 'success', icon: <CheckCircle2 size={14} /> },
  session_skipped:    { label: 'Session skipped',  tone: 'danger',  icon: <XCircle      size={14} /> },
  macrocycle_created: { label: 'Macrocycle',       tone: 'accent',  icon: <Sparkles     size={14} /> },
  pr_set:             { label: 'New PR',           tone: 'accent',  icon: <Trophy       size={14} /> },
};

const TONE_CLS: Record<Tone, string> = {
  success: 'text-green-600',
  danger:  'text-red-600',
  accent:  'text-blue-600',
};

function relTimeFromDate(d: Date): string {
  const mins = (Date.now() - d.getTime()) / 60_000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / (60 * 24));
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

interface Props {
  events: ActivityEvent[];
  statuses: AthleteStatus[];
  onJumpToAthlete: (status: AthleteStatus) => void;
  /** Open the coach Log for an athlete's week (used by day-logged + PR rows). */
  onOpenLog: (status: AthleteStatus, weekStart: string) => void;
}

export function ActivityFeedPanel({ events, statuses, onJumpToAthlete, onOpenLog }: Props) {
  const byName: Record<string, AthleteStatus> = {};
  statuses.forEach(s => { byName[s.athlete.name] = s; });

  return (
    <div className="bg-white rounded-lg border border-gray-200 flex flex-col min-h-[360px]">
      <div className="px-4 py-3 border-b border-gray-100 flex items-baseline gap-3">
        <h3 className="text-sm font-medium text-gray-900">Activity</h3>
        <span className="text-xs text-gray-400 tabular-nums">
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[460px]">
        {events.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-400">
            No recent activity.
          </div>
        )}
        {events.map((ev, i) => {
          const meta = TYPE_META[ev.type];
          const status = byName[ev.athleteName] || null;
          const clickable = !!status;
          return (
            <button
              key={`${ev.type}-${ev.timestamp.toISOString()}-${i}`}
              onClick={() => {
                if (!status) return;
                // Day-logged / skipped / PR rows carry a week → open the Log.
                // Macrocycle rows have no week → just jump to the athlete.
                if (ev.weekStart) onOpenLog(status, ev.weekStart);
                else onJumpToAthlete(status);
              }}
              disabled={!clickable}
              className={`w-full grid grid-cols-[24px_1fr_auto] gap-3 items-start px-4 py-2.5 text-left border-b border-gray-50 last:border-b-0 ${
                clickable ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'
              }`}
            >
              <span className={`${TONE_CLS[meta.tone]} mt-0.5`}>{meta.icon}</span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className={`text-[11px] uppercase tracking-wider font-medium ${TONE_CLS[meta.tone]}`}>
                    {meta.label}
                  </span>
                  <span className="text-sm font-medium text-gray-900">{ev.athleteName}</span>
                </div>
                <span className="text-xs text-gray-500 truncate">{ev.details}</span>
                {ev.rawScore !== undefined && ev.rawScore !== null && (
                  <span className="text-[11px] text-gray-400 tabular-nums" title="Readiness (RAW wellness score) out of 12">RAW {ev.rawScore}/12</span>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-[11px] text-gray-400 tabular-nums whitespace-nowrap">
                  {relTimeFromDate(ev.timestamp)}
                </span>
                {clickable && (
                  <span className="text-[11px] text-blue-600">open →</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
