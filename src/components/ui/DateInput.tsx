import { useState, useEffect, useRef } from 'react';
import { Calendar } from 'lucide-react';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { CalendarPopover } from './CalendarPopover';

interface DateInputProps {
  /** Internal value in YYYY-MM-DD format (what the DB uses). */
  value: string;
  onChange: (isoDate: string) => void;
  className?: string;
  id?: string;
  /** When true, any chosen date snaps to the Monday of its week (EMOS weeks
   *  start Monday). Used for macro start/end dates so cycles stay Monday-aligned. */
  snapToMonday?: boolean;
}

/** Parse dd/mm/yyyy → YYYY-MM-DD. Returns '' if invalid. */
function parseEU(text: string): string {
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  const d = Number(dd), mo = Number(mm), y = Number(yyyy);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return '';
  return `${yyyy}-${mm}-${dd}`;
}

/** Format YYYY-MM-DD → dd/mm/yyyy. */
function formatEU(iso: string): string {
  if (!iso) return '';
  const [yyyy, mm, dd] = iso.split('-');
  if (!yyyy || !mm || !dd) return iso;
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Text input that shows dates in dd/mm/yyyy and emits YYYY-MM-DD via onChange.
 * Auto-inserts slashes after day and month digits.
 *
 * The calendar icon opens EMOS's own Monday-first CalendarPopover rather than
 * the native browser picker — the native one follows the BROWSER's locale, so
 * on an en-US profile it rendered a Sunday-first grid with US date order.
 */
export function DateInput({ value, onChange, className, id, snapToMonday = false }: DateInputProps) {
  const [display, setDisplay] = useState(formatEU(value));
  const [error, setError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const prevIso = useRef(value);
  const wrapRef = useRef<HTMLDivElement>(null);

  /** Snap an ISO date to the Monday of its week when snapToMonday is on. */
  const maybeSnap = (iso: string): string =>
    snapToMonday && iso ? getMondayOfWeekISO(new Date(iso + 'T00:00:00')) : iso;

  // Sync when the parent changes the ISO value externally
  useEffect(() => {
    if (value !== prevIso.current) {
      setDisplay(formatEU(value));
      setError(false);
      prevIso.current = value;
    }
  }, [value]);

  const handleChange = (raw: string) => {
    let digits = raw.replace(/[^\d]/g, '');
    digits = digits.slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setDisplay(out);

    const iso = parseEU(out);
    if (iso) {
      setError(false);
      // Emit the (possibly Monday-snapped) value; keep the display as typed
      // until blur so snapping doesn't rewrite digits mid-entry.
      const snapped = maybeSnap(iso);
      if (snapped !== prevIso.current) {
        prevIso.current = snapped;
        onChange(snapped);
      }
    } else {
      setError(out.length === 10);
      if (out === '') {
        prevIso.current = '';
        onChange('');
      }
    }
  };

  const handleBlur = () => {
    const iso = parseEU(display);
    if (iso) {
      const snapped = maybeSnap(iso);
      setDisplay(formatEU(snapped));
      setError(false);
      if (snapped !== prevIso.current) {
        prevIso.current = snapped;
        onChange(snapped);
      }
    } else if (display.length > 0) {
      setError(true);
    }
  };

  /** Commit a date chosen in the calendar grid. */
  const handleCalendarPick = (picked: string) => {
    const iso = maybeSnap(picked);
    if (!iso) return;
    prevIso.current = iso;
    setDisplay(formatEU(iso));
    setError(false);
    onChange(iso);
  };

  const openPicker = () => {
    // Flip above the field when there isn't room for the grid below it
    // (the calendar is ~250 px tall).
    const rect = wrapRef.current?.getBoundingClientRect();
    setFlipUp(!!rect && window.innerHeight - rect.bottom < 260 && rect.top > 260);
    setPickerOpen(open => !open);
  };

  const baseClass = className ?? 'w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
  const borderClass = error ? 'border-red-400' : 'border-gray-300';

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={e => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="dd/mm/yyyy"
        maxLength={10}
        className={`${baseClass} ${borderClass}`}
        style={{ paddingRight: '2rem' }}
      />
      <button
        type="button"
        onClick={openPicker}
        tabIndex={-1}
        style={{
          position: 'absolute',
          right: '6px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          color: 'var(--color-text-tertiary)',
          display: 'flex',
          alignItems: 'center',
        }}
        aria-label="Open date picker"
        aria-expanded={pickerOpen}
      >
        <Calendar size={13} />
      </button>
      {pickerOpen && (
        <CalendarPopover
          value={value}
          onSelect={handleCalendarPick}
          onClose={() => setPickerOpen(false)}
          snapToMonday={snapToMonday}
          flipUp={flipUp}
        />
      )}
    </div>
  );
}
