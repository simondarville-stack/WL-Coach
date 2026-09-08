/**
 * LiftPanel — "This lift": the three numbers and the one sentence.
 *
 * What a coach who has just filmed a lift wants, in order: did it look right
 * (the video), was it faster than last time (this panel), and — only if they
 * doubt the numbers — is the tracking any good (the panels below). So this is
 * the panel every depth opens, and it carries the rep pills, the three big
 * stats, and the verdict.
 *
 * The verdict is gated on the grade (`lib/verdict.ts`): a difference inside
 * the margin of error is reported as "level with", never as faster or slower.
 * That is a product rule, not copy dressing.
 */
import { GraduationCap, Plus, Star } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Button } from '../../components/ui';
import type { RepSummary } from '../engine/kinematics';
import type { LiftMetrics } from '../engine/phases';
import type { Verdict } from '../lib/verdict';
import { num } from '../lib/viewerFormat';

interface LiftPanelProps {
  repIndices: number[];
  repIndex: number;
  /** Stored peak velocity per rep, for the pills — null where the rep has
   *  not been analysed. */
  repPeaks: Record<number, number | null>;
  onRep: (rep: number) => void;
  onAddRep: () => void;

  metrics: LiftMetrics | null;
  summary: RepSummary | null;
  /** Why there are no numbers, when there are none. */
  emptyReason: string | null;
  verdict: Verdict;

  /** Marking this rep as the athlete's reference, or the club's model. Both
   *  need a comparable lift. */
  marks: {
    comparable: boolean;
    busy: boolean;
    isReference: boolean;
    onToggleReference: () => void;
    isModel: boolean;
    modelLabel: string | null;
    onToggleModel: () => void;
    athleteName: string | null;
    exerciseName: string | null;
  };
}

export function LiftPanel({
  repIndices,
  repIndex,
  repPeaks,
  onRep,
  onAddRep,
  metrics,
  summary,
  emptyReason,
  verdict,
  marks,
}: LiftPanelProps) {
  const analyzer = metrics?.analyzer ?? null;
  const topSpeed = analyzer?.vmaxMs ?? metrics?.peakVelocityMs ?? null;
  const heightAtTop = analyzer?.sVmaxCm ?? null;
  const barHeight = analyzer?.sMaxCm ?? (summary && summary.peakHeightCm ? summary.peakHeightCm : null);
  const turnover = analyzer?.tTurnS ?? null;

  return (
    <div>
      {/* Reps */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px 0' }}>
        {repIndices.map(rep => {
          const active = rep === repIndex;
          const peak = repPeaks[rep] ?? null;
          return (
            <button
              key={rep}
              type="button"
              onClick={() => onRep(rep)}
              aria-pressed={active}
              title={peak === null ? `Rep ${rep} — not analysed yet` : `Rep ${rep} — peak ${num(peak, 2)} m/s`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                borderRadius: 'var(--radius-md)',
                border: active ? '0.5px solid var(--color-accent)' : '0.5px solid var(--color-border-secondary)',
                background: active ? 'var(--color-accent)' : 'var(--color-bg-primary)',
                color: active ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
                fontFamily: 'inherit',
                fontSize: 'var(--text-label)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {`Rep ${rep}`}
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', opacity: peak === null ? 0.6 : 1 }}>
                {peak === null ? (active && topSpeed !== null ? num(topSpeed, 2) : '—') : num(peak, 2)}
              </span>
            </button>
          );
        })}
        <button type="button" onClick={onAddRep} title="Add a rep — one recording often holds several attempts" style={addButton}>
          <Plus size={12} />
          rep
        </button>
      </div>

      {/* The three big numbers */}
      {topSpeed === null ? (
        <p style={{ margin: 0, padding: '12px 16px', fontSize: 'var(--text-caption)', lineHeight: 1.4, color: 'var(--color-text-tertiary)' }}>
          {emptyReason ?? 'Mark the bar through the lift to get numbers.'}
        </p>
      ) : (
        <div style={{ display: 'flex', padding: '12px 0' }}>
          <BigStat
            label="Top speed"
            value={num(topSpeed, 2)}
            unit={heightAtTop === null ? 'm/s' : `m/s · at ${num(heightAtTop, 1)} cm`}
            title="Peak vertical velocity (Vmax), and the height the bar had reached when it got there (S_vmax)."
          />
          <BigStat
            label="Bar height"
            value={barHeight === null ? '—' : num(barHeight, 1)}
            unit="cm"
            title="The top of the bar's flight (S_max), above where it started."
          />
          <BigStat
            label="Turnover"
            value={turnover === null ? '—' : num(turnover, 2)}
            unit="s"
            title="Time from Vmax to Vmin — how fast the lifter got under the bar (t_turn)."
            last
          />
        </div>
      )}

      {/* The verdict */}
      {topSpeed !== null && (
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ ...callout, ...calloutTone(verdict.kind) }}>
            <div style={{ fontSize: 'var(--text-body)', fontWeight: 500 }}>{verdict.headline}</div>
            <div style={{ fontSize: 'var(--text-caption)', lineHeight: 1.4, marginTop: 2 }}>{verdict.detail}</div>
          </div>
        </div>
      )}

      {/* Reference & model */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 12px 12px' }}>
        <Button
          size="sm"
          variant={marks.isReference ? 'primary' : 'secondary'}
          icon={<Star size={12} fill={marks.isReference ? 'currentColor' : 'none'} />}
          disabled={!marks.comparable || marks.busy}
          aria-pressed={marks.isReference}
          onClick={marks.onToggleReference}
          title={
            !marks.comparable
              ? 'A reference needs a calibrated, marked lift'
              : marks.isReference
                ? `This is ${marks.athleteName ?? 'the athlete'}’s reference ${marks.exerciseName ?? 'lift'}. Comparison opens on it and the trend view draws it as a line. Press to unmark.`
                : `Make this ${marks.athleteName ?? 'the athlete'}’s reference ${marks.exerciseName ?? 'lift'} — the one the others are judged against. Replaces any current reference for this exercise.`
          }
        >
          {marks.isReference ? 'Reference lift' : 'Set as reference'}
        </Button>
        <Button
          size="sm"
          variant={marks.isModel ? 'primary' : 'secondary'}
          icon={<GraduationCap size={12} />}
          disabled={!marks.comparable || marks.busy}
          aria-pressed={marks.isModel}
          onClick={marks.onToggleModel}
          title={
            !marks.comparable
              ? 'A model lift needs a calibrated, marked lift'
              : marks.isModel
                ? `A model lift for the whole club${marks.modelLabel ? `: “${marks.modelLabel}”` : ''}. It is offered when comparing any athlete. Press to unmark.`
                : 'Make this a model lift for the whole club — an exemplar offered when comparing any athlete, not only this one.'
          }
        >
          {marks.isModel ? (marks.modelLabel ? `Model · ${marks.modelLabel}` : 'Model lift') : 'Set as model'}
        </Button>
      </div>
    </div>
  );
}

function BigStat({
  label,
  value,
  unit,
  title,
  last = false,
}: {
  label: string;
  value: string;
  unit: string;
  title: string;
  last?: boolean;
}) {
  return (
    <div
      title={title}
      style={{
        flex: 1,
        minWidth: 0,
        padding: '0 16px',
        borderRight: last ? 'none' : '0.5px solid var(--color-border-tertiary)',
      }}
    >
      <div style={micro}>{label}</div>
      <div style={big}>{value}</div>
      <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{unit}</div>
    </div>
  );
}

function calloutTone(kind: Verdict['kind']): CSSProperties {
  switch (kind) {
    case 'faster':
      return {
        background: 'var(--color-success-bg)',
        borderColor: 'var(--color-success-border)',
        color: 'var(--color-success-text)',
      };
    case 'slower':
      return {
        background: 'var(--color-danger-bg)',
        borderColor: 'var(--color-danger-border)',
        color: 'var(--color-danger-text)',
      };
    default:
      return {
        background: 'var(--color-bg-secondary)',
        borderColor: 'var(--color-border-tertiary)',
        color: 'var(--color-text-secondary)',
      };
  }
}

const micro: CSSProperties = {
  fontSize: 'var(--text-micro)',
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-tertiary)',
};

const big: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  // 40 px at the wireframe's 1440; smaller on a narrower rail so three
  // numbers still sit in one row.
  fontSize: 'clamp(26px, 2.7vw, 40px)',
  lineHeight: 1.1,
  letterSpacing: '-0.02em',
  color: 'var(--color-text-primary)',
};

const callout: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--radius-md)',
  border: '0.5px solid',
};

const addButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '3px 8px',
  borderRadius: 'var(--radius-md)',
  border: '0.5px dashed var(--color-border-secondary)',
  background: 'transparent',
  color: 'var(--color-text-tertiary)',
  fontFamily: 'inherit',
  fontSize: 'var(--text-caption)',
  cursor: 'pointer',
};
