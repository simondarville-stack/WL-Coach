// EMOS Analysis — Monitoring dashboard (Phase 5). Reads the same engine
// (runAnalysisQuery) under the hood and layers sports-science models on top:
// ACWR and Foster monotony/strain on performed dated sessions, weekly adherence,
// and category distribution (planned vs performed over the coach's own
// categories). Models are indicative — thresholds are coach-configurable
// (defaults shown); ACWR/monotony are contested for OWL, so they are framed,
// not asserted.

import { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import type { AnalysisQuery, AnalysisResult } from '../../../lib/analysis';
import { dailyLoadSeries, acwr, monotonyStrain, latestAcwr, DEFAULT_ACWR } from '../../../lib/analysis';
import { useRunQuery } from './useRunQuery';
import { ResultChart } from './ResultChart';
import { formatValue } from './format';
import { Spinner } from '../../ui';

const axisTick = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-text-tertiary)' };

function withRows(base: AnalysisQuery, rows: AnalysisQuery['rows'], state: 'performed' | 'both'): AnalysisQuery {
  return {
    ...base,
    rows,
    cols: [],
    measures: [{ metricId: 'volume', agg: 'sum', state }],
    viz: { type: 'bar' },
    subjects: { ...base.subjects, normalization: 'none' },
  };
}

export function MonitoringView({ baseQuery, enabled }: { baseQuery: AnalysisQuery; enabled: boolean }) {
  const dateQuery = useMemo(() => withRows(baseQuery, ['date'], 'performed'), [baseQuery]);
  const weekQuery = useMemo(() => withRows(baseQuery, ['week'], 'both'), [baseQuery]);
  const catQuery = useMemo(() => withRows(baseQuery, ['category'], 'both'), [baseQuery]);

  const dateRun = useRunQuery(dateQuery, enabled);
  const weekRun = useRunQuery(weekQuery, enabled);
  const catRun = useRunQuery(catQuery, enabled);

  const series = useMemo(() => (dateRun.result ? dailyLoadSeries(dateRun.result, 'volume::performed') : []), [dateRun.result]);
  const acwrPoints = useMemo(() => acwr(series, DEFAULT_ACWR), [series]);
  const monotony = useMemo(() => monotonyStrain(series), [series]);
  const latest = latestAcwr(acwrPoints);
  const lastWeekMono = monotony.length ? monotony[monotony.length - 1] : null;

  const adherence = useMemo(() => overallAdherence(weekRun.result), [weekRun.result]);

  if (!enabled) return null;
  const loading = dateRun.loading || weekRun.loading || catRun.loading;

  return (
    <div className="analysis-print-area" style={{ flex: 1, overflow: 'auto', padding: 'var(--space-lg)' }}>
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-xl)' }}>
          <Spinner />
        </div>
      )}

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <Tile
          label="ACWR (7d : 28d)"
          value={latest?.ratio != null ? latest.ratio.toFixed(2) : '—'}
          tone={latest?.flag === 'high' ? 'danger' : latest?.flag === 'low' ? 'warning' : 'ok'}
          note={latest?.flag === 'high' ? 'Above 1.5 — spike risk' : latest?.flag === 'low' ? 'Below 0.8 — undertraining' : 'In the 0.8–1.5 band'}
        />
        <Tile
          label="Volume adherence"
          value={adherence != null ? `${Math.round(adherence)}%` : '—'}
          tone={adherence == null ? 'ok' : adherence >= 90 ? 'ok' : adherence >= 70 ? 'warning' : 'danger'}
          note="Performed ÷ planned tonnage in scope"
        />
        <Tile
          label="Monotony (last wk)"
          value={lastWeekMono?.monotony != null ? lastWeekMono.monotony.toFixed(2) : '—'}
          tone={lastWeekMono?.monotony != null && lastWeekMono.monotony > 2 ? 'warning' : 'ok'}
          note="Foster — >2 suggests low variation"
        />
        <Tile
          label="Strain (last wk)"
          value={lastWeekMono?.strain != null ? formatValue(lastWeekMono.strain, 'kg') : '—'}
          tone="ok"
          note="Weekly load × monotony"
        />
      </div>

      {/* ACWR chart */}
      <Panel title="Acute : chronic workload ratio" subtitle="Performed daily tonnage. Indicative — thresholds configurable.">
        {acwrPoints.length === 0 ? (
          <Empty label="Needs at least 28 days of performed sessions in scope." />
        ) : (
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={acwrPoints} margin={{ top: 12, right: 24, bottom: 20, left: 8 }}>
                <CartesianGrid stroke="var(--color-border-tertiary)" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} stroke="var(--color-border-secondary)" minTickGap={28} />
                <YAxis tick={axisTick} stroke="var(--color-border-secondary)" width={48} domain={[0, 'auto']} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number | string | undefined) => (typeof v === 'number' ? v.toFixed(2) : '—')} />
                <ReferenceLine y={DEFAULT_ACWR.high} stroke="var(--color-danger-border)" strokeDasharray="4 3" />
                <ReferenceLine y={DEFAULT_ACWR.low} stroke="var(--color-warning-border)" strokeDasharray="4 3" />
                <ReferenceLine y={1} stroke="var(--color-border-secondary)" />
                <Line type="monotone" dataKey="ratio" name="ACWR" stroke="var(--color-accent)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      {/* Adherence by week */}
      <Panel title="Adherence by week" subtitle="Prescribed vs completed tonnage.">
        {weekRun.result ? <ResultChart result={weekRun.result} type="bar" /> : <Empty label="No data." />}
      </Panel>

      {/* Category distribution */}
      <Panel title="Category distribution — planned vs performed" subtitle="Over your exercise categories.">
        {catRun.result ? <ResultChart result={catRun.result} type="bar" /> : <Empty label="No data." />}
      </Panel>
    </div>
  );
}

function overallAdherence(result: AnalysisResult | null): number | null {
  if (!result) return null;
  let plan = 0;
  let perf = 0;
  for (const rec of result.records) {
    plan += rec.values['volume::planned'] ?? 0;
    perf += rec.values['volume::performed'] ?? 0;
  }
  return plan > 0 ? (perf / plan) * 100 : null;
}

const tooltipStyle = {
  background: 'var(--color-bg-primary)',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  fontFamily: 'var(--font-sans)',
};

function Tile({ label, value, tone, note }: { label: string; value: string; tone: 'ok' | 'warning' | 'danger'; note: string }) {
  const color = tone === 'danger' ? 'var(--color-danger-text)' : tone === 'warning' ? 'var(--color-warning-text)' : 'var(--color-text-primary)';
  return (
    <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', background: 'var(--color-bg-primary)' }}>
      <div style={{ fontSize: 'var(--text-caption)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 'var(--text-page-title)', fontWeight: 500, fontFamily: 'var(--font-mono)', color }}>{value}</div>
      <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginTop: 4 }}>{note}</div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-2xl)' }}>
      <div style={{ fontSize: 'var(--text-section)', fontWeight: 500, color: 'var(--color-text-primary)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-sm)' }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-label)' }}>{label}</div>;
}
