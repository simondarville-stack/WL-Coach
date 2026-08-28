/**
 * FieldMacroScreen — the coach's macro cycle, on the phone.
 *
 * The athlete app has a macro tab too, but it is deliberately number-free. The
 * coach standing on the gym floor is exactly the audience for the numbers, so
 * this one carries the per-exercise targets: tap a week to expand the target
 * table for that week (code, top set in stacked notation, avg, Σreps, note).
 *
 * Read-only by construction — no inputs, no writes anywhere in this file.
 * Serves both `/coach/a/:athleteId/macro` and `/coach/g/:groupId/macro`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { describeError } from '../../lib/errorMessage';
import {
  fetchFieldMacros,
  type FieldMacro,
  type FieldMacroExercise,
  type FieldMacroWeek,
} from '../../lib/fieldMacroService';
import { getEventTypeIcon } from '../../lib/eventTypeIcons';
import { CAL_EVENT_COLORS } from '../../lib/eventTypes';
import { formatDateShort } from '../../lib/dateUtils';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { targetMaxRaw } from '../../lib/plannerMacro';
import { StackedNotation } from '../../components/planner/StackedNotation';
import type { MacroPhase } from '../../lib/database.types';

/** Comma decimals, German locale convention (CLAUDE.md). */
const fmt = (v: number | null): string =>
  v == null ? '—' : (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace('.', ',');

export function FieldMacroScreen() {
  const { athleteId, groupId } = useParams<{ athleteId?: string; groupId?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [macros, setMacros] = useState<FieldMacro[] | null>(null);
  const [subjectName, setSubjectName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const thisMonday = getMondayOfWeekISO(new Date());
  const pinnedMacroId = searchParams.get('m');

  const load = useCallback(async () => {
    setError(null);
    try {
      if (athleteId) {
        const { data } = await supabase.from('athletes').select('name').eq('id', athleteId).maybeSingle();
        setSubjectName((data as { name?: string } | null)?.name ?? '');
      } else if (groupId) {
        const { data } = await supabase.from('training_groups').select('name').eq('id', groupId).maybeSingle();
        setSubjectName((data as { name?: string } | null)?.name ?? '');
      }
      const scope = athleteId
        ? ({ type: 'athlete', id: athleteId } as const)
        : groupId
        ? ({ type: 'group', id: groupId } as const)
        : null;
      if (!scope) { setMacros([]); return; }
      const data = await fetchFieldMacros(scope);
      setMacros(data);
      // Open the cycle covering today (or the most recent one), collapse the
      // rest — the same rule the athlete's macro tab uses. `?m=` pins one.
      const current = (pinnedMacroId && data.find(m => m.id === pinnedMacroId))
        || data.find(m => m.startDate <= thisMonday && m.endDate >= thisMonday)
        || data[data.length - 1];
      setCollapsed(new Set(data.filter(m => m.id !== current?.id).map(m => m.id)));
    } catch (e) {
      console.error('[FieldMacroScreen] load failed', e);
      setError(describeError(e));
    }
  }, [athleteId, groupId, thisMonday, pinnedMacroId]);

  useEffect(() => { void load(); }, [load]);

  const openWeek = (weekStart: string) => {
    navigate(athleteId
      ? `/coach/a/${athleteId}?w=${weekStart}`
      : `/coach/g/${groupId}?w=${weekStart}`);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-3 pt-4 pb-8">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 text-gray-400 hover:text-white"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-base font-bold truncate flex-1">{subjectName || 'Macro'}</h1>
          {groupId && <Users size={15} className="text-gray-500 flex-shrink-0" aria-label="Group" />}
        </div>

        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : macros === null ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-gray-600" />
          </div>
        ) : macros.length === 0 ? (
          <p className="text-sm text-gray-500 py-10 text-center">
            No macro cycle for this {groupId ? 'group' : 'athlete'}.
          </p>
        ) : (
          <div className="space-y-3">
            {macros.map(macro => (
              <MacroBlock
                key={macro.id}
                macro={macro}
                thisMonday={thisMonday}
                isCollapsed={collapsed.has(macro.id)}
                onToggle={() => setCollapsed(prev => {
                  const next = new Set(prev);
                  if (next.has(macro.id)) next.delete(macro.id); else next.add(macro.id);
                  return next;
                })}
                onOpenWeek={openWeek}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MacroBlock({ macro, thisMonday, isCollapsed, onToggle, onOpenWeek }: {
  macro: FieldMacro;
  thisMonday: string;
  isCollapsed: boolean;
  onToggle: () => void;
  onOpenWeek: (weekStart: string) => void;
}) {
  const [openWeekId, setOpenWeekId] = useState<string | null>(null);

  // Group consecutive weeks under their phase, so the list reads as blocks of
  // work rather than a flat run. A macro with no phases renders as one run.
  const rows = useMemo(() => {
    const out: Array<{ phase: MacroPhase | null; weeks: FieldMacroWeek[] }> = [];
    for (const week of macro.weeks) {
      const last = out[out.length - 1];
      if (last && last.phase?.id === week.phase?.id) last.weeks.push(week);
      else out.push({ phase: week.phase, weeks: [week] });
    }
    return out;
  }, [macro.weeks]);
  const hasPhases = macro.phases.length > 0;

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-900/60"
        aria-expanded={!isCollapsed}
      >
        {isCollapsed
          ? <ChevronRight size={14} className="text-gray-500 flex-shrink-0" />
          : <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />}
        <span className="text-sm font-semibold text-white truncate">{macro.name}</span>
        {macro.isGroupMacro && (
          <Users size={11} className="text-gray-500 flex-shrink-0" aria-label="Group macro" />
        )}
        <span className="text-[10px] text-gray-500 ml-auto flex-shrink-0">
          {formatDateShort(macro.startDate)}–{formatDateShort(macro.endDate)} · {macro.weeks.length} wk
        </span>
      </button>

      {!isCollapsed && (
        <div className="border-t border-gray-800">
          {rows.map(({ phase, weeks }, i) => (
            <div key={phase?.id ?? `free-${i}`}>
              {hasPhases && (
                <div
                  className="px-3 py-1.5 bg-gray-900/70 border-b border-gray-800"
                  // Phase colour is data, kept as the coach authored it.
                  style={{ borderLeft: `3px solid ${phase?.color || 'transparent'}` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">
                      {phase?.name ?? 'Between phases'}
                    </span>
                    <span className="text-[10px] text-gray-600">
                      {weeks.length} week{weeks.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {/* The coach's phase note — written on the desktop macro page
                      and, until now, rendered nowhere. */}
                  {phase?.notes?.trim() && (
                    <p className="text-[11px] text-gray-400 mt-0.5 whitespace-pre-wrap leading-snug">
                      {phase.notes}
                    </p>
                  )}
                </div>
              )}
              {weeks.map(week => (
                <WeekRow
                  key={week.id}
                  week={week}
                  exercises={macro.exercises}
                  isCurrent={week.weekStart === thisMonday}
                  isOpen={openWeekId === week.id}
                  onToggle={() => setOpenWeekId(id => (id === week.id ? null : week.id))}
                  onOpenWeek={() => onOpenWeek(week.weekStart)}
                />
              ))}
            </div>
          ))}
          {macro.weeks.length === 0 && (
            <p className="px-3 py-4 text-xs text-gray-600">No weeks in this cycle yet.</p>
          )}
        </div>
      )}
    </section>
  );
}

function WeekRow({ week, exercises, isCurrent, isOpen, onToggle, onOpenWeek }: {
  week: FieldMacroWeek;
  exercises: FieldMacroExercise[];
  isCurrent: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onOpenWeek: () => void;
}) {
  const prescribed = exercises.filter(ex => week.targets[ex.trackedExerciseId]);

  return (
    <div className={`border-b border-gray-800/70 last:border-b-0 ${isCurrent ? 'bg-blue-950/40' : ''}`}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-label={`Show targets for training week ${week.weekNumber}`}
          className="flex gap-2.5 px-3 py-2 text-left flex-1 min-w-0 hover:bg-gray-800/40 active:bg-gray-800/60 transition-colors"
        >
          <div className="w-9 flex-shrink-0 pt-0.5">
            <div className={`text-xs font-semibold ${isCurrent ? 'text-blue-300' : 'text-gray-300'}`}>
              W{week.weekNumber}
            </div>
            {isCurrent && <div className="text-[9px] text-blue-400 leading-tight">now</div>}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {/* European day-first range (CLAUDE.md) */}
              <span className="text-[11px] text-gray-400 tabular-nums">
                {formatDateShort(week.weekStart)}–{formatDateShort(week.weekEnd)}
              </span>
              {week.weekTypeName && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: `${week.weekTypeColor ?? '#6b7280'}22`,
                    color: week.weekTypeColor ?? '#9ca3af',
                  }}
                >
                  {week.weekTypeName}
                </span>
              )}
              {prescribed.length > 0 && (
                <span className="text-[10px] text-gray-600">{prescribed.length} ex</span>
              )}
            </div>

            {/* Week-level targets — only what the coach actually set. */}
            {(week.totalRepsTarget != null || week.tonnageTarget != null || week.avgIntensityTarget != null) && (
              <div className="flex gap-3 mt-0.5 text-[10px] text-gray-500 tabular-nums">
                {week.totalRepsTarget != null && <span>Σr {week.totalRepsTarget}</span>}
                {week.tonnageTarget != null && <span>t {fmt(week.tonnageTarget)}</span>}
                {week.avgIntensityTarget != null && <span>avg {fmt(week.avgIntensityTarget)}%</span>}
              </div>
            )}

            {week.events.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {week.events.map(ev => {
                  const Icon = getEventTypeIcon(ev.eventType);
                  const color = ev.color ?? CAL_EVENT_COLORS[ev.eventType] ?? '#9ca3af';
                  return (
                    <span key={ev.id} className="inline-flex items-center gap-1 text-[11px]" style={{ color }}>
                      <Icon size={11} className="flex-shrink-0" />
                      <span className={ev.primary ? 'font-semibold' : ''}>{ev.title}</span>
                      <span className="text-gray-600">
                        {formatDateShort(ev.date)}{ev.endDate ? `–${formatDateShort(ev.endDate)}` : ''}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}

            {week.notes.trim() && (
              <p className="text-[11px] text-gray-400 mt-1 whitespace-pre-wrap leading-snug">
                {week.notes}
              </p>
            )}
          </div>
          {isOpen
            ? <ChevronDown size={13} className="text-gray-600 flex-shrink-0 self-center" aria-hidden />
            : <ChevronRight size={13} className="text-gray-600 flex-shrink-0 self-center" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={onOpenWeek}
          aria-label={`Open the plan for the week of ${formatDateShort(week.weekStart)}`}
          title="Open this week's plan"
          className="px-3 text-[10px] uppercase tracking-wide text-gray-600 hover:text-blue-300 border-l border-gray-800/70"
        >
          plan
        </button>
      </div>

      {isOpen && (
        prescribed.length === 0 ? (
          <p className="px-3 pb-2 text-[11px] text-gray-600 italic">No targets set for this week.</p>
        ) : (
          <table className="w-full text-[11px] mb-1">
            <thead>
              <tr className="text-[9px] uppercase tracking-wide text-gray-600">
                <th className="text-left font-medium px-3 py-1">Exercise</th>
                <th className="text-right font-medium px-1 py-1">Top set</th>
                <th className="text-right font-medium px-1 py-1">Avg</th>
                <th className="text-right font-medium px-3 py-1">Σr</th>
              </tr>
            </thead>
            <tbody>
              {prescribed.map(ex => {
                const t = week.targets[ex.trackedExerciseId];
                const raw = targetMaxRaw(t.max, t.repsAtMax, t.setsAtMax);
                return (
                  <tr key={ex.trackedExerciseId} className="border-t border-gray-800/50 align-top">
                    <td className="px-3 py-1">
                      {ex.code && <span className="font-mono text-gray-300 mr-1.5">{ex.code}</span>}
                      <span className="text-gray-400">{ex.name}</span>
                      {t.note?.trim() && (
                        <div className="text-[10px] text-gray-500 italic leading-snug">✎ {t.note}</div>
                      )}
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex justify-end">
                        {raw
                          ? <StackedNotation raw={raw} unit="absolute_kg" />
                          : <span className="text-gray-600">—</span>}
                      </div>
                    </td>
                    <td className="px-1 py-1 text-right tabular-nums text-gray-400">{fmt(t.avg)}</td>
                    <td className="px-3 py-1 text-right tabular-nums text-gray-300">{t.reps ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
