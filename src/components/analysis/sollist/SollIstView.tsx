// Soll–Ist analysis surface (Analysis › Soll–Ist mode). Orchestrates the
// sheet: model/athlete selection, generic references (any exercise — or
// typed numbers — can anchor the index), PR-fed Ist values, save/load
// against sollist_analyses, CSV export and print. All math comes from
// src/lib/sollIst.ts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FilePlus2, Printer, Save, Settings2, Trash2, UserRoundPlus } from 'lucide-react';
import { Button, ErrorState, Input, Select, Spinner } from '../../ui';
import { useExerciseStore } from '../../../store/exerciseStore';
import type { AthletePRHistory } from '../../../lib/database.types';
import { fetchPRHistory } from '../../../lib/prTable';
import {
  buildIstMap,
  captureIndividualRows,
  computeSollIst,
  deleteSollIstAnalysis,
  fetchSollIstAnalyses,
  fetchSollIstModels,
  istKey,
  newRefKey,
  roundKg,
  saveSollIstAnalysis,
  saveSollIstModel,
  suggestReference,
  type SollIstAnalysisRecord,
  type SollIstModel,
  type SollIstRow,
} from '../../../lib/sollIst';
import { modelToCsv } from '../../../lib/sollIstCsv';
import { formatDateToDDMMYYYY, toLocalISO } from '../../../lib/dateUtils';
import { downloadText } from '../builder/exportUtils';
import { SollIstTable } from './SollIstTable';
import { SollIstWizard, type WizardResult } from './SollIstWizard';
import {
  emptySheet,
  modelOptions,
  parseKgInput,
  refAbbrev,
  refPillStyle,
  refValuesMap,
  resolveModelRef,
  sheetFromRecord,
  sheetToRecord,
  toSheetRefs,
  type SheetRef,
  type SheetState,
} from './sollIstState';

interface NamedEntity {
  id: string;
  name: string;
}

interface SollIstViewProps {
  athletes: NamedEntity[];
  initialAthleteId: string | null;
}

const capStyle: React.CSSProperties = {
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-tertiary)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

export function SollIstView({ athletes, initialAthleteId }: SollIstViewProps) {
  const { exercises, fetchExercises } = useExerciseStore();
  const [sheet, setSheet] = useState<SheetState>(() => ({ ...emptySheet(), athleteId: initialAthleteId }));
  const [models, setModels] = useState<SollIstModel[]>([]);
  const [analyses, setAnalyses] = useState<SollIstAnalysisRecord[]>([]);
  const [history, setHistory] = useState<AthletePRHistory[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refsOpen, setRefsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void fetchExercises();
  }, [fetchExercises]);

  // Models + saved analyses, once the catalogue is there (model rows need names).
  useEffect(() => {
    if (exercises.length === 0) return;
    let cancelled = false;
    void Promise.all([fetchSollIstModels(exercises), fetchSollIstAnalyses()])
      .then(([m, a]) => {
        if (cancelled) return;
        setModels(m);
        setAnalyses(a);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load Soll–Ist data'));
    return () => {
      cancelled = true;
    };
  }, [exercises]);

  // Default model (BVDG Senior) once the catalogue is loaded and the sheet is empty.
  useEffect(() => {
    if (exercises.length === 0) return;
    setSheet((s) => {
      if (s.modelRef || s.rows.length > 0 || s.refs.length > 0) return s;
      const def = resolveModelRef('preset:bvdg_senior', models, exercises);
      if (!def) return s;
      return { ...s, modelRef: 'preset:bvdg_senior', refs: toSheetRefs(def.refs, []), rows: def.rows };
    });
  }, [exercises, models]);

  // PR history follows the selected athlete.
  useEffect(() => {
    if (!sheet.athleteId) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    void fetchPRHistory(sheet.athleteId)
      .then((h) => !cancelled && setHistory(h))
      .catch(() => !cancelled && setHistory([]));
    return () => {
      cancelled = true;
    };
  }, [sheet.athleteId]);

  // Fill empty current/goal values of exercise-bound references from the PR
  // table. Only fills nulls, so loaded analyses and typed values are never
  // clobbered; switching athletes nulls the bound refs first (below).
  useEffect(() => {
    if (!sheet.athleteId || history.length === 0) return;
    setSheet((s) => {
      let changed = false;
      const refs = s.refs.map((r) => {
        if (r.exerciseId == null || r.current != null) return r;
        const sug = suggestReference(exercises.find((e) => e.id === r.exerciseId) ?? null, history);
        if (!sug) return r;
        changed = true;
        return { ...r, current: sug.valueKg, goal: r.goal ?? roundKg(sug.valueKg * 1.025) };
      });
      return changed ? { ...s, refs } : s;
    });
  }, [sheet.athleteId, history, exercises, sheet.refs]);

  const refValues = useMemo(() => refValuesMap(sheet.refs), [sheet.refs]);

  const istMap = useMemo(
    () => (sheet.athleteId ? buildIstMap(sheet.rows, exercises, history, sheet.overrides) : buildIstMap(sheet.rows, [], [], sheet.overrides)),
    [sheet.athleteId, sheet.rows, exercises, history, sheet.overrides],
  );

  const computed = useMemo(() => computeSollIst(sheet.rows, refValues, istMap), [sheet.rows, refValues, istMap]);

  const mainModelName = useMemo(
    () => resolveModelRef(sheet.modelRef, models, exercises)?.name ?? 'Custom',
    [sheet.modelRef, models, exercises],
  );

  const side = useMemo(() => {
    if (!sheet.sideModelRef || sheet.sideModelRef === sheet.modelRef) return null;
    const resolved = resolveModelRef(sheet.sideModelRef, models, exercises);
    if (!resolved) return null;
    // The side model's rows are read against the sheet's reference values:
    // refs are matched by key, then by bound exercise (so a stored model's
    // "sn" still finds the sheet's snatch reference).
    const keyMap = new Map<string, string>();
    for (const r of resolved.refs) {
      const target =
        sheet.refs.find((s) => s.key === r.key) ??
        (r.exerciseId != null ? sheet.refs.find((s) => s.exerciseId === r.exerciseId) : undefined);
      if (target) keyMap.set(r.key, target.key);
    }
    const rows = resolved.rows.map((r) => ({ ...r, refKey: keyMap.get(r.refKey) ?? r.refKey }));
    return { name: resolved.name, computed: computeSollIst(rows, refValues, istMap) };
  }, [sheet.sideModelRef, sheet.modelRef, sheet.refs, models, exercises, refValues, istMap]);

  const hasAthlete = sheet.athleteId != null;
  const athleteName = athletes.find((a) => a.id === sheet.athleteId)?.name ?? null;

  const set = useCallback((patch: Partial<SheetState>) => setSheet((s) => ({ ...s, ...patch })), []);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const onEditIst = useCallback((row: SollIstRow, raw: string) => {
    if (!row.exerciseId) return;
    const key = istKey(row.exerciseId, row.reps);
    const parsed = parseKgInput(raw);
    setSheet((s) => {
      const overrides = { ...s.overrides };
      // The ≈-prefixed estimate blurring back unchanged is not an override.
      if (parsed == null || raw.trim().startsWith('≈')) delete overrides[key];
      else overrides[key] = parsed;
      return { ...s, overrides };
    });
  }, []);

  const updateRef = (i: number, patch: Partial<SheetRef>) => {
    setSheet((s) => ({ ...s, refs: s.refs.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  };

  const addRef = () => {
    setSheet((s) => ({
      ...s,
      refs: [...s.refs, { key: newRefKey('reference', s.refs.map((r) => r.key)), label: 'Reference', exerciseId: null, current: 100, goal: null }],
    }));
  };

  const removeRef = (i: number) => {
    setSheet((s) => (s.rows.some((r) => r.refKey === s.refs[i]?.key) ? s : { ...s, refs: s.refs.filter((_, j) => j !== i) }));
  };

  const onAthleteChange = (athleteId: string | null) => {
    setSheet((s) => ({
      ...s,
      athleteId,
      overrides: {},
      analysisId: null,
      name: '',
      // Null the bound refs so the PR autofill refills them for the new
      // athlete; manual (unbound) references keep their typed numbers.
      refs: s.refs.map((r) => (r.exerciseId != null ? { ...r, current: athleteId ? null : 100, goal: athleteId ? null : 105 } : r)),
    }));
  };

  const onModelChange = (ref: string | null) => {
    const resolved = resolveModelRef(ref, models, exercises);
    if (!resolved) {
      set({ modelRef: ref });
      return;
    }
    setSheet((s) => ({ ...s, modelRef: ref, refs: toSheetRefs(resolved.refs, s.refs), rows: resolved.rows }));
  };

  const onWizardCreate = (result: WizardResult) => {
    setWizardOpen(false);
    setSheet((s) => ({
      ...emptySheet(),
      athleteId: result.athleteId,
      modelRef: result.modelRef,
      refs: toSheetRefs(result.refs, result.athleteId === s.athleteId ? s.refs : []),
      rows: result.rows,
      name: result.name,
    }));
  };

  const saveAnalysis = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = sheet.name.trim() || `${athleteName ?? 'Soll–Ist'} — ${formatDateToDDMMYYYY(toLocalISO(new Date()))}`;
      const id = await saveSollIstAnalysis({ ...sheetToRecord({ ...sheet, name }) });
      set({ analysisId: id, name });
      setAnalyses(await fetchSollIstAnalyses());
      flash('Analysis saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const loadAnalysis = (id: string) => {
    const rec = analyses.find((a) => a.id === id);
    if (!rec) return;
    setSheet(sheetFromRecord(rec, models, exercises));
  };

  const removeAnalysis = async () => {
    if (!sheet.analysisId) return;
    setBusy(true);
    try {
      await deleteSollIstAnalysis(sheet.analysisId);
      setAnalyses((a) => a.filter((x) => x.id !== sheet.analysisId));
      set({ analysisId: null });
      flash('Analysis deleted');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const saveIndividualModel = async () => {
    if (!sheet.athleteId || !athleteName) return;
    setBusy(true);
    setError(null);
    try {
      const rows = captureIndividualRows(computed, refValues);
      const name = `Individual — ${athleteName} (${formatDateToDDMMYYYY(toLocalISO(new Date()))})`;
      await saveSollIstModel({
        name,
        kind: 'individual',
        athleteId: sheet.athleteId,
        refs: sheet.refs.map(({ key, label, exerciseId }) => ({ key, label, exerciseId })),
        rows,
      });
      setModels(await fetchSollIstModels(exercises));
      flash(`Saved “${name}”`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving the individual model failed');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    downloadText(
      `sollist-${(sheet.name || mainModelName).replace(/[^a-zA-Z0-9-_]+/g, '_')}.csv`,
      modelToCsv(sheet.refs, sheet.rows),
      'text/csv;charset=utf-8',
    );
  };

  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
      {label}
    </label>
  );

  const options = modelOptions(models);
  const sortedExercises = useMemo(() => [...exercises].sort((a, b) => a.name.localeCompare(b.name)), [exercises]);

  return (
    <div className="analysis-print-area" style={{ flex: 1, overflow: 'auto', padding: 'var(--space-lg)' }}>
      {/* toolbar */}
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', alignItems: 'flex-end', marginBottom: 'var(--space-md)' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={capStyle}>Athlete</span>
          <div style={{ width: 180 }}>
            <Select value={sheet.athleteId ?? ''} onChange={(e) => onAthleteChange(e.target.value || null)}>
              <option value="">— none (index 100) —</option>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={capStyle}>Model</span>
          <div style={{ width: 220 }}>
            <Select value={sheet.modelRef ?? ''} onChange={(e) => onModelChange(e.target.value || null)}>
              {sheet.modelRef == null && <option value="">Custom rows</option>}
              <optgroup label="Textbook">
                {options.filter((o) => o.kind === 'textbook').map((o) => (
                  <option key={o.ref} value={o.ref}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
              {options.some((o) => o.kind !== 'textbook') && (
                <optgroup label="Saved models">
                  {options.filter((o) => o.kind !== 'textbook').map((o) => (
                    <option key={o.ref} value={o.ref}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </div>
        </label>

        {/* per-reference current/goal inputs */}
        <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-end', padding: '6px 10px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
          {sheet.refs.map((r, i) => {
            const { bg, fg } = refPillStyle(i);
            return (
              <div key={r.key} style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title={r.exerciseId == null ? `${r.label} — manual reference` : `${r.label} — current, suggested from the PR table`}>
                  <span style={capStyle}>
                    <span style={{ fontWeight: 700, padding: '1px 5px', borderRadius: 8, background: bg, color: fg, marginRight: 4 }}>{refAbbrev(r.label)}</span>
                    current
                  </span>
                  <Input
                    type="number"
                    mono
                    step={0.5}
                    min={0}
                    style={{ width: 80, textAlign: 'right' }}
                    value={r.current ?? ''}
                    onChange={(e) => updateRef(i, { current: e.target.value === '' ? null : parseFloat(e.target.value) })}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title={`${r.label} — goal, drives the Target column`}>
                  <span style={capStyle}>goal</span>
                  <Input
                    type="number"
                    mono
                    step={0.5}
                    min={0}
                    style={{ width: 80, textAlign: 'right' }}
                    value={r.goal ?? ''}
                    onChange={(e) => updateRef(i, { goal: e.target.value === '' ? null : parseFloat(e.target.value) })}
                  />
                </label>
                {i < sheet.refs.length - 1 && <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border-secondary)' }} />}
              </div>
            );
          })}
          <Button variant="ghost" size="sm" icon={<Settings2 size={13} />} onClick={() => setRefsOpen((o) => !o)} title="Edit references — add, remove, rename, or bind to a catalogue exercise">
            Refs
          </Button>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
          {toggle('Heatmap', sheet.heatmap, (v) => set({ heatmap: v }))}
          {toggle('Diff', sheet.diff, (v) => set({ diff: v }))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
            Compare
            <div style={{ width: 170 }}>
              <Select value={sheet.sideModelRef ?? ''} onChange={(e) => set({ sideModelRef: e.target.value || null })}>
                <option value="">— off —</option>
                {options.filter((o) => o.ref !== sheet.modelRef).map((o) => (
                  <option key={o.ref} value={o.ref}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginLeft: 'auto' }}>
          {busy && <Spinner />}
          {notice && <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-success-text, #1c7c3c)' }}>{notice}</span>}
          <Button variant="ghost" size="md" icon={<FilePlus2 size={14} />} onClick={() => setWizardOpen(true)}>
            New…
          </Button>
          {analyses.length > 0 && (
            <div style={{ width: 180 }}>
              <Select value="" onChange={(e) => e.target.value && loadAnalysis(e.target.value)}>
                <option value="">Open saved…</option>
                {analyses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Button variant="ghost" size="md" icon={<Save size={14} />} onClick={() => void saveAnalysis()} disabled={busy || sheet.rows.length === 0}>
            Save
          </Button>
          {sheet.analysisId && (
            <Button variant="ghost" size="md" icon={<Trash2 size={14} />} onClick={() => void removeAnalysis()} disabled={busy} title="Delete this saved analysis">
              Delete
            </Button>
          )}
          {hasAthlete && (
            <Button
              variant="ghost"
              size="md"
              icon={<UserRoundPlus size={14} />}
              onClick={() => void saveIndividualModel()}
              disabled={busy || computed.every((c) => c.ist == null)}
              title="Capture the athlete's actual ratios (Ist ÷ current reference) as a dated individual model"
            >
              Save as individual model
            </Button>
          )}
          <Button variant="ghost" size="md" icon={<Download size={14} />} onClick={exportCsv} title="Export the model rows as CSV (re-importable)">
            CSV
          </Button>
          <Button variant="ghost" size="md" icon={<Printer size={14} />} onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      {/* inline reference editor (structure: label / binding / add / remove) */}
      {refsOpen && (
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'var(--space-md)', padding: '8px 10px', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--radius-md)' }}>
          <span style={capStyle}>References — each is index 100; bind to a catalogue exercise for PR suggestions, or keep it manual</span>
          {sheet.refs.map((r, i) => {
            const inUse = sheet.rows.some((row) => row.refKey === r.key);
            return (
              <div key={r.key} style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                <div style={{ width: 180 }}>
                  <Input value={r.label} onChange={(e) => updateRef(i, { label: e.target.value })} />
                </div>
                <div style={{ width: 240 }}>
                  <Select
                    value={r.exerciseId ?? ''}
                    onChange={(e) => {
                      const ex = exercises.find((x) => x.id === e.target.value);
                      updateRef(i, { exerciseId: ex?.id ?? null, label: ex?.name ?? r.label, current: null, goal: null });
                    }}
                  >
                    <option value="">— manual (type numbers) —</option>
                    {sortedExercises.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button variant="ghost" size="sm" disabled={inUse} title={inUse ? 'Rows still point at this reference' : 'Remove reference'} onClick={() => removeRef(i)}>
                  ✕
                </Button>
              </div>
            );
          })}
          <div>
            <Button variant="ghost" size="sm" onClick={addRef}>
              + Add reference
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 'var(--space-md)' }}>
          <ErrorState message={error} />
        </div>
      )}

      {/* print header: name + context, only visible on paper */}
      <div className="print-only" style={{ display: 'none', marginBottom: 8 }}>
        <strong>Soll–Ist — {sheet.name || mainModelName}</strong>
        <span style={{ marginLeft: 12 }}>
          {athleteName ?? 'No athlete'} · {formatDateToDDMMYYYY(toLocalISO(new Date()))}
        </span>
      </div>

      {sheet.rows.length === 0 ? (
        <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
          No exercises yet — pick a model above or build one with <strong>New…</strong>
        </p>
      ) : (
        <SollIstTable
          computed={computed}
          side={side}
          modelName={mainModelName}
          refs={sheet.refs}
          hasAthlete={hasAthlete}
          heatmap={sheet.heatmap}
          diff={sheet.diff}
          onEditIst={onEditIst}
        />
      )}

      {/* legend */}
      <div className="no-print" style={{ display: 'flex', gap: 'var(--space-lg)', marginTop: 'var(--space-md)', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', flexWrap: 'wrap' }}>
        {hasAthlete ? (
          <>
            <span>
              <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 2, background: 'rgba(28,124,60,0.16)', verticalAlign: -1, marginRight: 4 }} />
              Ist ≥ Soll (strength)
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 2, background: 'rgba(200,60,60,0.18)', verticalAlign: -1, marginRight: 4 }} />
              Ist &lt; Soll (weakness — redder = larger gap)
            </span>
            <span>
              <em>≈ italic</em> = estimated rep-max from the PR table — type in the cell to override
            </span>
            <span>
              <strong>Target</strong> = index × goal reference · <strong>To go</strong> = Target − Ist
            </span>
          </>
        ) : (
          <span>No athlete selected — pure model sheet with each reference at 100 (or the numbers you type). Select an athlete to compare against PRs.</span>
        )}
      </div>

      <SollIstWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        athletes={athletes}
        exercises={exercises}
        models={models}
        onCreate={onWizardCreate}
      />

      <style>{`
        .sollist-ist-input:hover { border-color: var(--color-border-secondary) !important; }
        .sollist-ist-input:focus { border-color: var(--color-accent) !important; background: var(--color-bg-primary) !important; outline: none; }
        .sollist-row:hover td { background: var(--color-bg-secondary); }
        @media print { .print-only { display: block !important; } }
      `}</style>
    </div>
  );
}
