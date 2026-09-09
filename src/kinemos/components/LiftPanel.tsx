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
import { memo, type CSSProperties } from 'react';
import { Button } from '../../components/ui';
import type { RepSummary } from '../engine/kinematics';
import { liftModelById, liftModelsByFamily, type LiftModel } from '../engine/liftModels';
import type { LiftMetrics } from '../engine/phases';
import type { Verdict } from '../lib/verdict';
import { num } from '../lib/viewerFormat';

interface LiftPanelProps {
  repIndices: number[];
  repIndex: number;
  /** Stored peak velocity per rep, for the pills — null where the rep has
   *  not been analysed. */
  repPeaks: Record<number, number | null>;
  /** Each rep's stored lift model id (P9). When the reps of a clip are not
   *  all the same lift — a clean & jerk cut into its parts — the pills say
   *  which is which. */
  repModels?: Record<number, string | null>;
  /**
   * The lift model this rep is segmented under, the clip's model (a compound
   * when the set is a clean & jerk), how it was arrived at, and the coach's
   * override. Absent: no chip.
   */
  model?: { current: LiftModel; clipModel: LiftModel; how: string; onChange: (id: string) => void };
  onRep: (rep: number) => void;
  onAddRep: () => void;
  /** On a rep just added: track on from where the previous one ended, to the
   *  end of the clip. Null when there is nothing to track on from. */
  trackRest?: { hint: string; run: () => void } | null;
  /** A track in progress, so the offer waits. */
  trackBusy?: { done: number; total: number } | null;
  /** What the last track said, shown under the offer on an empty rep. */
  setNote?: string | null;

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

function LiftPanelImpl({
  repIndices,
  repIndex,
  repPeaks,
  repModels = {},
  model,
  onRep,
  onAddRep,
  trackRest = null,
  trackBusy = null,
  setNote = null,
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

  // The pills name the part when the clip's reps are not all one lift — a
  // clean & jerk's "Rep 1 · Cl" and "Rep 2 · Jk" — or when a rep is stored
  // under something other than the clip's own model.
  const storedModels = new Set(repIndices.map(r => repModels[r]).filter((m): m is string => !!m));
  const mixed = storedModels.size > 1 || (model !== undefined && [...storedModels].some(m => m !== model.clipModel.id));
  const partOf = (rep: number): LiftModel | null => {
    const id = rep === repIndex && model ? model.current.id : repModels[rep];
    return mixed && id ? liftModelById(id) : null;
  };
  const howText =
    model?.how === 'stored' ? 'stored with the rep' : model?.how === 'coach' ? 'your pick' : model?.how === 'assumed' ? 'assumed — set it on the exercise' : model?.how ?? '';

  return (
    <div>
      {/* Reps */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px 0' }}>
        {repIndices.map(rep => {
          const active = rep === repIndex;
          const peak = repPeaks[rep] ?? null;
          const part = partOf(rep);
          const name = part ? `Rep ${rep} · ${part.shortLabel}` : `Rep ${rep}`;
          return (
            <button
              key={rep}
              type="button"
              onClick={() => onRep(rep)}
              aria-pressed={active}
              title={`${part ? `${part.label} · ` : ''}${peak === null ? `Rep ${rep} · not analysed` : `Rep ${rep} · Vmax ${num(peak, 2)} m/s`}`}
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
              {name}
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', opacity: peak === null ? 0.6 : 1 }}>
                {peak === null ? (active && topSpeed !== null ? num(topSpeed, 2) : '—') : num(peak, 2)}
              </span>
            </button>
          );
        })}
        <button type="button" onClick={onAddRep} title="Add a rep" style={addButton}>
          <Plus size={12} />
          rep
        </button>
      </div>

      {/* The lift model: what the bar does, and so which phases are read. */}
      {model && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 12px 0' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={model.current.note}>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', letterSpacing: 'var(--tracking-section)' }}>
              LIFT
            </span>
            <select
              value={model.current.id}
              onChange={e => model.onChange(e.target.value)}
              aria-label="Lift model"
              style={modelSelect}
            >
              {liftModelsByFamily().map(group => (
                <optgroup key={group.family} label={group.label}>
                  {group.models
                    .filter(m => m.shape !== 'compound')
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
            {model.clipModel.shape === 'compound' ? `${model.clipModel.label} · cut into its parts · ` : ''}
            {howText}
          </span>
        </div>
      )}

      {/* The three big numbers */}
      {topSpeed === null ? (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {trackRest && !trackBusy && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Button size="sm" variant="primary" onClick={trackRest.run} title={trackRest.hint} style={{ alignSelf: 'flex-start' }}>
                Track the rest of the clip
              </Button>
              <p style={{ margin: 0, fontSize: 'var(--text-caption)', lineHeight: 1.4, color: 'var(--color-text-tertiary)' }}>{trackRest.hint}</p>
            </div>
          )}
          {trackBusy && (
            <p style={{ margin: 0, fontSize: 'var(--text-caption)', lineHeight: 1.4, color: 'var(--color-text-secondary)' }}>
              {`Tracking · frame ${trackBusy.done} / ${trackBusy.total}`}
            </p>
          )}
          {setNote && (
            <p style={{ margin: 0, fontSize: 'var(--text-caption)', lineHeight: 1.4, color: 'var(--color-text-secondary)' }}>{setNote}</p>
          )}
          <p style={{ margin: 0, fontSize: 'var(--text-caption)', lineHeight: 1.4, color: 'var(--color-text-tertiary)' }}>
            {emptyReason ?? (trackRest ? 'Or mark the bar and track by hand.' : 'Mark the bar to get numbers.')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', rowGap: 12, padding: '12px 0' }}>
          <BigStat
            label="Top speed"
            value={num(topSpeed, 2)}
            unit={heightAtTop === null ? 'm/s' : `m/s · at ${num(heightAtTop, 1)} cm`}
            title="Vmax · at S_vmax"
          />
          <BigStat
            label="Bar height"
            value={barHeight === null ? '—' : num(barHeight, 1)}
            unit="cm"
            title="S_max, above the start"
          />
          <BigStat
            label="Turnover"
            value={turnover === null ? '—' : num(turnover, 2)}
            unit="s"
            title="t_turn · Vmax → Vmin"
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
              ? 'Needs a calibrated, marked lift'
              : marks.isReference
                ? `${marks.athleteName ?? 'The athlete'}’s reference ${marks.exerciseName ?? 'lift'} · press to unmark`
                : `Make this ${marks.athleteName ?? 'the athlete'}’s reference ${marks.exerciseName ?? 'lift'} · replaces the current one`
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
              ? 'Needs a calibrated, marked lift'
              : marks.isModel
                ? `Club model lift${marks.modelLabel ? ` · ${marks.modelLabel}` : ''} · press to unmark`
                : 'Make this a club model lift · offered when comparing any athlete'
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
        // Wide enough for five mono digits at the smallest size; a rail
        // narrower than three of these wraps the third number under the
        // first two rather than clipping it.
        minWidth: 108,
        padding: '0 16px',
        borderRight: last ? 'none' : '0.5px solid var(--color-border-tertiary)',
      }}
    >
      <div style={micro}>{label}</div>
      <div style={big}>{value}</div>
      <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>{unit}</div>
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
  fontSize: 'clamp(24px, 2.4vw, 40px)',
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

const modelSelect: CSSProperties = {
  padding: '2px 6px',
  borderRadius: 'var(--radius-md)',
  border: '0.5px solid var(--color-border-secondary)',
  background: 'var(--color-bg-primary)',
  color: 'var(--color-text-primary)',
  fontFamily: 'inherit',
  fontSize: 'var(--text-label)',
  maxWidth: 220,
};

export const LiftPanel = memo(LiftPanelImpl);
