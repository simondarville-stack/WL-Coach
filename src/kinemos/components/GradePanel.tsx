/**
 * GradePanel — how far to trust the numbers above it.
 *
 * This replaces P1's honest placeholder with the real thing. The design doc
 * calls the grade "the product's honesty mechanism" (§6.4), and a letter on its
 * own is not that: what makes it honest is the error estimate behind it, the
 * conditions that produced it, and — the part most tools skip — what would
 * actually improve it.
 *
 * The verdict on every row is a word as well as a colour. Colour may never be
 * the only carrier of meaning (design brief, hard conventions), and here it
 * matters twice over: "weak" and "good" are not obvious from hue alone to a
 * coach glancing at a rail on a bright platform.
 */
import { useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Select } from '../../components/ui';
import type { CameraStability, QualityGrade } from '../engine/grade';
import { num } from '../lib/viewerFormat';

interface GradePanelProps {
  grade: QualityGrade;
  camera: CameraStability;
  onCamera: (camera: CameraStability) => void;
}

const CAMERA_OPTIONS: Array<{ value: CameraStability; label: string }> = [
  { value: 'unknown', label: 'Not recorded' },
  { value: 'tripod', label: 'Tripod or bench' },
  { value: 'stabilised', label: 'Handheld, stabilised' },
  { value: 'handheld', label: 'Handheld' },
];

export function GradePanel({ grade, camera, onCamera }: GradePanelProps) {
  // Collapsed by default. The verdict and what to do about it are what a coach
  // reads; the seven conditions behind it are what they read once, when the
  // verdict surprises them. Four panels stacked in a 304 px rail put the
  // summary below the fold otherwise — which hides exactly the sentence the
  // grade exists to deliver.
  const [showFactors, setShowFactors] = useState(false);

  return (
    <section style={{ ...section, borderBottom: 'none' }}>
      <header style={header}>
        <span style={label}>HOW FAR TO TRUST THIS</span>
        {/* The letter, not the pill. The pill lives in the viewer header where
            it is the glanceable summary; repeating the same object here would
            read as a second, separate grade rather than as this section's
            heading. */}
        <span
          style={{
            fontSize: 'var(--text-caption)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: gradeText(grade.grade),
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {grade.grade === null ? 'ungraded' : `Grade ${grade.grade}`}
          {grade.expectedVelocityErrorMs !== null &&
            ` · ±${num(grade.expectedVelocityErrorMs, 2)} m/s`}
        </span>
      </header>

      <button
        type="button"
        onClick={() => setShowFactors(current => !current)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: 'var(--color-text-secondary)',
          fontFamily: 'inherit',
          fontSize: 'var(--text-caption)',
          cursor: 'pointer',
        }}
      >
        {showFactors ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {showFactors ? 'Hide the conditions' : `What it is built from (${grade.factors.length})`}
      </button>

      <dl style={{ margin: 0, display: showFactors ? 'grid' : 'none', gap: 2 }}>
        {grade.factors.map(factor => (
          <div
            key={factor.id}
            title={factor.why}
            style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}
          >
            <dt style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
              {factor.label}
            </dt>
            <dd style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 'var(--text-label)', fontVariantNumeric: 'tabular-nums' }}>
                {factor.value}
              </span>
              <span
                style={{
                  width: 34,
                  textAlign: 'right',
                  fontSize: 'var(--text-micro)',
                  fontWeight: 600,
                  color: toneOf(factor.verdict),
                }}
              >
                {factor.verdict}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <label style={{ display: showFactors ? 'block' : 'none', marginTop: 'var(--space-sm)' }}>
        <span style={{ ...label, display: 'block', marginBottom: 2 }}>HOW IT WAS FILMED</span>
        <Select
          value={camera}
          onChange={e => onCamera(e.target.value as CameraStability)}
          style={{ width: '100%' }}
        >
          {CAMERA_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>

      <p
        style={{
          margin: 'var(--space-sm) 0 0',
          padding: 'var(--space-sm)',
          borderRadius: 'var(--radius-sm)',
          background: gradeBackground(grade.grade),
          color: gradeText(grade.grade),
          fontSize: 'var(--text-caption)',
          lineHeight: 1.4,
        }}
      >
        {grade.summary}
      </p>

      {grade.improvements.length > 0 && (
        <>
          <p style={{ ...hint, marginBottom: 4 }}>What would move it:</p>
          <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 3 }}>
            {grade.improvements.map(text => (
              <li
                key={text}
                style={{
                  fontSize: 'var(--text-caption)',
                  lineHeight: 1.4,
                  color: 'var(--color-text-secondary)',
                }}
              >
                {text}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The chip that also appears in the viewer header. Exported so both places
 *  render the same object rather than two similar ones. */
export function GradeChip({ grade }: { grade: QualityGrade }) {
  const letter = grade.grade;
  return (
    <span
      title={grade.summary}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        padding: '0 8px',
        borderRadius: 'var(--radius-sm)',
        background: gradeBackground(letter),
        color: gradeText(letter),
        fontSize: 'var(--text-micro)',
        fontWeight: 600,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {letter === null ? 'NOT GRADED' : `GRADE ${letter}`}
      {grade.expectedVelocityErrorMs !== null && (
        <span style={{ fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>
          {`±${num(grade.expectedVelocityErrorMs, 2)} m/s`}
        </span>
      )}
    </span>
  );
}

function toneOf(verdict: 'good' | 'fair' | 'weak'): string {
  return verdict === 'good'
    ? 'var(--color-success-text)'
    : verdict === 'fair'
      ? 'var(--color-warning-text)'
      : 'var(--color-danger-text)';
}

function gradeBackground(letter: 'A' | 'B' | 'C' | null): string {
  if (letter === 'A') return 'var(--color-success-bg)';
  if (letter === 'B') return 'var(--color-warning-bg)';
  if (letter === 'C') return 'var(--color-danger-bg)';
  return 'var(--color-bg-secondary)';
}

function gradeText(letter: 'A' | 'B' | 'C' | null): string {
  if (letter === 'A') return 'var(--color-success-text)';
  if (letter === 'B') return 'var(--color-warning-text)';
  if (letter === 'C') return 'var(--color-danger-text)';
  return 'var(--color-text-tertiary)';
}

const section: CSSProperties = {
  padding: 'var(--space-md)',
  borderBottom: '1px solid var(--color-border-tertiary)',
};

const header: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 'var(--space-sm)',
};

const label: CSSProperties = {
  fontSize: 'var(--text-caption)',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
};

const hint: CSSProperties = {
  margin: 'var(--space-sm) 0 0',
  fontSize: 'var(--text-caption)',
  lineHeight: 1.4,
  color: 'var(--color-text-tertiary)',
};
