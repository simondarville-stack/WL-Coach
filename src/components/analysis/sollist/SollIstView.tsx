// Soll–Ist analysis surface (Analysis › Soll–Ist mode). Orchestrates the
// sheet: model/athlete selection, reference + goal values, PR-fed Ist values,
// save/load against sollist_analyses, CSV export and print. All math comes
// from src/lib/sollIst.ts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FilePlus2, Printer, Save, Trash2, UserRoundPlus } from 'lucide-react';
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
  resolveRefExercise,
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
import { SollIstTable, type RefLine } from './SollIstTable';
import { SollIstWizard, type WizardResult } from './SollIstWizard';
import { emptySheet, fmtKg, modelOptions, parseKgInput, resolveModelRef, sheetFromRecord, sheetToRecord, type SheetState } from './sollIstState';

interface NamedEntity {
  id: string;
  name: string;
}

interface SollIstViewProps {
  athletes: NamedEntity[];
  initialAthleteId: string | null;
}

export function SollIstView({ athletes, initialAthleteId }: SollIstViewProps) {
  const { exercises, fetchExercises } = useExerciseStore();
  const [sheet, setSheet] = useState<SheetState>(() => ({ ...emptySheet(), athleteId: initialAthleteId }));
  const [models, setModels] = useState<SollIstModel[]>([]);
  const [analyses, setAnalyses] = useState<SollIstAnalysisRecord[]>([]);
  const [history, setHistory] = useState<AthletePRHistory[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
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

  // Default reference exercises + default model once the catalogue is loaded.
  useEffect(() => {
    if (exercises.length === 0) return;
    setSheet((s) => {
      const patch: Partial<SheetState> = {};
      if (!s.refSnExerciseId) patch.refSnExerciseId = resolveRefExercise('snatch', exercises)?.id ?? null;
      if (!s.refCjExerciseId) patch.refCjExerciseId = resolveRefExercise('clean_and_jerk', exercises)?.id ?? null;
      if (!s.modelRef && s.rows.length === 0) {
        const def = resolveModelRef('preset:bvdg_senior', models, exercises);
        if (def) {
          patch.modelRef = 'preset:bvdg_senior';
          patch.rows = def.rows;
        }
      }
      return Object.keys(patch).length > 0 ? { ...s, ...patch } : s;
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

  const refSnExercise = useMemo(() => exercises.find((e) => e.id === sheet.refSnExerciseId) ?? null, [exercises, sheet.refSnExerciseId]);
  const refCjExercise = useMemo(() => exercises.find((e) => e.id === sheet.refCjExerciseId) ?? null, [exercises, sheet.refCjExerciseId]);

  // Suggest current references from PRs when the athlete (or history) changes.
  // Only auto-fill untouched sheets: a loaded analysis keeps its stored values.
  const [autofillFor, setAutofillFor] = useState<string | null>(null);
  useEffect(() => {
    if (!sheet.athleteId || sheet.analysisId || history.length === 0) return;
    if (autofillFor === sheet.athleteId) return;
    const sn = suggestReference(refSnExercise, history);
    const cj = suggestReference(refCjExercise, history);
    setAutofillFor(sheet.athleteId);
    setSheet((s) => ({
      ...s,
      currentSn: sn ? sn.valueKg : s.currentSn,
      currentCj: cj ? cj.valueKg : s.currentCj,
      goalSn: sn ? roundKg(sn.valueKg * 1.025) : s.goalSn,
      goalCj: cj ? roundKg(cj.valueKg * 1.025) : s.goalCj,
    }));
  }, [sheet.athleteId, sheet.analysisId, history, refSnExercise, refCjExercise, autofillFor]);

  const refs = useMemo(
    () => ({ currentSn: sheet.currentSn, currentCj: sheet.currentCj, goalSn: sheet.goalSn, goalCj: sheet.goalCj }),
    [sheet.currentSn, sheet.currentCj, sheet.goalSn, sheet.goalCj],
  );

  const istMap = useMemo(
    () => (sheet.athleteId ? buildIstMap(sheet.rows, exercises, history, sheet.overrides) : buildIstMap(sheet.rows, [], [], sheet.overrides)),
    [sheet.athleteId, sheet.rows, exercises, history, sheet.overrides],
  );

  const computed = useMemo(() => computeSollIst(sheet.rows, refs, istMap), [sheet.rows, refs, istMap]);

  const mainModelName = useMemo(
    () => resolveModelRef(sheet.modelRef, models, exercises)?.name ?? 'Custom',
    [sheet.modelRef, models, exercises],
  );

  const side = useMemo(() => {
    if (!sheet.sideModelRef || sheet.sideModelRef === sheet.modelRef) return null;
    const resolved = resolveModelRef(sheet.sideModelRef, models, exercises);
    if (!resolved) return null;
    return { name: resolved.name, computed: computeSollIst(resolved.rows, refs, istMap) };
  }, [sheet.sideModelRef, sheet.modelRef, models, exercises, refs, istMap]);

  const hasAthlete = sheet.athleteId != null;
  const athleteName = athletes.find((a) => a.id === sheet.athleteId)?.name ?? null;

  const refLines: RefLine[] = [
    { slot: 'snatch', label: refSnExercise?.name ?? 'Snatch', current: sheet.currentSn, goal: sheet.goalSn },
    { slot: 'clean_and_jerk', label: refCjExercise?.name ?? 'Clean & Jerk', current: sheet.currentCj, goal: sheet.goalCj },
  ];

  const set = useCallback((patch: Partial<SheetState>) => setSheet((s) => ({ ...s, ...patch })), []);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const onEditIst = useCallback(
    (row: SollIstRow, raw: string) => {
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
    },
    [],
  );

  const onAthleteChange = (athleteId: string | null) => {
    setAutofillFor(null);
    set({ athleteId, overrides: {}, analysisId: null, name: '' });
  };

  const onModelChange = (ref: string | null) => {
    const resolved = resolveModelRef(ref, models, exercises);
    set({ modelRef: ref, rows: resolved?.rows ?? sheet.rows });
  };

  const onWizardCreate = (result: WizardResult) => {
    setWizardOpen(false);
    setAutofillFor(null);
    setSheet((s) => ({
      ...emptySheet(),
      refSnExerciseId: s.refSnExerciseId,
      refCjExerciseId: s.refCjExerciseId,
      athleteId: result.athleteId,
      modelRef: result.modelRef,
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
    setAutofillFor(rec.athleteId); // don't clobber stored refs with PR suggestions
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
      const rows = captureIndividualRows(computed, refs);
      const name = `Individual — ${athleteName} (${formatDateToDDMMYYYY(toLocalISO(new Date()))})`;
      await saveSollIstModel({ name, kind: 'individual', athleteId: sheet.athleteId, rows });
      setModels(await fetchSollIstModels(exercises));
      flash(`Saved “${name}”`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving the individual model failed');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    downloadText(`sollist-${(sheet.name || mainModelName).replace(/[^a-zA-Z0-9-_]+/g, '_')}.csv`, modelToCsv(sheet.rows), 'text/csv;charset=utf-8');
  };

  const numInput = (label: string, value: number | null, onChange: (v: number | null) => void, title?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title={title}>
      <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <Input
        type="number"
        mono
        step={0.5}
        min={0}
        style={{ width: 84, textAlign: 'right' }}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
      />
    </label>
  );

  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
      {label}
    </label>
  );

  const options = modelOptions(models);

  return (
    <div className="analysis-print-area" style={{ flex: 1, overflow: 'auto', padding: 'var(--space-lg)' }}>
      {/* toolbar */}
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', alignItems: 'flex-end', marginBottom: 'var(--space-md)' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Athlete</span>
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
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Model</span>
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

        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end', padding: '6px 10px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
          {numInput('SN current', sheet.currentSn, (v) => set({ currentSn: v }), 'Current snatch reference — suggested from the PR table')}
          {numInput('C&J current', sheet.currentCj, (v) => set({ currentCj: v }), 'Current clean & jerk reference — suggested from the PR table')}
          <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border-secondary)' }} />
          {numInput('SN goal', sheet.goalSn, (v) => set({ goalSn: v }), 'Season goal for the snatch — drives the Target column')}
          {numInput('C&J goal', sheet.goalCj, (v) => set({ goalCj: v }), 'Season goal for the clean & jerk — drives the Target column')}
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
          refLines={refLines}
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
          <span>No athlete selected — pure model sheet at reference = 100 ({fmtKg(sheet.currentSn)} / {fmtKg(sheet.currentCj)}). Ist values can still be typed per cell after selecting an athlete.</span>
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
