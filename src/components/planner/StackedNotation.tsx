/**
 * StackedNotation — the canonical EMOS prescription visual.
 *
 * Renders each set line as a column with load on top, a horizontal rule,
 * reps below, and "× N" to the right when more than one set repeats.
 * The default everywhere a prescription is shown, including the coach
 * Log mode and the athlete app.
 *
 *   80  85  90
 *    ─    ─    ─
 *    5    5    3   ×2
 *
 * The companion `LoggedStackedNotation` applies the same visual to
 * actually-performed sets from training_log_sets.
 */
import {
  parsePrescription,
  parseFreeTextPrescription,
  parseComboPrescription,
} from '../../lib/prescriptionParser';
import type { TrainingLogSet } from '../../lib/database.types';

interface StackedNotationProps {
  raw: string | null;
  unit: string | null;
  isCombo?: boolean;
}

const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-primary)',
  fontWeight: 500,
  lineHeight: 1.25,
};

const monoLight: React.CSSProperties = {
  ...mono,
  color: 'var(--color-text-tertiary)',
};

const setMultiplier: React.CSSProperties = {
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-secondary)',
  fontWeight: 500,
  alignSelf: 'center',
  lineHeight: 1,
};

const ruleStyle: React.CSSProperties = {
  width: '100%',
  borderTop: '0.5px solid var(--color-border-primary)',
  margin: '1px 0',
};

const empty: React.CSSProperties = {
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-tertiary)',
  fontStyle: 'italic',
};

const stackColumn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  lineHeight: 1,
  minWidth: '1.5rem',
};

const stackRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const stackPair: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
};

export function StackedNotation({ raw, unit, isCombo }: StackedNotationProps) {
  if (!raw) return null;

  if (unit === 'free_text_reps') {
    const lines = parseFreeTextPrescription(raw);
    if (lines.length === 0) return <span style={empty}>{raw}</span>;
    return (
      <div style={stackRow}>
        {lines.map((line, i) => (
          <div key={i} style={stackPair}>
            <div style={stackColumn}>
              <span style={mono}>{line.loadText}</span>
              <div style={ruleStyle} />
              <span style={mono}>{line.reps}</span>
            </div>
            {line.sets > 1 && <span style={setMultiplier}>×{line.sets}</span>}
          </div>
        ))}
      </div>
    );
  }

  if (isCombo) {
    const lines = parseComboPrescription(raw);
    if (lines.length === 0) return <span style={empty}>{raw}</span>;
    return (
      <div style={stackRow}>
        {lines.map((line, i) => (
          <div key={i} style={stackPair}>
            <div style={stackColumn}>
              <span style={mono}>
                {line.loadMax != null
                  ? `${line.load}-${line.loadMax}${unit === 'percentage' ? '%' : ''}`
                  : `${line.load}${unit === 'percentage' ? '%' : ''}`}
              </span>
              <div style={ruleStyle} />
              <span style={mono}>{line.repsText}</span>
            </div>
            {line.sets > 1 && <span style={setMultiplier}>×{line.sets}</span>}
          </div>
        ))}
      </div>
    );
  }

  const lines = parsePrescription(raw);
  if (lines.length === 0) return <span style={empty}>{raw}</span>;
  return (
    <div style={stackRow}>
      {lines.map((line, i) => (
        <div key={i} style={stackPair}>
          <div style={stackColumn}>
            <span style={mono}>
              {line.loadMax != null
                ? `${line.load}-${line.loadMax}${unit === 'percentage' ? '%' : ''}`
                : `${line.load}${unit === 'percentage' ? '%' : ''}`}
            </span>
            <div style={ruleStyle} />
            <span style={mono}>{line.reps}</span>
          </div>
          {line.sets > 1 && <span style={setMultiplier}>×{line.sets}</span>}
        </div>
      ))}
    </div>
  );
}

interface LoggedStackedNotationProps {
  sets: TrainingLogSet[];
  /** When true, also render skipped / failed sets in greyed style. */
  includeIncomplete?: boolean;
}

/**
 * Stacked-notation rendering for what an athlete actually performed.
 * One column per logged set; load on top, reps below, optional RPE
 * subscript. Sets in 'completed' status render in primary text; skipped
 * / failed sets render dimmed.
 */
export function LoggedStackedNotation({ sets, includeIncomplete = true }: LoggedStackedNotationProps) {
  const visible = sets.filter(s =>
    includeIncomplete ? s.status !== 'pending' : s.status === 'completed',
  );
  if (visible.length === 0) {
    return <span style={empty}>—</span>;
  }
  return (
    <div style={stackRow}>
      {visible.map(s => {
        const dim = s.status !== 'completed';
        const loadStyle = dim ? monoLight : mono;
        const repsStyle = dim ? monoLight : mono;
        return (
          <div key={s.id} style={stackPair} title={s.status}>
            <div style={stackColumn}>
              <span style={loadStyle}>{s.performed_load ?? '?'}</span>
              <div style={ruleStyle} />
              <span style={repsStyle}>{s.performed_reps ?? '?'}</span>
            </div>
            {s.rpe != null && (
              <span style={{ ...setMultiplier, fontSize: 9, color: 'var(--color-text-tertiary)' }}>
                @{s.rpe}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
