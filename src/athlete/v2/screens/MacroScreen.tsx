/**
 * MacroScreen — the athlete's view of the coach's macro cycle.
 *
 * Deliberately number-free: training weeks, their dates, the week type, the
 * phase they sit in, the coach's week note and the events in range. No targets,
 * no tonnage, no per-exercise loads. The point is to let an athlete plan their
 * life around how hard a week is going to be, without handing them a spreadsheet
 * of numbers to worry about.
 *
 * Read-only. Planned data is coach-authored (CLAUDE.md, "Data integrity") — this
 * screen never writes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange, ChevronDown, ChevronRight, Loader2, Users } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { describeError } from '../../../lib/errorMessage';
import { fetchAthleteMacros, type AthleteMacro, type AthleteMacroWeek } from '../../../lib/athleteMacroService';
import { getEventTypeIcon } from '../../../lib/eventTypeIcons';
import { CAL_EVENT_COLORS } from '../../../lib/eventTypes';
import { formatDateShort } from '../../../lib/dateUtils';
import { getMondayOfWeekISO } from '../../../lib/weekUtils';
import type { MacroPhase } from '../../../lib/database.types';

export function MacroScreen() {
  const { athlete } = useAuth();
  const navigate = useNavigate();
  const [macros, setMacros] = useState<AthleteMacro[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const thisMonday = getMondayOfWeekISO(new Date());

  /** Tapping a week opens it in the Week tab — the macro is the map, Week is
   *  where the actual sessions live. */
  const openWeek = (weekStart: string) => navigate(`/athlete/week?week=${weekStart}`);

  const load = useCallback(async () => {
    if (!athlete) return;
    setError(null);
    try {
      const data = await fetchAthleteMacros(athlete.id);
      setMacros(data);
      // Open the macro that covers today (or, if none does, the most recent
      // one) and collapse the rest — an athlete with three seasons of history
      // shouldn't have to scroll past them.
      const current = data.find(m => m.startDate <= thisMonday && m.endDate >= thisMonday)
        ?? data[data.length - 1];
      setCollapsed(new Set(data.filter(m => m.id !== current?.id).map(m => m.id)));
    } catch (e) {
      console.error('[MacroScreen] load failed', e);
      setError(describeError(e));
    }
  }, [athlete, thisMonday]);

  useEffect(() => { void load(); }, [load]);

  if (!athlete) {
    return <div className="px-4 py-6 text-sm text-[color:var(--color-text-secondary)]">Pick an athlete from the profile picker.</div>;
  }

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 80px)' }}>
      <header className="sticky top-0 z-10 bg-[var(--color-bg-page)] px-4 pt-4 pb-3 border-b border-[color:var(--color-border-tertiary)]">
        <h1 className="text-base font-semibold text-white">Macro</h1>
        <p className="text-[11px] text-[color:var(--color-text-secondary)] mt-0.5">
          How the weeks ahead are shaped — types, phases and events.
        </p>
      </header>

      <div className="flex-1 px-3 py-3 pb-24 space-y-4">
        {macros == null && !error && (
          <div className="flex items-center justify-center py-12 text-[color:var(--color-text-secondary)] text-sm gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading macro…
          </div>
        )}

        {error && (
          <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
            <div className="font-semibold">Failed to load</div>
            <div className="mt-1 break-all">{error}</div>
          </div>
        )}

        {macros?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <CalendarRange size={22} className="text-[color:var(--color-text-tertiary)]" />
            <p className="text-sm text-[color:var(--color-text-secondary)]">No macro cycle yet</p>
            <p className="text-[11px] text-[color:var(--color-text-tertiary)] max-w-[16rem]">
              Your coach hasn't published a macro cycle for you. The week plan is still in the Week tab.
            </p>
          </div>
        )}

        {macros?.map(macro => (
          <MacroBlock
            key={macro.id}
            macro={macro}
            thisMonday={thisMonday}
            isCollapsed={collapsed.has(macro.id)}
            onOpenWeek={openWeek}
            onToggle={() => setCollapsed(prev => {
              const next = new Set(prev);
              if (next.has(macro.id)) next.delete(macro.id);
              else next.add(macro.id);
              return next;
            })}
          />
        ))}
      </div>
    </div>
  );
}

function MacroBlock({ macro, thisMonday, isCollapsed, onToggle, onOpenWeek }: {
  macro: AthleteMacro;
  thisMonday: string;
  isCollapsed: boolean;
  onToggle: () => void;
  onOpenWeek: (weekStart: string) => void;
}) {
  // Week rows carry a phase header whenever the phase changes, so the list
  // reads as blocks of work rather than a flat run of weeks. A macro with no
  // phases at all renders as one unlabelled run — no "No phase" noise.
  const rows = useMemo(() => {
    const out: Array<{ phase: MacroPhase | null; weeks: AthleteMacroWeek[] }> = [];
    for (const week of macro.weeks) {
      const last = out[out.length - 1];
      if (last && last.phase?.id === week.phase?.id) last.weeks.push(week);
      else out.push({ phase: week.phase, weeks: [week] });
    }
    return out;
  }, [macro.weeks]);
  const hasPhases = macro.phases.length > 0;

  return (
    <section className="rounded-xl border border-[color:var(--color-border-tertiary)] bg-gray-900/40 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-900/60"
        aria-expanded={!isCollapsed}
      >
        {isCollapsed
          ? <ChevronRight size={14} className="text-[color:var(--color-text-secondary)] flex-shrink-0" />
          : <ChevronDown size={14} className="text-[color:var(--color-text-secondary)] flex-shrink-0" />}
        <span className="text-sm font-semibold text-white truncate">{macro.name}</span>
        {macro.isGroupMacro && (
          <Users size={11} className="text-[color:var(--color-text-secondary)] flex-shrink-0" aria-label="Group macro" />
        )}
        <span className="text-[length:var(--text-caption)] text-[color:var(--color-text-secondary)] ml-auto flex-shrink-0">
          {formatDateShort(macro.startDate)}–{formatDateShort(macro.endDate)} · {macro.weeks.length} wk
        </span>
      </button>

      {!isCollapsed && (
        <div className="border-t border-[color:var(--color-border-tertiary)]">
          {rows.map(({ phase, weeks }, i) => (
            <div key={phase?.id ?? `free-${i}`}>
              {hasPhases && (
                <div
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-900/70 border-b border-[color:var(--color-border-tertiary)]"
                  style={{ borderLeft: `3px solid ${phase?.color || 'transparent'}` }}
                >
                  <span className="text-[length:var(--text-caption)] uppercase tracking-wide font-semibold text-[color:var(--color-text-secondary)]">
                    {phase?.name ?? 'Between phases'}
                  </span>
                  <span className="text-[length:var(--text-caption)] text-[color:var(--color-text-tertiary)]">
                    {weeks.length} week{weeks.length === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              {weeks.map(week => (
                <WeekRow
                  key={week.id}
                  week={week}
                  isCurrent={week.weekStart === thisMonday}
                  onOpen={() => onOpenWeek(week.weekStart)}
                />
              ))}
            </div>
          ))}
          {macro.weeks.length === 0 && (
            <p className="px-3 py-4 text-xs text-[color:var(--color-text-tertiary)]">No weeks in this cycle yet.</p>
          )}
        </div>
      )}
    </section>
  );
}

function WeekRow({ week, isCurrent, onOpen }: {
  week: AthleteMacroWeek;
  isCurrent: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open training week ${week.weekNumber} in the Week tab`}
      className={`w-full text-left flex gap-2.5 px-3 py-2 border-b border-gray-800/70 last:border-b-0 hover:bg-gray-800/40 active:bg-gray-800/60 transition-colors ${
        isCurrent ? 'bg-blue-950/40' : ''
      }`}
    >
      <div className="w-9 flex-shrink-0 pt-0.5">
        <div className={`text-xs font-semibold ${isCurrent ? 'text-[color:var(--color-accent)]' : 'text-[color:var(--color-text-primary)]'}`}>
          W{week.weekNumber}
        </div>
        {isCurrent && <div className="text-[length:var(--text-micro)] text-[color:var(--color-accent)] leading-tight">now</div>}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {/* European day-first range (CLAUDE.md) */}
          <span className="text-[11px] text-[color:var(--color-text-secondary)] tabular-nums">
            {formatDateShort(week.weekStart)}–{formatDateShort(week.weekEnd)}
          </span>
          {week.weekTypeName && (
            <span
              className="text-[length:var(--text-caption)] font-semibold px-1.5 py-0.5 rounded"
              style={{
                // Data-driven colour from the coach's week-type config — kept as
                // authored, never neutralised.
                backgroundColor: `${week.weekTypeColor ?? '#6b7280'}22`,
                color: week.weekTypeColor ?? '#9ca3af',
              }}
            >
              {week.weekTypeName}
            </span>
          )}
        </div>

        {week.events.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {week.events.map(ev => {
              const Icon = getEventTypeIcon(ev.eventType);
              const color = ev.color ?? CAL_EVENT_COLORS[ev.eventType] ?? '#9ca3af';
              return (
                <span key={ev.id} className="inline-flex items-center gap-1 text-[11px]" style={{ color }}>
                  <Icon size={11} className="flex-shrink-0" />
                  <span className={ev.primary ? 'font-semibold' : ''}>{ev.name}</span>
                  <span className="text-[color:var(--color-text-tertiary)]">
                    {formatDateShort(ev.date)}{ev.endDate ? `–${formatDateShort(ev.endDate)}` : ''}
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {week.notes.trim() && (
          <p className="text-[11px] text-[color:var(--color-text-secondary)] mt-1 whitespace-pre-wrap leading-snug">
            {week.notes}
          </p>
        )}
      </div>
      <ChevronRight size={13} className="text-[color:var(--color-text-tertiary)] flex-shrink-0 self-center" aria-hidden />
    </button>
  );
}
