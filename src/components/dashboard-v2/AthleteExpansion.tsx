// Inline expansion for a status-board row. Mirrors the prototype's layout —
// RAW pillar breakdown + bodyweight detail + flag chips on the left, a
// metric-switched chart on the right.
//
// The chart's "Reps" mode needs a 4-week planned-vs-actual rep series that
// EMOS doesn't yet expose at the dashboard level. Rather than block the v2
// shell on a bigger aggregate pipeline, we default to the Compliance and RAW
// metrics (which we do have) and surface Reps as a placeholder if there is
// no series. Coaches can still tap into the per-athlete planner/analysis for
// the deeper rep view.

import { useState } from 'react';
import type { AthleteStatus } from '../../hooks/useCoachDashboard';
import type { AthleteEnrichment } from '../../hooks/useCoachDashboardV2';
import {
  RawPillarsBreakdown,
  BwDelta,
  SectionHeader,
  FlagChip,
  PlannedActualChart,
} from './atoms';

type Metric = 'compliance' | 'raw' | 'reps';

interface Props {
  status: AthleteStatus;
  enrichment: AthleteEnrichment;
  onOpenPlanner: (status: AthleteStatus) => void;
}

const LABELS_4W = ['W -3', 'W -2', 'W -1', 'This wk'];

function padTo4(values: number[]): number[] {
  if (values.length >= 4) return values.slice(-4);
  // left-pad with the first value so the chart still draws stably
  if (!values.length) return [];
  const padCount = 4 - values.length;
  const head = Array.from({ length: padCount }, () => values[0]);
  return [...head, ...values];
}

export function AthleteExpansion({ status, enrichment, onOpenPlanner }: Props) {
  const [metric, setMetric] = useState<Metric>('compliance');
  const a = status.athlete;

  const compSeries = padTo4(enrichment.compTrend);
  const rawSeries = padTo4(enrichment.rawTrend);

  return (
    <div style={{
      padding: '14px 18px 16px',
      background: 'var(--color-bg-secondary)',
      borderTop: '1px solid var(--color-border-secondary)',
      display: 'grid',
      gridTemplateColumns: 'minmax(280px, 360px) 1fr',
      gap: 18,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <div>
          <SectionHeader>RAW pillars (latest)</SectionHeader>
          <RawPillarsBreakdown pillars={enrichment.rawPillars} trend={enrichment.rawTrend} />
        </div>
        <div>
          <SectionHeader>Bodyweight</SectionHeader>
          {a.track_bodyweight
            ? <BwDelta bw={enrichment.bw} expanded />
            : <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Not tracked</span>}
        </div>
        {enrichment.flags.length > 0 && (
          <div>
            <SectionHeader>What needs attention</SectionHeader>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {enrichment.flags.map(f => <FlagChip key={f} id={f} />)}
            </div>
          </div>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <SectionHeader right={
          <div style={{ display: 'flex', gap: 2 }}>
            {([
              { id: 'compliance', l: 'Compliance' },
              { id: 'raw',        l: 'RAW' },
              { id: 'reps',       l: 'Reps' },
            ] as { id: Metric; l: string }[]).map(opt => {
              const selected = metric === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setMetric(opt.id)}
                  style={{
                    padding: '2px 8px', fontSize: 10.5,
                    background: selected ? 'var(--color-text-primary)' : 'transparent',
                    color: selected ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
                    border: `1px solid ${selected ? 'var(--color-text-primary)' : 'var(--color-border-secondary)'}`,
                    borderRadius: 2, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {opt.l}
                </button>
              );
            })}
          </div>
        }>Planned vs actual</SectionHeader>
        <div style={{
          padding: '8px 10px',
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border-tertiary)',
          borderRadius: 3,
          minHeight: 130,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {metric === 'compliance' && compSeries.length >= 2 && (
            <PlannedActualChart
              planned={compSeries.map(() => 100)}
              actual={compSeries}
              labels={LABELS_4W}
              yMax={120}
              width={460} height={130}
            />
          )}
          {metric === 'raw' && rawSeries.length >= 2 && (
            <PlannedActualChart
              planned={rawSeries.map(() => 12)}
              actual={rawSeries}
              labels={LABELS_4W}
              yMax={12}
              width={460} height={130}
            />
          )}
          {((metric === 'compliance' && compSeries.length < 2)
            || (metric === 'raw' && rawSeries.length < 2)
            || metric === 'reps') && (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-text-tertiary)', fontSize: 11,
              fontFamily: 'var(--font-mono, ui-monospace), monospace',
            }}>
              {metric === 'reps'
                ? 'Per-week rep totals are visible in the athlete\'s analysis view.'
                : 'Not enough history yet — keep logging weeks.'}
            </div>
          )}
          <div style={{
            display: 'flex', gap: 14,
            fontFamily: 'var(--font-mono, ui-monospace), monospace',
            fontSize: 10, color: 'var(--color-text-tertiary)',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 8, background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border-secondary)' }} />
              planned
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 14, height: 1.5, background: 'var(--color-accent)' }} />
              <span style={{ width: 5, height: 5, borderRadius: 3, background: 'var(--color-accent)', marginLeft: -8 }} />
              actual
            </span>
            <button
              onClick={() => onOpenPlanner(status)}
              style={{
                marginLeft: 'auto',
                background: 'transparent', border: 'none', padding: 0,
                color: 'var(--color-accent)', fontFamily: 'inherit',
                fontSize: 10, cursor: 'pointer',
              }}
            >
              Open this athlete's planner →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
