import { useState, useEffect, useRef } from 'react';
import { Calendar } from 'lucide-react';

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
 * A calendar icon opens the native browser date picker.
 */
export function DateInput({ value, onChange, className, id }: DateInputProps) {
  const [display, setDisplay] = useState(formatEU(value));
  const [error, setError] = useState(false);
  const prevIso = useRef(value);
  const nativeDateRef = useRef<HTMLInputElement>(null);

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
      if (iso !== prevIso.current) {
        prevIso.current = iso;
        onChange(iso);
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
      setDisplay(formatEU(iso));
      setError(false);
    } else if (display.length > 0) {
      setError(true);
    }
  };

  const handleNativePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const iso = e.target.value; // YYYY-MM-DD
    if (iso) {
      prevIso.current = iso;
      setDisplay(formatEU(iso));
      setError(false);
      onChange(iso);
    }
  };

  const openPicker = () => {
    const el = nativeDateRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.click();
    }
  };

  const baseClass = className ?? 'w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
  const borderClass = error ? 'border-red-400' : 'border-gray-300';

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
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
      >
        <Calendar size={13} />
      </button>
      {/* Hidden native date input — used only to show the browser calendar */}
      <input
        ref={nativeDateRef}
        type="date"
        value={value}
        onChange={handleNativePick}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          width: 0,
          height: 0,
          right: 0,
          top: 0,
        }}
      />
    </div>
  );
}
