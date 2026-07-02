/**
 * UpcomingScreen — the Field View home: one card per athlete showing their
 * next open training session as a compact highlight table.
 *
 * Tap zones: the highlight table opens the day's detailed programme; the
 * athlete header opens the full week (plan beside log for done days).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, RefreshCw, Check, Users } from 'lucide-react';
import { useFieldWeek } from '../../hooks/useFieldWeek';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO, formatDateShort } from '../../lib/dateUtils';
import { CompactSessionTable } from '../components/CompactSessionTable';
import { EnvironmentSwitcher } from '../components/EnvironmentSwitcher';
import { rawAxisRange } from '../../lib/trainingLogModel';
import type { NextSessionResolution } from '../../lib/fieldView';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const RAW_MAX = rawAxisRange().max;

/** Persisted group-chip selection ('all' or a training_groups id). */
const GROUP_FILTER_KEY = 'emos.field.groupFilter';

function readStoredGroupFilter(): string {
  try {
    return localStorage.getItem(GROUP_FILTER_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

function GroupChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

function nextLabel(next: NextSessionResolution, weekStart: string): { text: string; tone: string } {
  const { kind, day } = next;
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
  const { cards, groups, groupCards, loading, error, refresh } = useFieldWeek(weekStart);

  const [groupFilter, setGroupFilter] = useState<string>(readStoredGroupFilter);
  useEffect(() => {
    try {
      localStorage.setItem(GROUP_FILTER_KEY, groupFilter);
    } catch {
      // Private mode / quota — the chip still works for this visit.
    }
  }, [groupFilter]);

  // A stored group that has since been deleted falls back to All.
  const activeGroup = groups.find(g => g.id === groupFilter) ?? null;
  const visibleCards = activeGroup
    ? cards.filter(c => activeGroup.athleteIds.includes(c.athlete.id))
    : cards;
  const visibleGroupCards = activeGroup
    ? groupCards.filter(gc => gc.group.id === activeGroup.id)
    : groupCards;

  const today = new Date();

  return (
    <div className="max-w-2xl mx-auto px-3 pt-4">
      <div className="flex items-baseline justify-between px-1 mb-3">
        <div>
          <h1 className="text-lg font-bold text-white">Upcoming</h1>
          {/* div, not p: the switcher renders a bottom-sheet (block content) */}
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <span>
              {WEEKDAY_SHORT[(today.getDay() + 6) % 7]} {formatDateShort(today.toISOString().slice(0, 10))}
            </span>
            <span aria-hidden="true">·</span>
            <EnvironmentSwitcher />
          </div>
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

      {groups.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto px-1 pb-3" role="group" aria-label="Filter by training group">
          <GroupChip
            label="All"
            active={activeGroup == null}
            onClick={() => setGroupFilter('all')}
          />
          {groups.map(g => (
            <GroupChip
              key={g.id}
              label={g.name}
              active={activeGroup?.id === g.id}
              onClick={() => setGroupFilter(g.id)}
            />
          ))}
        </div>
      )}

      {loading && cards.length === 0 && groupCards.length === 0 ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : visibleCards.length === 0 && visibleGroupCards.length === 0 ? (
        <p className="text-sm text-gray-500 px-1">
          {activeGroup ? 'Nothing to show in this group.' : 'No active athletes in this environment.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2 pb-4">
          {visibleGroupCards.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wide text-gray-600 px-1">Group plans</p>
              {visibleGroupCards.map(gc => {
                const glabel = nextLabel(gc.next, weekStart);
                return (
                  <div key={gc.group.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <button
                      onClick={() => navigate(`/field/g/${gc.group.id}?w=${weekStart}`)}
                      className="w-full px-3 pt-2.5 pb-2 text-left"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white flex items-center gap-1.5 min-w-0">
                          <Users size={13} className="text-gray-500 shrink-0" />
                          <span className="truncate">{gc.group.name}</span>
                          <ChevronRight size={13} className="text-gray-600 shrink-0" />
                        </span>
                        <span className={`text-[11px] shrink-0 ${glabel.tone}`}>{glabel.text}</span>
                      </span>
                    </button>
                    {gc.next.day && gc.rows.length > 0 && (
                      <button
                        onClick={() =>
                          navigate(`/field/g/${gc.group.id}/d/${gc.next.day!.dayIndex}?w=${weekStart}`)
                        }
                        className="w-full text-left active:bg-gray-800/50"
                        aria-label={`Open ${gc.group.name}'s group programme for ${gc.next.day!.label}`}
                      >
                        <CompactSessionTable rows={gc.rows} />
                      </button>
                    )}
                  </div>
                );
              })}
              {visibleCards.length > 0 && (
                <p className="text-[10px] uppercase tracking-wide text-gray-600 px-1 mt-1">Athletes</p>
              )}
            </>
          )}
          {visibleCards.map(card => {
            const label = nextLabel(card.next, weekStart);
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
