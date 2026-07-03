/**
 * UnitPickerSheet — pick one training unit (week + slot) to attach a
 * message thread to.
 *
 * Lists the athlete's units for a week with ‹ › week navigation:
 * label, scheduled weekday + date, planned exercise count, and log
 * status, so the coach can tell units apart at a glance. Picking a
 * unit hands back everything the caller needs to open (or lazily
 * create) that unit's session thread.
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Paperclip, X } from 'lucide-react';
import { fetchWeekOverview, type WeekOverview } from '../../lib/trainingLogService';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO, formatDateShort, toLocalISO } from '../../lib/dateUtils';

export interface PickedUnit {
  weekStart: string;
  dayIndex: number;
  label: string;
  /** Calendar date to stamp on a freshly created session: the logged
   *  date when one exists, else the scheduled weekday's date, else
   *  today (unassigned slot — same fallback the drill-in screens use). */
  date: string;
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  completed: { text: 'completed', tone: 'text-emerald-400' },
  in_progress: { text: 'in progress', tone: 'text-blue-400' },
  skipped: { text: 'skipped', tone: 'text-orange-400' },
};

export function UnitPickerSheet({
  athleteId,
  onPick,
  onClose,
}: {
  athleteId: string;
  onPick: (unit: PickedUnit) => void;
  onClose: () => void;
}) {
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeekISO(new Date()));
  const [overview, setOverview] = useState<WeekOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const ov = await fetchWeekOverview(athleteId, weekStart);
        if (alive) setOverview(ov);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [athleteId, weekStart]);

  const shiftWeek = (deltaDays: number) => setWeekStart(w => addDaysToISO(w, deltaDays));
  const isCurrentWeek = weekStart === getMondayOfWeekISO(new Date());

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" role="dialog" aria-label="Attach a training unit">
      <button
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close"
        tabIndex={-1}
      />
      <div className="relative bg-gray-900 border-t border-gray-800 rounded-t-2xl max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-800">
          <div className="text-[13px] font-semibold text-white flex items-center gap-1.5">
            <Paperclip size={13} className="text-gray-500" />
            Attach a training unit
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-800 text-gray-400"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/70">
          <button
            onClick={() => shiftWeek(-7)}
            className="p-1.5 text-gray-500 hover:text-gray-300"
            aria-label="Previous week"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-[11px] text-gray-400">
            Week of {formatDateShort(weekStart)}
            {isCurrentWeek && <span className="text-blue-400"> · this week</span>}
          </span>
          <button
            onClick={() => shiftWeek(7)}
            className="p-1.5 text-gray-500 hover:text-gray-300"
            aria-label="Next week"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 min-h-[140px] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-500 text-xs gap-1.5">
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          ) : error ? (
            <p className="text-[11px] text-red-400 px-1 py-4">{error}</p>
          ) : !overview || overview.days.length === 0 ? (
            <p className="text-[11px] text-gray-500 text-center py-8">
              No training units in this week.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {overview.days.map(d => {
                const date =
                  d.sessionDate
                  ?? (d.weekday != null ? addDaysToISO(weekStart, d.weekday) : toLocalISO(new Date()));
                const status = STATUS_LABEL[d.status] ?? null;
                return (
                  <button
                    key={d.dayIndex}
                    onClick={() => onPick({ weekStart, dayIndex: d.dayIndex, label: d.label, date })}
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-left active:bg-gray-800/60"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-white truncate">
                        {d.label}
                        {d.isBonus && (
                          <span className="text-[9px] text-gray-500 font-normal"> · athlete-added</span>
                        )}
                      </span>
                      <span className="text-[10px] text-gray-500 shrink-0">
                        {d.weekday != null && `${WEEKDAY_SHORT[d.weekday]} `}
                        {formatDateShort(date)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-[10px] mt-0.5">
                      <span className="text-gray-500">
                        {d.plannedCount > 0
                          ? `${d.plannedCount} exercise${d.plannedCount === 1 ? '' : 's'}`
                          : 'no plan'}
                      </span>
                      {status && <span className={status.tone}>{status.text}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
