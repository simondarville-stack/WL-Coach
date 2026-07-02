/**
 * UpcomingScreen — the Field View home: one card per athlete showing their
 * next open training session as a compact highlight table.
 *
 * Tap zones: the highlight table opens the day's detailed programme; the
 * athlete header opens the full week (plan beside log for done days).
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, RefreshCw, Check } from 'lucide-react';
import { useFieldWeek } from '../../hooks/useFieldWeek';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO, formatDateShort } from '../../lib/dateUtils';
import { CompactSessionTable } from '../components/CompactSessionTable';
import { rawAxisRange } from '../../lib/trainingLogModel';
import type { FieldAthleteCard } from '../../hooks/useFieldWeek';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const RAW_MAX = rawAxisRange().max;

function nextLabel(card: FieldAthleteCard, weekStart: string): { text: string; tone: string } {
  const { kind, day } = card.next;
  const time = day?.weekday != null && card.overview
    ? null // time lives in day_schedule; surfaced via sessionDate when logged
    : null;
  void time;
  switch (kind) {
    case 'today':
      return { text: `Today · ${day!.label}`, tone: 'text-blue-400' };
    case 'next_up':
      return { text: `Next up · ${day!.label}`, tone: 'text-gray-400' };
    case 'scheduled': {
      const date = addDaysToISO(weekStart, day!.weekday!);
      return {
        text: `${WEEKDAY_SHORT[day!.weekday!]} ${formatDateShort(date)} · ${day!.label}`,
        tone: 'text-gray-400',
      };
    }
    case 'overdue': {
      const date = addDaysToISO(weekStart, day!.weekday!);
      return {
        text: `${WEEKDAY_SHORT[day!.weekday!]} ${formatDateShort(date)} · ${day!.label}`,
        tone: 'text-orange-400',
      };
    }
    case 'week_complete':
      return { text: 'week complete · view plan + log', tone: 'text-emerald-400' };
    case 'no_plan':
      return { text: 'no plan this week', tone: 'text-gray-600' };
  }
}

export function UpcomingScreen() {
  const navigate = useNavigate();
  const weekStart = useMemo(() => getMondayOfWeekISO(new Date()), []);
  const { cards, loading, error, refresh } = useFieldWeek(weekStart);

  const today = new Date();

  return (
    <div className="max-w-2xl mx-auto px-3 pt-4">
      <div className="flex items-baseline justify-between px-1 mb-3">
        <div>
          <h1 className="text-lg font-bold text-white">Upcoming</h1>
          <p className="text-xs text-gray-500">
            {WEEKDAY_SHORT[(today.getDay() + 6) % 7]} {formatDateShort(today.toISOString().slice(0, 10))}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="p-2 text-gray-500 hover:text-gray-300"
          aria-label="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <p className="text-sm text-red-400 px-1 mb-3">{error}</p>}

      {loading && cards.length === 0 ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : cards.length === 0 ? (
        <p className="text-sm text-gray-500 px-1">No active athletes in this environment.</p>
      ) : (
        <div className="flex flex-col gap-2 pb-4">
          {cards.map(card => {
            const label = nextLabel(card, weekStart);
            const hasTable = card.next.day != null && card.rows.length > 0;
            // The resolved slot itself (overdue) already reads as missed via
            // its own orange date label — only flag *other* missed slots.
            const missed = card.missedDays.filter(d => d.dayIndex !== card.next.day?.dayIndex);
            const missedSuffix = missed.length > 0
              ? missed
                  .map(d => (d.weekday != null ? WEEKDAY_SHORT[d.weekday] : d.label))
                  .join(', ')
              : null;
            const tone = missedSuffix ? 'text-orange-400' : label.tone;
            return (
              <div key={card.athlete.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => navigate(`/field/a/${card.athlete.id}?w=${weekStart}`)}
                  className="w-full px-3 pt-2.5 pb-2 text-left"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white flex items-center gap-1 min-w-0">
                      <span className="truncate">{card.athlete.name}</span>
                      <ChevronRight size={13} className="text-gray-600 shrink-0" />
                    </span>
                    <span className={`text-[11px] shrink-0 flex items-center gap-1 ${tone}`}>
                      {card.next.kind === 'week_complete' && <Check size={12} />}
                      {card.progress && (
                        <span className="text-blue-400">
                          {card.progress.done}/{card.progress.total} exercises ·{' '}
                        </span>
                      )}
                      {label.text}
                      {missedSuffix && ` · missed ${missedSuffix}`}
                    </span>
                  </span>
                  {card.rawTotal != null && (
                    <span
                      className="block text-right text-[11px] text-emerald-400 mt-0.5"
                      title="RAW readiness (Eleiko): sum of 4 pillars rated 1–3, range 4–12"
                    >
                      RAW {card.rawTotal}/{RAW_MAX}
                    </span>
                  )}
                </button>
                {hasTable && (
                  <button
                    onClick={() =>
                      navigate(`/field/a/${card.athlete.id}/d/${card.next.day!.dayIndex}?w=${weekStart}`)
                    }
                    className="w-full text-left active:bg-gray-800/50"
                    aria-label={`Open ${card.athlete.name}'s programme for ${card.next.day!.label}`}
                  >
                    <CompactSessionTable rows={card.rows} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
