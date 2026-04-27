import { useState, useEffect, useRef } from 'react';

interface DateInputProps {
  /** Internal value in YYYY-MM-DD format (what the DB uses). */
  value: string;
  onChange: (isoDate: string) => void;
  className?: string;
  id?: string;
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
 */
export function DateInput({ value, onChange, className, id }: DateInputProps) {
  const [display, setDisplay] = useState(formatEU(value));
  const [error, setError] = useState(false);
  const prevIso = useRef(value);

  // Sync when the parent changes the ISO value externally
  useEffect(() => {
    if (value !== prevIso.current) {
      setDisplay(formatEU(value));
      setError(false);
      prevIso.current = value;
    }
  }, [value]);

  const handleChange = (raw: string) => {
    // Strip non-digits/slashes then auto-insert slashes
    let digits = raw.replace(/[^\d]/g, '');
    // Limit to 8 digits (ddmmyyyy)
    digits = digits.slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setDisplay(out);

    const iso = parseEU(out);
    if (iso) {
      setError(false);
      if (iso !== prevIso.current) {
        prevIso.current = iso;
        onChange(iso);
      }
    } else {
      // While the user is still typing don't fire invalid value
      setError(out.length === 10); // only show error if they finished typing
      if (out === '') {
        prevIso.current = '';
        onChange('');
      }
    }
  };

  const handleBlur = () => {
    const iso = parseEU(display);
    if (iso) {
      setDisplay(formatEU(iso));
      setError(false);
    } else if (display.length > 0) {
      setError(true);
    }
  };

  const baseClass = className ?? 'w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
  const borderClass = error ? 'border-red-400' : 'border-gray-300';

  return (
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
    />
  );
}
