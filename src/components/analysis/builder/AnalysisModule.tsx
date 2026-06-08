// EMOS Analysis — the rebuilt coach-facing module (Phase 1: pivot builder).
//
// Two panes inside one work surface: a config rail (left) and a result pane
// (right), with a cell drill-down docking on the far right. Everything renders
// from `runAnalysisQuery`; this component never aggregates (invariant #6).

import { useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal, Save, Download } from 'lucide-react';
import { useAthleteStore } from '../../../store/athleteStore';
import { AthleteCardPicker } from '../../AthleteCardPicker';
import { Badge, Button, Select, Spinner } from '../../ui';
import { createRegistry } from '../../../lib/analysis';
import type { AnalysisQuery, Filter } from '../../../lib/analysis';
import { toLocalISO } from '../../../lib/dateUtils';
import { ConfigRail } from './ConfigRail';
import { PivotTable } from './PivotTable';
import { ResultChart } from './ResultChart';
import { DrillPanel } from './DrillPanel';
import { MetricsModal } from './MetricsModal';
import { SaveViewModal } from './SaveViewModal';
import { MonitoringView } from './MonitoringView';
import { useRunQuery } from './useRunQuery';
import { buildQuery, defaultBuilderState, isMultiSubject, previousScope, VIZ_LABEL, type BuilderState } from './builderState';
import type { Normalization, VizType } from '../../../lib/analysis';

const NORM_LABEL: Record<Normalization, string> = {
  none: '',
  perAthleteMean: 'mean=100',
  perBodyweight: '÷ kg',
  sinclair: 'Sinclair',
};
import { PRESETS } from './presets';
import { loadCoachMetricSpecs, saveCoachMetricSpecs, specToMetric, type CoachMetricSpec } from './coachMetrics';
import { loadSavedViews, saveView, deleteView, type SavedView } from './savedViews';
import { resultToCsv, downloadText, exportChartSvg, triggerPrint } from './exportUtils';

const today = toLocalISO(new Date());

const VIZ_TYPES: VizType[] = ['table', 'line', 'bar', 'stackedBar', 'groupedBar', 'scatter', 'heatmap', 'radar'];
const VIZ_OPTIONS = VIZ_TYPES.map((id) => ({ id, label: VIZ_LABEL[id] }));

export function AnalysisModule() {
  const { selectedAthlete, selectedGroup, athletes, groups } = useAthleteStore();
  const [state, setState] = useState<BuilderState>(() =>
    defaultBuilderState(today, {
      athleteIds: selectedGroup ? [] : selectedAthlete ? [selectedAthlete.id] : [],
      groupIds: selectedGroup ? [selectedGroup.id] : [],
    }),
  );
  const [drill, setDrill] = useState<{ query: AnalysisQuery; title: string } | null>(null);
  const [coachSpecs, setCoachSpecs] = useState<CoachMetricSpec[]>(() => loadCoachMetricSpecs());
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  const [saveOpen, setSaveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mode, setMode] = useState<'build' | 'monitor'>('build');
  const resultRef = useRef<HTMLDivElement>(null);

  const registry = useMemo(() => createRegistry(coachSpecs.map(specToMetric)), [coachSpecs]);
  const updateSpecs = (next: CoachMetricSpec[]) => {
    setCoachSpecs(next);
    saveCoachMetricSpecs(next);
  };

  // Seed subjects from the header selector once, when the builder has none.
  useEffect(() => {
    setState((s) => {
      if (s.athleteIds.length > 0 || s.groupIds.length > 0) return s;
      if (selectedGroup) return { ...s, groupIds: [selectedGroup.id] };
      if (selectedAthlete) return { ...s, athleteIds: [selectedAthlete.id] };
      return s;
    });
  }, [selectedAthlete, selectedGroup]);

  const hasSubject = state.athleteIds.length > 0 || state.groupIds.length > 0;
  const multi = isMultiSubject(state);
  const query = useMemo(() => buildQuery(state, registry, today), [state, registry]);
  const { result, loading, error } = useRunQuery(query, hasSubject);

  // Period-over-period: a second query for the immediately-preceding window.
  const compareQuery = useMemo<AnalysisQuery>(
    () => ({ ...query, scope: previousScope(query.scope, today), viz: { ...query.viz, overlay: { mode: 'none' } } }),
    [query],
  );
  const { result: compareResult } = useRunQuery(compareQuery, state.comparePrevious && hasSubject && state.vizType !== 'table');

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

  const subjectLabel =
    state.groupIds.length > 0
      ? `${state.groupIds.length} group${state.groupIds.length > 1 ? 's' : ''}`
      : state.athleteIds.length === 1
      ? athletes.find((a) => a.id === state.athleteIds[0])?.name ?? 'Athlete'
      : `${state.athleteIds.length} athletes`;

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
        <ConfigRail state={state} set={set} metrics={registry.list()} athletes={athletes} groups={groups} availableValues={result?.meta.availableValues ?? {}} vizOptions={VIZ_OPTIONS} />

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
              {multi && state.normalization !== 'none' && mode === 'build' && (
                <Badge variant="info">Normalized · {NORM_LABEL[state.normalization]}</Badge>
              )}
              <div style={{ display: 'flex', gap: 2, marginLeft: 'var(--space-sm)' }}>
                {(['build', 'monitor'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="emos-btn"
                    style={{
                      padding: '4px 10px',
                      fontSize: 'var(--text-caption)',
                      borderRadius: 'var(--radius-md)',
                      background: mode === m ? 'var(--color-accent)' : 'transparent',
                      color: mode === m ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
                      border: mode === m ? 'none' : '0.5px solid var(--color-border-secondary)',
                      fontWeight: mode === m ? 500 : 400,
                      textTransform: 'capitalize',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              {loading && <Spinner />}
              {mode === 'build' && (
                <>
              <div style={{ width: 190 }}>
                <Select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v.startsWith('preset:')) {
                      const p = PRESETS.find((x) => x.id === v.slice(7));
                      if (p) set(p.patch);
                    } else if (v.startsWith('view:')) {
                      const sv = savedViews.find((x) => x.id === v.slice(5));
                      // Merge over defaults so a view saved before a field existed
                      // (e.g. filters) still loads with sane values.
                      if (sv) setState({ ...defaultBuilderState(today), ...sv.state });
                    }
                  }}
                >
                  <option value="">Open…</option>
                  <optgroup label="Presets">
                    {PRESETS.map((p) => (
                      <option key={p.id} value={`preset:${p.id}`} title={p.description}>{p.name}</option>
                    ))}
                  </optgroup>
                  {savedViews.length > 0 && (
                    <optgroup label="Saved views">
                      {savedViews.map((v) => (
                        <option key={v.id} value={`view:${v.id}`}>{v.name}</option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </div>
              <Button variant="ghost" size="md" icon={<Save size={14} />} onClick={() => setSaveOpen(true)}>Save</Button>
              <div style={{ position: 'relative' }}>
                <Button variant="ghost" size="md" icon={<Download size={14} />} onClick={() => setExportOpen((o) => !o)}>Export</Button>
                {exportOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 4px)',
                      zIndex: 20,
                      background: 'var(--color-bg-primary)',
                      border: '0.5px solid var(--color-border-secondary)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
                      minWidth: 160,
                      padding: 4,
                    }}
                  >
                    <ExportItem label="CSV (table)" onClick={() => { if (result) downloadText('analysis.csv', resultToCsv(result), 'text/csv;charset=utf-8'); setExportOpen(false); }} />
                    <ExportItem label="Chart SVG" onClick={() => { exportChartSvg(resultRef.current, 'analysis-chart.svg'); setExportOpen(false); }} />
                    <ExportItem label="Print…" onClick={() => { setExportOpen(false); setTimeout(triggerPrint, 100); }} />
                  </div>
                )}
              </div>
              <Button variant="ghost" size="md" icon={<SlidersHorizontal size={14} />} onClick={() => setMetricsOpen(true)}>Metrics</Button>
                </>
              )}
            </div>
          </div>

          {mode === 'monitor' ? (
            <MonitoringView baseQuery={query} enabled={hasSubject} />
          ) : (
          <div ref={resultRef} className="analysis-print-area" style={{ flex: 1, overflow: 'auto', padding: 'var(--space-lg)' }}>
            {error && (
              <div style={{ color: 'var(--color-danger-text)', fontSize: 'var(--text-label)', padding: 'var(--space-md)' }}>
                {error}
              </div>
            )}
            {result &&
              (state.vizType === 'table' ? (
                <PivotTable result={result} onDrill={onDrill} />
              ) : (
                <ResultChart result={result} type={state.vizType} compare={state.comparePrevious ? compareResult : null} />
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
          )}
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

      <SaveViewModal
        isOpen={saveOpen}
        onClose={() => setSaveOpen(false)}
        views={savedViews}
        onSave={(name) => setSavedViews(saveView(name, state))}
        onDelete={(id) => setSavedViews(deleteView(id))}
      />

      {/* Print: hide all chrome, print only the result pane. */}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        .analysis-print-area, .analysis-print-area * { visibility: visible !important; }
        .analysis-print-area { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 !important; overflow: visible !important; }
      }`}</style>
    </div>
  );
}

function ExportItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="emos-btn emos-btn-ghost"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '6px 10px',
        fontSize: 'var(--text-label)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {label}
    </button>
  );
}
