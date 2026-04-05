import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Athlete, TrainingLogSession, WeekPlan } from '../../lib/database.types';

interface SessionHistoryProps {
  athlete: Athlete;
  onOpenSession: (weekStart: string, dayIndex: number) => void;
  onReviewSession: (sessionId: string) => void;
}

interface WeekData {
  weekStartISO: string;
  weekPlan: WeekPlan | null;
  sessions: TrainingLogSession[];
}

function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMondayISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return toLocalISO(d);
}

function addWeeks(isoDate: string, weeks: number): string {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + weeks * 7);
  return toLocalISO(d);
}

function formatWeekRange(weekStartISO: string): string {
  const start = new Date(weekStartISO + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${start.toLocaleDateString('en-GB', opts)} – ${end.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}`;
}

function getDayLabel(weekPlan: WeekPlan | null, dayIndex: number): string {
  if (weekPlan?.day_labels?.[dayIndex]) return weekPlan.day_labels[dayIndex];
  return `Day ${dayIndex}`;
}

function getActiveDays(weekPlan: WeekPlan | null): number[] {
  if (!weekPlan) return [];
  // Respect display order if set
  const order = weekPlan.day_display_order;
  const days = weekPlan.active_days ?? [];
  if (order && order.length > 0) {
    return order.filter(d => days.includes(d));
  }
  return [...days].sort((a, b) => a - b);
}

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-green-500',
  in_progress: 'bg-yellow-400',
  planned: 'bg-blue-400',
  pending: 'bg-gray-200',
};

const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  planned: 'Not started',
  pending: 'Not started',
};

function computeStreak(sessions: TrainingLogSession[]): number {
  const completed = sessions
    .filter(s => s.status === 'completed')
    .sort((a, b) => (a.week_start < b.week_start ? 1 : a.week_start > b.week_start ? -1 : b.day_index - a.day_index));

  if (completed.length === 0) return 0;
  let streak = 1;
  for (let i = 1; i < completed.length; i++) {
    // Consecutive means no more than a few days gap (allow up to 5-day gap between sessions)
    const prev = completed[i - 1];
    const curr = completed[i];
    // Use actual session dates, not calculated weekStart + dayIndex dates
    const prevDate = new Date(prev.date + 'T00:00:00');
    const currDate = new Date(curr.date + 'T00:00:00');
    const diffDays = (prevDate.getTime() - currDate.getTime()) / 86400000;
    if (diffDays <= 5) streak++;
    else break;
  }
  return streak;
}

export function SessionHistory({ athlete, onOpenSession, onReviewSession }: SessionHistoryProps) {
  const todayWeekStart = getMondayISO();
  const [currentWeekStart, setCurrentWeekStart] = useState(todayWeekStart);
  const [weekData, setWeekData] = useState<WeekData | null>(null);
  const [history, setHistory] = useState<WeekData[]>([]);
  const [allSessions, setAllSessions] = useState<TrainingLogSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Load all sessions + week plans for last 12 weeks
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const since = addWeeks(todayWeekStart, -11);

      const [{ data: sessionsData }, { data: plansData }] = await Promise.all([
        supabase
          .from('training_log_sessions')
          .select('*')
          .eq('athlete_id', athlete.id)
          .gte('week_start', since)
          .order('week_start', { ascending: false }),
        supabase
          .from('week_plans')
          .select('*')
          .eq('athlete_id', athlete.id)
          .gte('week_start', since)
          .order('week_start', { ascending: false }),
      ]);

      const sessions: TrainingLogSession[] = sessionsData || [];
      const plans: WeekPlan[] = plansData || [];

      setAllSessions(sessions);

      // Build history (past weeks only, not current)
      const pastWeeks: WeekData[] = [];
      const weeksSet = new Set<string>();
      // Collect all week starts from plans and sessions
      for (const p of plans) weeksSet.add(p.week_start);
      for (const s of sessions) weeksSet.add(s.week_start);

      for (const ws of Array.from(weeksSet).sort().reverse()) {
        if (ws >= todayWeekStart) continue;
        pastWeeks.push({
          weekStartISO: ws,
          weekPlan: plans.find(p => p.week_start === ws) ?? null,
          sessions: sessions.filter(s => s.week_start === ws),
        });
      }

      setHistory(pastWeeks);
      setLoading(false);
    };
    load();
  }, [athlete.id]);

  // Load current viewed week's data
  useEffect(() => {
    const load = async () => {
      const [{ data: plan }, { data: sessList }] = await Promise.all([
        supabase
          .from('week_plans')
          .select('*')
          .eq('athlete_id', athlete.id)
          .eq('week_start', currentWeekStart)
          .maybeSingle(),
        supabase
          .from('training_log_sessions')
          .select('*')
          .eq('athlete_id', athlete.id)
          .eq('week_start', currentWeekStart),
      ]);

      setWeekData({
        weekStartISO: currentWeekStart,
        weekPlan: plan ?? null,
        sessions: sessList || [],
      });
    };
    load();
  }, [athlete.id, currentWeekStart]);

  const streak = computeStreak(allSessions);
  const thisWeekSessions = allSessions.filter(s => s.week_start === todayWeekStart);
  const thisWeekCompleted = thisWeekSessions.filter(s => s.status === 'completed').length;

  const isCurrentWeek = currentWeekStart === todayWeekStart;
  const isFutureWeek = currentWeekStart > todayWeekStart;

  const activeDays = getActiveDays(weekData?.weekPlan ?? null);

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-2xl mx-auto">
        {[1, 2, 3].map(n => (
          <div key={n} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className="text-2xl font-medium text-gray-900">{streak}</div>
          <div className="text-xs text-gray-500 mt-0.5">Session streak</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className="text-2xl font-medium text-gray-900">{thisWeekCompleted}</div>
          <div className="text-xs text-gray-500 mt-0.5">Done this week</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className="text-2xl font-medium text-gray-900">{allSessions.filter(s => s.status === 'completed').length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total sessions</div>
        </div>
      </div>

      {/* Week navigator */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <button
            onClick={() => setCurrentWeekStart(ws => addWeeks(ws, -1))}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft size={18} className="text-gray-500" />
          </button>
          <div className="text-center">
            <div className="text-sm font-medium text-gray-900">
              {isCurrentWeek ? 'This Week' : isFutureWeek ? 'Next Week' : formatWeekRange(currentWeekStart)}
            </div>
            {!isCurrentWeek && (
              <button
                onClick={() => setCurrentWeekStart(todayWeekStart)}
                className="text-xs text-blue-600 hover:underline mt-0.5"
              >
                Back to this week
              </button>
            )}
            {isCurrentWeek && (
              <div className="text-xs text-gray-400">{formatWeekRange(currentWeekStart)}</div>
            )}
          </div>
          <button
            onClick={() => setCurrentWeekStart(ws => addWeeks(ws, 1))}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
          >
            <ChevronRight size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Training days for this week */}
        {weekData === null || weekData.weekPlan === null ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            No training plan for this week
          </div>
        ) : activeDays.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            No training days in this plan
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {activeDays.map(dayIndex => {
              const session = weekData.sessions.find(s => s.day_index === dayIndex);
              const status = session?.status ?? 'pending';
              const dotClass = STATUS_DOT[status] ?? 'bg-gray-200';
              const label = getDayLabel(weekData.weekPlan, dayIndex);

              return (
                <button
                  key={dayIndex}
                  onClick={() => {
                    if (session?.id && (status === 'completed' || status === 'in_progress')) {
                      // For completed/in-progress, open session view (allows review/resume)
                      onOpenSession(currentWeekStart, dayIndex);
                    } else {
                      onOpenSession(currentWeekStart, dayIndex);
                    }
                  }}
                  className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900">{label}</div>
                    {session?.date && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        logged {new Date(session.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {session.duration_minutes ? ` · ${session.duration_minutes} min` : ''}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 flex-shrink-0">{STATUS_LABEL[status] ?? status}</div>
                  {session?.raw_total && (
                    <div className="text-xs text-gray-400 flex-shrink-0">RAW {session.raw_total}/12</div>
                  )}
                  <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Past week history */}
      {history.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 px-1">History</div>
          <div className="space-y-2">
            {history.map(wk => {
              const days = getActiveDays(wk.weekPlan);
              const completedCount = wk.sessions.filter(s => s.status === 'completed').length;
              const totalDays = days.length || wk.sessions.length;

              return (
                <div key={wk.weekStartISO} className="bg-white rounded-lg border border-gray-200">
                  <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-sm text-gray-700">{formatWeekRange(wk.weekStartISO)}</span>
                    <span className="text-xs text-gray-400">{completedCount}/{totalDays} sessions</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {days.length > 0 ? (
                      days.map(dayIndex => {
                        const sess = wk.sessions.find(s => s.day_index === dayIndex);
                        const status = sess?.status ?? 'pending';
                        const dotClass = STATUS_DOT[status] ?? 'bg-gray-200';
                        const label = getDayLabel(wk.weekPlan, dayIndex);

                        return (
                          <button
                            key={dayIndex}
                            onClick={() => {
                              if (sess?.id) onReviewSession(sess.id);
                              else onOpenSession(wk.weekStartISO, dayIndex);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
                          >
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
                            <span className="flex-1 text-sm text-gray-900">{label}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0">
                              {STATUS_LABEL[status] ?? status}
                              {sess?.duration_minutes ? ` · ${sess.duration_minutes}min` : ''}
                            </span>
                            {sess?.raw_total && (
                              <span className="text-xs text-gray-400 flex-shrink-0">RAW {sess.raw_total}/12</span>
                            )}
                          </button>
                        );
                      })
                    ) : (
                      // No week plan — show sessions directly
                      wk.sessions.map(sess => {
                        const dotClass = STATUS_DOT[sess.status] ?? 'bg-gray-300';
                        return (
                          <button
                            key={sess.id}
                            onClick={() => onReviewSession(sess.id)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
                          >
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
                            <span className="flex-1 text-sm text-gray-900">Day {sess.day_index}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0 capitalize">
                              {sess.status === 'in_progress' ? 'In progress' : sess.status}
                              {sess.duration_minutes ? ` · ${sess.duration_minutes}min` : ''}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {allSessions.length === 0 && history.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          No training sessions yet. Select a week above and start training.
        </div>
      )}
    </div>
  );
}
