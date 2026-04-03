import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Athlete, TrainingLogSession } from '../../lib/database.types';

interface SessionHistoryProps {
  athlete: Athlete;
  onOpenSession: (date: string) => void;
  onReviewSession: (sessionId: string) => void;
}

interface WeekGroup {
  weekLabel: string;
  weekStart: Date;
  sessions: TrainingLogSession[];
  plannedCount: number;
  completedCount: number;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(weekStart: Date): string {
  return 'Week of ' + weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDayDate(iso: string): { dayAbbr: string; dateNum: string } {
  const d = new Date(iso + 'T00:00:00');
  const dayAbbr = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const dateNum = String(d.getDate());
  return { dayAbbr, dateNum };
}

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-green-500',
  in_progress: 'bg-yellow-400',
  planned: 'bg-blue-400',
};

function computeStreak(sessions: TrainingLogSession[]): number {
  const completed = sessions
    .filter(s => s.status === 'completed')
    .map(s => s.date)
    .sort()
    .reverse();

  if (completed.length === 0) return 0;

  let streak = 1;
  for (let i = 1; i < completed.length; i++) {
    const prev = new Date(completed[i - 1] + 'T00:00:00');
    const curr = new Date(completed[i] + 'T00:00:00');
    const diffDays = (prev.getTime() - curr.getTime()) / 86400000;
    if (diffDays <= 3) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function getDaysOfWeek(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export function SessionHistory({ athlete, onOpenSession, onReviewSession }: SessionHistoryProps) {
  const [sessions, setSessions] = useState<TrainingLogSession[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().split('T')[0];
  const currentWeekStart = getMondayOfWeek(today);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      // Fetch last 12 weeks of sessions
      const since = new Date(today);
      since.setDate(since.getDate() - 84);
      const sinceISO = since.toISOString().split('T')[0];

      const { data } = await supabase
        .from('training_log_sessions')
        .select('*')
        .eq('athlete_id', athlete.id)
        .gte('date', sinceISO)
        .order('date', { ascending: false });

      setSessions(data || []);
      setLoading(false);
    };
    load();
  }, [athlete.id]);

  const streak = computeStreak(sessions);

  // Current week sessions
  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 7);
  const thisWeekSessions = sessions.filter(s => {
    const d = new Date(s.date + 'T00:00:00');
    return d >= currentWeekStart && d < currentWeekEnd;
  });
  const thisWeekPlanned = thisWeekSessions.length;
  const thisWeekCompleted = thisWeekSessions.filter(s => s.status === 'completed').length;

  // Current week day grid
  const currentWeekDays = getDaysOfWeek(currentWeekStart);

  // Past weeks grouped
  const pastSessions = sessions.filter(s => {
    const d = new Date(s.date + 'T00:00:00');
    return d < currentWeekStart;
  });

  const weekGroups: WeekGroup[] = [];
  const seenWeeks = new Set<string>();
  for (const sess of pastSessions) {
    const d = new Date(sess.date + 'T00:00:00');
    const ws = getMondayOfWeek(d);
    const wsISO = ws.toISOString().split('T')[0];
    if (!seenWeeks.has(wsISO)) {
      seenWeeks.add(wsISO);
      const weekSessions = pastSessions.filter(s2 => {
        const d2 = new Date(s2.date + 'T00:00:00');
        const ws2 = getMondayOfWeek(d2);
        return ws2.toISOString().split('T')[0] === wsISO;
      });
      weekGroups.push({
        weekLabel: formatWeekLabel(ws),
        weekStart: ws,
        sessions: weekSessions,
        plannedCount: weekSessions.length,
        completedCount: weekSessions.filter(s2 => s2.status === 'completed').length,
      });
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map(n => (
          <div key={n} className="h-16 bg-gray-200 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      {/* Top stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className="text-2xl font-medium text-gray-900">{streak}</div>
          <div className="text-xs text-gray-500 mt-0.5">Session streak</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className="text-2xl font-medium text-gray-900">{thisWeekCompleted}</div>
          <div className="text-xs text-gray-500 mt-0.5">This week done</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className="text-2xl font-medium text-gray-900">{thisWeekPlanned}</div>
          <div className="text-xs text-gray-500 mt-0.5">This week planned</div>
        </div>
      </div>

      {/* Current week grid */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium text-gray-700 mb-3">This Week</div>
        <div className="grid grid-cols-7 gap-1">
          {currentWeekDays.map(day => {
            const iso = day.toISOString().split('T')[0];
            const daySession = thisWeekSessions.find(s => s.date === iso);
            const { dayAbbr, dateNum } = formatDayDate(iso);
            const isToday = iso === todayISO;
            const dotClass = daySession ? (STATUS_DOT[daySession.status] ?? 'bg-gray-300') : 'bg-gray-100';

            return (
              <button
                key={iso}
                onClick={() => onOpenSession(iso)}
                className={`flex flex-col items-center py-2 px-1 rounded-lg hover:bg-gray-50 transition-colors ${
                  isToday ? 'ring-2 ring-blue-500' : ''
                }`}
              >
                <div className="text-[10px] text-gray-400 uppercase">{dayAbbr.substring(0, 3)}</div>
                <div className={`text-sm font-medium mt-0.5 ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
                  {dateNum}
                </div>
                <div className={`w-2 h-2 rounded-full mt-1.5 ${dotClass}`} />
                {daySession?.status === 'completed' && (
                  <div className="text-[9px] text-gray-400 mt-0.5">done</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Past sessions grouped by week */}
      {weekGroups.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">History</div>
          <div className="space-y-3">
            {weekGroups.map(group => (
              <div key={group.weekStart.toISOString()} className="bg-white rounded-lg border border-gray-200">
                <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-sm text-gray-700">{group.weekLabel}</span>
                  <span className="text-xs text-gray-400">{group.completedCount}/{group.plannedCount} sessions</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {group.sessions.map(sess => {
                    const { dayAbbr, dateNum } = formatDayDate(sess.date);
                    const monthStr = new Date(sess.date + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' });
                    const dotClass = STATUS_DOT[sess.status] ?? 'bg-gray-300';

                    return (
                      <button
                        key={sess.id}
                        onClick={() => sess.id ? onReviewSession(sess.id) : onOpenSession(sess.date)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
                      >
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-900">
                            {dayAbbr} {dateNum} {monthStr}
                          </div>
                        </div>
                        <div className="text-xs text-gray-400 capitalize flex-shrink-0">
                          {sess.status === 'in_progress' ? 'In progress' : sess.status}
                          {sess.duration_minutes ? ` · ${sess.duration_minutes}min` : ''}
                        </div>
                        {sess.raw_total && (
                          <div className="text-xs text-gray-400 flex-shrink-0">RAW {sess.raw_total}/12</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sessions.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          No training sessions yet. Tap a day above to start.
        </div>
      )}
    </div>
  );
}
