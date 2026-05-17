import { useEffect, useState } from 'react';

interface BodyweightFieldProps {
  value: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
}

export function BodyweightField({ value, onChange, disabled }: BodyweightFieldProps) {
  const [text, setText] = useState(value != null ? value.toFixed(1) : '');

  useEffect(() => {
    setText(value != null ? value.toFixed(1) : '');
  }, [value]);

  const commit = () => {
    if (text.trim() === '') {
      onChange(null);
      return;
    }
    // Accept comma decimals per German locale; normalise to dot before parse.
    const normalised = text.replace(',', '.');
    const parsed = parseFloat(normalised);
    if (Number.isFinite(parsed) && parsed > 0) {
      onChange(parsed);
    } else {
      setText(value != null ? value.toFixed(1) : '');
    }
  };

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-3">
      <label className="block text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
        Bodyweight
      </label>
      <div className="flex items-baseline gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          disabled={disabled}
          placeholder="—"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-lg font-semibold focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <span className="text-xs text-gray-500">kg</span>
      </div>
    </div>
  );
}
