// EMOS Analysis — the rebuilt coach-facing module (Phase 1: pivot builder).
//
// Two panes inside one work surface: a config rail (left) and a result pane
// (right), with a cell drill-down docking on the far right. Everything renders
// from `runAnalysisQuery`; this component never aggregates (invariant #6).

import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useAthleteStore } from '../../../store/athleteStore';
import { AthleteCardPicker } from '../../AthleteCardPicker';
import { Button, Select, Spinner } from '../../ui';
import { createRegistry } from '../../../lib/analysis';
import type { AnalysisQuery, Filter } from '../../../lib/analysis';
import { toLocalISO } from '../../../lib/dateUtils';
import { ConfigRail } from './ConfigRail';
import { PivotTable } from './PivotTable';
import { ResultChart } from './ResultChart';
import { DrillPanel } from './DrillPanel';
import { MetricsModal } from './MetricsModal';
import { useRunQuery } from './useRunQuery';
import { buildQuery, defaultBuilderState, VIZ_LABEL, type BuilderState, type Subjects } from './builderState';
import type { VizType } from '../../../lib/analysis';
import { PRESETS } from './presets';
import { loadCoachMetricSpecs, saveCoachMetricSpecs, specToMetric, type CoachMetricSpec } from './coachMetrics';

const today = toLocalISO(new Date());

const VIZ_TYPES: VizType[] = ['table', 'line', 'bar', 'stackedBar', 'groupedBar', 'scatter', 'heatmap', 'radar'];
const VIZ_OPTIONS = VIZ_TYPES.map((id) => ({ id, label: VIZ_LABEL[id] }));

export function AnalysisModule() {
  const { selectedAthlete, selectedGroup } = useAthleteStore();
  const [state, setState] = useState<BuilderState>(() => defaultBuilderState(today));
  const [drill, setDrill] = useState<{ query: AnalysisQuery; title: string } | null>(null);
  const [coachSpecs, setCoachSpecs] = useState<CoachMetricSpec[]>(() => loadCoachMetricSpecs());
  const [metricsOpen, setMetricsOpen] = useState(false);

  const registry = useMemo(() => createRegistry(coachSpecs.map(specToMetric)), [coachSpecs]);
  const updateSpecs = (next: CoachMetricSpec[]) => {
    setCoachSpecs(next);
    saveCoachMetricSpecs(next);
  };

  const subjects: Subjects = useMemo(() => {
    if (selectedGroup) return { athletes: [], groups: [selectedGroup.id], normalization: 'none' };
    if (selectedAthlete) return { athletes: [selectedAthlete.id], groups: [], normalization: 'none' };
    return { athletes: [], groups: [], normalization: 'none' };
  }, [selectedAthlete, selectedGroup]);

  const hasSubject = subjects.athletes.length > 0 || subjects.groups.length > 0;
  const query = useMemo(() => buildQuery(state, subjects, registry, today), [state, subjects, registry]);
  const { result, loading, error } = useRunQuery(query, hasSubject);

  const set = (patch: Partial<BuilderState>) => setState((s) => ({ ...s, ...patch }));

  const onDrill = (rowKey: string[], colKey: string[]) => {
    const filters: Filter[] = [];
    state.rows.forEach((dim, i) => filters.push({ dimension: dim, op: 'in', values: [rowKey[i]] }));
    state.cols.forEach((dim, i) => filters.push({ dimension: dim, op: 'in', values: [colKey[i]] }));
    const drillQuery: AnalysisQuery = {
      ...query,
      rows: ['exercise'],
      cols: [],
      filters,
      viz: { type: 'table' },
    };
    const title = [...rowKey, ...colKey].filter(Boolean).join(' · ') || 'Breakdown';
    setDrill({ query: drillQuery, title });
  };

  if (!hasSubject) {
    return (
      <div style={{ background: 'var(--color-bg-page)', minHeight: '100%', padding: 'var(--space-xl) 48px' }}>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-lg)', fontSize: 'var(--text-body)' }}>
          Select an athlete or group to analyse.
        </p>
        <AthleteCardPicker />
      </div>
    );
  }

  const subjectLabel = selectedGroup?.name ?? selectedAthlete?.name ?? 'Subject';

  return (
    <div style={{ background: 'var(--color-bg-page)', height: '100%', padding: 'var(--space-xl) 0 var(--space-xl) 48px', boxSizing: 'border-box' }}>
      <div
        style={{
          background: 'var(--color-bg-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRight: 'none',
          borderRadius: 'var(--radius-lg) 0 0 var(--radius-lg)',
          height: 'calc(100% - 2px)',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {/* left: config */}
        <ConfigRail state={state} set={set} metrics={registry.list()} subjectLabel={subjectLabel} vizOptions={VIZ_OPTIONS} />

        {/* centre: results */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-md)',
              padding: 'var(--space-md) var(--space-lg)',
              borderBottom: '0.5px solid var(--color-border-tertiary)',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', minWidth: 0 }}>
              <span style={{ fontSize: 'var(--text-section)', fontWeight: 500, color: 'var(--color-text-primary)' }}>Analysis</span>
              <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)' }}>· {subjectLabel}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              {loading && <Spinner />}
              <div style={{ width: 200 }}>
                <Select
                  value=""
                  onChange={(e) => {
                    const p = PRESETS.find((x) => x.id === e.target.value);
                    if (p) set(p.patch);
                  }}
                >
                  <option value="">Load a preset…</option>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id} title={p.description}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="ghost" size="md" icon={<SlidersHorizontal size={14} />} onClick={() => setMetricsOpen(true)}>
                Metrics
              </Button>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-lg)' }}>
            {error && (
              <div style={{ color: 'var(--color-danger-text)', fontSize: 'var(--text-label)', padding: 'var(--space-md)' }}>
                {error}
              </div>
            )}
            {result &&
              (state.vizType === 'table' ? (
                <PivotTable result={result} onDrill={onDrill} />
              ) : (
                <ResultChart result={result} type={state.vizType} />
              ))}
            {result && result.meta.notes.length > 0 && (
              <div style={{ marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {result.meta.notes.map((n, i) => (
                  <p key={i} style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                    ⚠ {n}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* right: drill-down */}
        <DrillPanel query={drill?.query ?? null} title={drill?.title ?? ''} onClose={() => setDrill(null)} />
      </div>

      <MetricsModal
        isOpen={metricsOpen}
        onClose={() => setMetricsOpen(false)}
        metrics={registry.list()}
        baseMetrics={registry.list().filter((m) => m.kind === 'base')}
        onAdd={(spec) => updateSpecs([...coachSpecs, spec])}
        onDelete={(id) => updateSpecs(coachSpecs.filter((s) => s.id !== id))}
      />
    </div>
  );
}
