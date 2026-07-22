/**
 * CalendarPopover — EMOS's own month calendar.
 *
 * Replaces the native `<input type="date">` picker, which renders in the
 * BROWSER's locale: on an en-US profile that means a Sunday-first grid and
 * MM/DD/YYYY, which is wrong for this product (see CLAUDE.md — European
 * standards, weeks start Monday). This grid is Monday-first and day-first
 * regardless of the machine's locale, and carries the ISO week number,
 * which is the unit coaches actually plan in.
 *
 * All date maths goes through the UTC-consistent ISO helpers in dateUtils —
 * local-time Date arithmetic is what produced the off-by-one week_start rows
 * in production.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getISOWeek, isoAddDays, isoMonday, toLocalISO } from '../../lib/dateUtils';

/** Monday-first weekday initials. Fixed, not locale-derived. */
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface CalendarPopoverProps {
  /** Selected date, YYYY-MM-DD, or '' when none. */
  value: string;
  onSelect: (isoDate: string) => void;
  onClose: () => void;
  /** Clicking any day selects that week's Monday, and the whole week
   *  highlights — for Monday-aligned fields like macro start/end. */
  snapToMonday?: boolean;
  /** Render above the input instead of below (near the viewport bottom). */
  flipUp?: boolean;
}

/** ISO date of the 1st of the month containing `iso`. */
function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function addMonths(iso: string, delta: number): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) - 1 + delta;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

export function CalendarPopover({
  value,
  onSelect,
  onClose,
  snapToMonday = false,
  flipUp = false,
}: CalendarPopoverProps) {
  const today = toLocalISO(new Date());
  const [cursor, setCursor] = useState(() => firstOfMonth(value || today));
  const [hoverWeek, setHoverWeek] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Follow the field when the value is changed from outside (typing).
  useEffect(() => {
    if (value) setCursor(firstOfMonth(value));
  }, [value]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Six Monday-anchored rows covering the whole month — a fixed height keeps
  // the popover from jumping as the coach pages through months.
  const weeks = useMemo(() => {
    const start = isoMonday(cursor);
    return Array.from({ length: 6 }, (_, w) => {
      const monday = isoAddDays(start, w * 7);
      return {
        monday,
        weekNumber: getISOWeek(new Date(monday + 'T00:00:00')),
        days: Array.from({ length: 7 }, (_, d) => isoAddDays(monday, d)),
      };
    });
  }, [cursor]);

  const selectedMonday = value ? isoMonday(value) : null;
  const cursorMonth = cursor.slice(0, 7);

  const pick = (iso: string) => {
    onSelect(snapToMonday ? isoMonday(iso) : iso);
    onClose();
  };

  const navBtn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
    color: 'var(--color-text-tertiary)', display: 'inline-flex', borderRadius: 'var(--radius-sm)',
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Choose a date"
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        zIndex: 60,
        left: 0,
        ...(flipUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
        padding: 8,
        width: 236,
        userSelect: 'none',
      }}
    >
      {/* Month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <button type="button" style={navBtn} onClick={() => setCursor(c => addMonths(c, -1))} aria-label="Previous month">
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {MONTHS[Number(cursor.slice(5, 7)) - 1]} {cursor.slice(0, 4)}
        </span>
        <button type="button" style={navBtn} onClick={() => setCursor(c => addMonths(c, 1))} aria-label="Next month">
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Weekday header — W column + Monday-first days */}
      <div style={{ display: 'grid', gridTemplateColumns: '22px repeat(7, 1fr)', gap: 1, marginBottom: 2 }}>
        <span
          title="ISO week number"
          style={{ fontSize: 9, textAlign: 'center', color: 'var(--color-text-tertiary)', lineHeight: '18px' }}
        >
          W
        </span>
        {WEEKDAYS.map(d => (
          <span
            key={d}
            style={{ fontSize: 9, textAlign: 'center', color: 'var(--color-text-tertiary)', lineHeight: '18px' }}
          >
            {d}
          </span>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '22px repeat(7, 1fr)', gap: 1 }}>
        {weeks.map(week => {
          const weekActive =
            snapToMonday && (hoverWeek === week.monday || selectedMonday === week.monday);
          return (
            <div key={week.monday} style={{ display: 'contents' }}>
              <button
                type="button"
                onClick={() => pick(week.monday)}
                onMouseEnter={() => setHoverWeek(week.monday)}
                onMouseLeave={() => setHoverWeek(null)}
                title={`Week ${week.weekNumber} — starts Monday ${week.monday.slice(8)}/${week.monday.slice(5, 7)}`}
                style={{
                  fontSize: 9, lineHeight: '22px', height: 22, textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                  background: weekActive ? 'var(--color-accent-muted)' : 'transparent',
                  color: 'var(--color-text-tertiary)',
                  border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: 0,
                }}
              >
                {week.weekNumber}
              </button>
              {week.days.map(day => {
                const isSelected = snapToMonday ? false : day === value;
                const isToday = day === today;
                const inMonth = day.slice(0, 7) === cursorMonth;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => pick(day)}
                    onMouseEnter={() => setHoverWeek(week.monday)}
                    onMouseLeave={() => setHoverWeek(null)}
                    aria-current={isToday ? 'date' : undefined}
                    style={{
                      fontSize: 11, lineHeight: '22px', height: 22, textAlign: 'center',
                      fontVariantNumeric: 'tabular-nums',
                      background: isSelected
                        ? 'var(--color-accent)'
                        : weekActive
                          ? 'var(--color-accent-muted)'
                          : 'transparent',
                      color: isSelected
                        ? '#fff'
                        : inMonth
                          ? 'var(--color-text-primary)'
                          : 'var(--color-text-tertiary)',
                      fontWeight: isToday ? 700 : 400,
                      boxShadow: isToday && !isSelected ? 'inset 0 0 0 1px var(--color-border-secondary)' : 'none',
                      border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: 0,
                    }}
                  >
                    {Number(day.slice(8))}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer shortcuts */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <button
          type="button"
          onClick={() => pick(today)}
          style={{
            fontSize: 10, background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-accent)', padding: 0,
          }}
        >
          {snapToMonday ? 'This week' : 'Today'}
        </button>
        {snapToMonday && (
          <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>snaps to Monday</span>
        )}
      </div>
    </div>
  );
}
