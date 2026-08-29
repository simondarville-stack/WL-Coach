/**
 * CustomMetricField — one coach-defined metric input.
 *
 * Numeric metrics render a numeric input + optional unit suffix; text
 * metrics render a textarea. Commits on blur to keep round-trips low.
 */
import { useEffect, useState } from 'react';
import type {
  AthleteMetricDefinition,
  CustomMetricEntry,
} from '../../../lib/database.types';

interface CustomMetricFieldProps {
  definition: AthleteMetricDefinition;
  value: CustomMetricEntry | undefined;
  onChange: (next: CustomMetricEntry | null) => void | Promise<void>;
}

export function CustomMetricField({ definition, value, onChange }: CustomMetricFieldProps) {
  const initial = readValue(value);
  const [local, setLocal] = useState(initial);
  useEffect(() => { setLocal(readValue(value)); }, [value]);

  const commit = () => {
    if (local.trim() === '') {
      void onChange(null);
      return;
    }
    if (definition.value_type === 'number') {
      const parsed = parseFloat(local.replace(',', '.'));
      if (!Number.isFinite(parsed)) {
        void onChange(null);
        return;
      }
      void onChange({ value_number: parsed });
    } else {
      void onChange({ value_text: local });
    }
  };

  return (
    <div className="rounded-xl bg-[var(--color-bg-primary)] border border-[color:var(--color-border-tertiary)] p-3">
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-[11px] uppercase tracking-wide text-[color:var(--color-text-secondary)] font-semibold">
          {definition.label}
        </label>
        {definition.unit && (
          <span className="text-[length:var(--text-caption)] text-[color:var(--color-text-secondary)]">{definition.unit}</span>
        )}
      </div>
      {definition.value_type === 'number' ? (
        <input
          type="text"
          inputMode="decimal"
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="—"
          className="w-full bg-[var(--color-bg-secondary)] border border-[color:var(--color-border-secondary)] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[color:var(--color-accent-hover)]"
        />
      ) : (
        <textarea
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={commit}
          placeholder="—"
          rows={2}
          className="w-full bg-[var(--color-bg-secondary)] border border-[color:var(--color-border-secondary)] rounded px-2 py-1.5 text-sm text-white placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none focus:border-[color:var(--color-accent-hover)] resize-none"
        />
      )}
    </div>
  );
}

function readValue(value: CustomMetricEntry | undefined): string {
  if (!value) return '';
  if ('value_number' in value && value.value_number != null) return String(value.value_number);
  if ('value_text' in value && value.value_text != null) return value.value_text;
  return '';
}
