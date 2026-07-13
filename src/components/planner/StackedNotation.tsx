/**
 * StackedNotation — the canonical EMOS prescription visual.
 *
 * Renders each set line as a column with load on top, a horizontal rule,
 * reps below, and a small set-count number to the right when more than
 * one set repeats. The default everywhere a prescription is shown,
 * including the coach Log mode and the athlete app.
 *
 *   80  85  90
 *    ─    ─    ─
 *    5    5    3   2
 *
 * Free-text prescriptions (`unit === 'free_text_reps'`) bypass the
 * column layout entirely — the coach typed prose, so render it as prose.
 *
 * The companion `LoggedStackedNotation` applies the same column visual
 * to actually-performed sets from training_log_sets.
 */
import {
  parsePrescription,
  parseComboPrescription,
  parseFreeTextPrescription,
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
  color: 'var(--color-text-primary)',
  fontWeight: 500,
  whiteSpace: 'pre-wrap',
  lineHeight: 1.4,
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

  // Combo must win against the free-text-reps unit branch:
  // parseComboPrescription handles free-text loads ("Heavy×2+1×3")
  // AND preserves the tuple reps_text ("2+1"). Falling into the
  // non-combo free-text parser strips the tuple and breaks the visual.
  if (isCombo) {
    const lines = parseComboPrescription(raw);
    if (lines.length === 0) return <span style={empty}>{raw}</span>;
    const isFreeTextReps = unit === 'free_text_reps';
    return (
      <div style={stackRow}>
        {lines.map((line, i) => (
          <div key={i} style={stackPair}>
            <div style={stackColumn}>
              <span style={mono}>
                {isFreeTextReps && line.loadText
                  ? line.loadText
                  : line.loadMax != null
                  ? `${line.load}-${line.loadMax}${unit === 'percentage' ? '%' : ''}`
                  : `${line.load}${unit === 'percentage' ? '%' : ''}`}
              </span>
              <div style={ruleStyle} />
              <span style={mono}>
                {line.multiplier != null ? `${line.multiplier}(${line.repsText})` : line.repsText}
              </span>
            </div>
            {line.sets > 1 && <span style={setMultiplier}>{line.sets}</span>}
          </div>
        ))}
      </div>
    );
  }

  if (unit === 'free_text_reps') {
    // Render the same stacked-column visual as numeric prescriptions:
    // free-text load on top, parsed reps below, "× N" sets suffix.
    // Falls back to raw prose when nothing parses (e.g. coach typed
    // an unstructured note in this mode).
    const lines = parseFreeTextPrescription(raw);
    if (lines.length === 0) {
      return (
        <span
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-primary)',
            fontWeight: 500,
            whiteSpace: 'pre-wrap',
            lineHeight: 1.4,
          }}
        >
          {raw}
        </span>
      );
    }
    return (
      <div style={stackRow}>
        {lines.map((line, i) => (
          <div key={i} style={stackPair}>
            <div style={stackColumn}>
              <span style={mono}>{line.loadText}</span>
              <div style={ruleStyle} />
              <span style={mono}>{line.reps}</span>
            </div>
            {line.sets > 1 && <span style={setMultiplier}>{line.sets}</span>}
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
          {line.sets > 1 && <span style={setMultiplier}>{line.sets}</span>}
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
 * subscript.
 *
 * Colour is intentionally minimal: completed sets render in primary text,
 * skipped / failed sets render dimmed grey. We do NOT tint per cell by
 * performed-vs-planned (green/red) — at per-set granularity it read as a
 * messy rainbow and over-the-plan green falsely signalled "good". The
 * planned/actual comparison lives in the PlanActual summary strip instead.
 */
export function LoggedStackedNotation({ sets, includeIncomplete = true }: LoggedStackedNotationProps) {
  const visible = sets.filter(s =>
    includeIncomplete ? s.status !== 'pending' : s.status === 'completed',
  );
  if (visible.length === 0) {
    return <span style={empty}>—</span>;
  }

  // Free-text completion: when every visible set carries no numeric load
  // and no numeric reps, the exercise was a prose/note prescription and
  // the kg-over-reps grid would just render "?/?" for every column. Show
  // the athlete's prose (performed_text) if they typed any, otherwise a
  // simple done marker. Mirrors the coach-side log so both surfaces stop
  // showing meaningless question marks for note-style exercises.
  const allNonNumeric = visible.every(
    s => s.performed_load == null && s.performed_reps == null,
  );
  if (allNonNumeric) {
    const texts = visible
      .map(s => s.performed_text?.trim() || s.notes?.trim() || '')
      .filter(t => t.length > 0);
    if (texts.length > 0) {
      return (
        <span
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-primary)',
            fontStyle: 'italic',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.4,
          }}
        >
          {texts.join(' · ')}
        </span>
      );
    }
    const anyCompleted = visible.some(s => s.status === 'completed');
    return (
      <span
        style={{
          fontSize: 'var(--text-caption)',
          color: anyCompleted ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
          fontStyle: 'italic',
        }}
      >
        {anyCompleted ? '✓ Done' : 'Skipped'}
      </span>
    );
  }

  return (
    <div style={stackRow}>
      {visible.map(s => {
        const dim = s.status !== 'completed';
        // Completed → primary text; skipped/failed → dimmed grey. No
        // per-cell performed-vs-planned tint (see component doc).
        const loadStyle = dim ? monoLight : mono;
        const repsStyle = dim ? monoLight : mono;
        // Athlete may have typed tuple notation like "2+2+2" for a combo;
        // when present, performed_text holds the raw string and the coach
        // sees what was actually logged instead of just the numeric sum.
        // A not-completed set with no reps is a missed attempt → show "x"
        // (an unsuccessful lift at the shown load), not a "?".
        const repsDisplay =
          s.performed_text ??
          (s.performed_reps != null
            ? String(s.performed_reps)
            : s.status === 'completed'
            ? '?'
            : 'x');
        return (
          <div key={s.id} style={stackPair} title={s.status}>
            <div style={stackColumn}>
              <span style={loadStyle}>{s.performed_load ?? '?'}</span>
              <div style={ruleStyle} />
              <span style={repsStyle}>{repsDisplay}</span>
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
