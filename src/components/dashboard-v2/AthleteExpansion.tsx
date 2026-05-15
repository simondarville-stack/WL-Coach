// Inline expansion for a status-board row. RAW pillar breakdown + bodyweight
// + flag chips on the left, planned-vs-actual chart with a metric switcher
// on the right.

import { useState } from 'react';
import type { AthleteStatus } from '../../hooks/useCoachDashboard';
import type { AthleteEnrichment } from '../../hooks/useCoachDashboardV2';
import {
  RawPillarsBreakdown,
  BwDelta,
  FlagChip,
  PlannedActualChart,
} from './atoms';

type Metric = 'compliance' | 'raw' | 'reps';

interface Props {
  status: AthleteStatus;
  enrichment: AthleteEnrichment;
  onOpenPlanner: (status: AthleteStatus) => void;
}

function weekLabels(n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return ['This wk'];
  // Last bucket is the current week; earlier ones are W -1, W -2, …
  // To keep the chart readable across long windows, sparse-label longer series.
  const labels = new Array<string>(n).fill('');
  labels[n - 1] = 'This wk';
  const stride = n > 8 ? 2 : 1;
  for (let i = n - 1 - stride; i >= 0; i -= stride) {
    const weeksAgo = (n - 1) - i;
    labels[i] = `W -${weeksAgo}`;
  }
  return labels;
}

function MiniLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] uppercase text-gray-400 tracking-wider font-medium">
      {children}
    </span>
  );
}

export function AthleteExpansion({ status, enrichment, onOpenPlanner }: Props) {
  const [metric, setMetric] = useState<Metric>('compliance');
  const a = status.athlete;

  const compSeries = enrichment.compTrend;
  const rawSeries = enrichment.rawTrend;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-5 px-5 py-4">
      <div className="flex flex-col gap-4 min-w-0">
        <div>
          <div className="mb-2"><MiniLabel>RAW pillars (latest)</MiniLabel></div>
          <RawPillarsBreakdown pillars={enrichment.rawPillars} trend={enrichment.rawTrend} />
        </div>
        <div>
          <div className="mb-1"><MiniLabel>Bodyweight</MiniLabel></div>
          {a.track_bodyweight
            ? <BwDelta bw={enrichment.bw} expanded />
            : <span className="text-sm text-gray-400">Not tracked</span>}
        </div>
        {enrichment.flags.length > 0 && (
          <div>
            <div className="mb-2"><MiniLabel>What needs attention</MiniLabel></div>
            <div className="flex flex-wrap gap-1.5">
              {enrichment.flags.map(f => <FlagChip key={f} id={f} />)}
            </div>
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-3 mb-2">
          <MiniLabel>Planned vs actual</MiniLabel>
          <span className="flex-1" />
          <div className="flex gap-1">
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
                  className={`px-2.5 py-0.5 text-xs rounded-md border transition-colors ${
                    selected
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.l}
                </button>
              );
            })}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 min-h-[150px] flex flex-col gap-2">
          {metric === 'compliance' && compSeries.length >= 2 && (
            <PlannedActualChart
              planned={compSeries.map(() => 100)}
              actual={compSeries}
              labels={weekLabels(compSeries.length)}
              yMax={120}
              height={130}
            />
          )}
          {metric === 'raw' && rawSeries.length >= 2 && (
            <PlannedActualChart
              planned={rawSeries.map(() => 12)}
              actual={rawSeries}
              labels={weekLabels(rawSeries.length)}
              yMax={12}
              height={130}
            />
          )}
          {((metric === 'compliance' && compSeries.length < 2)
            || (metric === 'raw' && rawSeries.length < 2)
            || metric === 'reps') && (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 italic">
              {metric === 'reps'
                ? 'Per-week rep totals live in the athlete\'s analysis view.'
                : 'Not enough history yet — keep logging weeks.'}
            </div>
          )}
          <div className="flex gap-4 text-[11px] text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded-sm bg-gray-100 border border-gray-200" />
              planned
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3.5 h-px bg-blue-600" />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-600 -ml-2" />
              actual
            </span>
            <button
              onClick={() => onOpenPlanner(status)}
              className="ml-auto text-blue-600 hover:text-blue-700 bg-transparent border-none p-0 cursor-pointer text-xs"
            >
              Open this athlete's planner →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
