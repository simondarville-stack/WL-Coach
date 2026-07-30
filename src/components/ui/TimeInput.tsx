import { useEffect, useRef, useState } from 'react';

interface TimeInputProps {
  /** Internal value in 24-hour HH:mm (what the DB uses). '' when unset.
   *  A Postgres `time` column round-trips as HH:mm:ss — that is accepted and
   *  displayed trimmed to HH:mm. */
  value: string;
  /** Emits HH:mm, or '' when the field is cleared. */
  onChange: (time: string) => void;
  /** Layout classes only — TimeInput owns the border colour so the error and
   *  `invalid` states can't be overridden by a conflicting border-* class. */
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  /** Force the error border from outside (e.g. "this session needs a time"). */
  invalid?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}

/** Trim a stored HH:mm:ss to HH:mm; leave anything else alone. */
function normalizeValue(v: string): string {
  return /^\d{2}:\d{2}:\d{2}$/.test(v) ? v.slice(0, 5) : v;
}

/**
 * Parse what the coach typed into HH:mm, or '' if it isn't a valid time.
 * Deliberately generous — experts type fast and shouldn't have to pad:
 *   "9" → 09:00 · "930" → 09:30 · "9:5" → 09:05 · "1630" → 16:30
 */
export function parseTimeInput(text: string): string {
  const t = text.trim();
  if (!t) return '';

  let hh: string, mm: string;
  const colon = t.indexOf(':');
  if (colon >= 0) {
    hh = t.slice(0, colon);
    mm = t.slice(colon + 1) || '0';
    if (!/^\d{1,2}$/.test(hh) || !/^\d{1,2}$/.test(mm)) return '';
  } else {
    if (!/^\d{1,4}$/.test(t)) return '';
    // 1–2 digits are an hour ("9", "16"); 3–4 digits are hhmm ("930", "1630").
    if (t.length <= 2) { hh = t; mm = '0'; }
    else { hh = t.slice(0, t.length - 2); mm = t.slice(-2); }
  }

  const h = Number(hh), m = Number(mm);
  if (h > 23 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 24-hour time field, EMOS's replacement for `<input type="time">`.
 *
 * The native control renders in the BROWSER's locale, so an en-US profile
 * shows a 12-hour AM/PM field — wrong for this product (see CLAUDE.md: times
 * are 24-hour, `16:00` never `4:00 PM`). This is a plain text field that
 * always reads and writes HH:mm whatever the machine's locale.
 *
 * No dropdown on purpose: for a coach, typing "1630" beats picking from a
 * list. Nothing is rewritten mid-entry — the shorthand is expanded on blur —
 * so the digits never fight the typing.
 */
export function TimeInput({
  value,
  onChange,
  className,
  style,
  id,
  invalid = false,
  placeholder = 'hh:mm',
  'aria-label': ariaLabel,
}: TimeInputProps) {
  const [display, setDisplay] = useState(() => normalizeValue(value));
  const [error, setError] = useState(false);
  const prev = useRef(normalizeValue(value));

  // Sync when the parent changes the value externally (presets, reset, edit).
  useEffect(() => {
    const next = normalizeValue(value);
    if (next !== prev.current) {
      setDisplay(next);
      setError(false);
      prev.current = next;
    }
  }, [value]);

  const emit = (time: string) => {
    if (time !== prev.current) {
      prev.current = time;
      onChange(time);
    }
  };

  const handleChange = (raw: string) => {
    // Digits plus at most one colon. Nothing is reformatted while typing —
    // auto-inserting a colon after two digits would turn "930" into "93:0".
    const cleaned = raw.replace(/[^\d:]/g, '').replace(/:(?=.*:)/g, '').slice(0, 5);
    setDisplay(cleaned);
    setError(false);
    const parsed = parseTimeInput(cleaned);
    if (parsed || cleaned === '') emit(parsed);
  };

  const handleBlur = () => {
    const parsed = parseTimeInput(display);
    if (display.trim() === '') {
      setError(false);
      emit('');
    } else if (parsed) {
      setDisplay(parsed);
      setError(false);
      emit(parsed);
    } else {
      setError(true);
    }
  };

  const showError = error || invalid;
  const layout = className
    ?? 'w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={e => handleChange(e.target.value)}
      onBlur={handleBlur}
      placeholder={placeholder}
      maxLength={5}
      aria-label={ariaLabel}
      aria-invalid={showError || undefined}
      className={`${layout} ${showError ? 'border-red-400' : 'border-gray-300'}`}
      style={style}
    />
  );
}
