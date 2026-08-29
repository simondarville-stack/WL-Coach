// Review status panel — reviewed-vs-completed sessions per athlete over the
// review feed's lookback window. Fell out of the Review feed feature for
// free: sessions now carry coach_reviewed_at, so "have I looked at this
// athlete's training?" is one thin query. Deep-links into /review.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, PlaySquare } from 'lucide-react';
import { useAthleteStore } from '../../store/athleteStore';
import { onInboxChanged } from '../../lib/inboxEvents';
import { getOwnerId } from '../../lib/ownerContext';
import {
  fetchReviewStatusByAthlete,
  REVIEW_SESSION_LOOKBACK_DAYS,
  type AthleteReviewStatus,
} from '../../lib/reviewFeedService';
import { Avatar } from './atoms';

export function ReviewStatusPanel() {
  const navigate = useNavigate();
  const athletes = useAthleteStore(s => s.athletes);
  const [rows, setRows] = useState<AthleteReviewStatus[] | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchReviewStatusByAthlete(getOwnerId(), athletes.map(a => a.id)));
    } catch {
      setRows([]); // a transient failure shouldn't take down the dashboard
    }
  }, [athletes]);

  useEffect(() => {
    void load();
    // Resync when the review feed (or inbox) marks things — debounced
    // because clearing cards emits once per card.
    let debounce: number | null = null;
    const unsubscribe = onInboxChanged(() => {
      if (debounce != null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void load(), 600);
    });
    return () => {
      if (debounce != null) window.clearTimeout(debounce);
      unsubscribe();
    };
  }, [load]);

  const outstanding = (rows ?? []).reduce((sum, r) => sum + (r.completed - r.reviewed), 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 flex flex-col min-h-[360px]">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
        <h3 className="text-sm font-medium text-gray-900">Review status</h3>
        <span className="text-xs text-gray-400 tabular-nums">
          last {REVIEW_SESSION_LOOKBACK_DAYS} days
        </span>
        <span className="flex-1" />
        <button
          onClick={() => navigate('/review')}
          className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700"
        >
          <PlaySquare size={13} />
          {outstanding > 0 ? `Review ${outstanding}` : 'Open review feed'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[460px]">
        {rows == null && (
          <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
        )}
        {rows != null && rows.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-400">
            No completed sessions in the last {REVIEW_SESSION_LOOKBACK_DAYS} days.
          </div>
        )}
        {rows?.map(r => {
          const athlete = athletes.find(a => a.id === r.athleteId);
          const name = athlete?.name ?? 'Unknown athlete';
          const open = r.completed - r.reviewed;
          const pct = r.completed === 0 ? 0 : (r.reviewed / r.completed) * 100;
          return (
            <div key={r.athleteId} className="px-4 py-2 border-b border-gray-50 flex items-center gap-2.5">
              <Avatar name={name} size={20} />
              <span className="text-xs text-gray-700 truncate w-32 shrink-0">{name}</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${open === 0 ? 'bg-green-500' : 'bg-[var(--color-accent)]'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 tabular-nums w-10 text-right shrink-0">
                {r.reviewed}/{r.completed}
              </span>
              {open === 0 ? (
                <CheckCircle2 size={14} className="text-green-500 shrink-0" />
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 tabular-nums shrink-0">
                  {open} new
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
