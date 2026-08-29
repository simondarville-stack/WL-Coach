// Ratio Analysis surface (Analysis › Ratio Analysis mode). Orchestrates the
// sheet: model/athlete selection, generic references (any exercise — or
// typed numbers — can anchor the index), PR-fed Ist values, save/load
// against sollist_analyses, CSV export and print. The sheet is a live data
// view: the model is edited inline in the table (swap references, adjust
// index/reps, remove rows), and rows can be searched, filtered and grouped
// by reference or category. All math comes from src/lib/sollIst.ts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FilePlus2, Layers, Library, Printer, Save, Settings2, Trash2, UserRoundPlus } from 'lucide-react';
import { Button, ErrorState, Input, Modal, Select, Spinner } from '../../ui';
import { useExerciseStore } from '../../../store/exerciseStore';
import type { AthletePRHistory } from '../../../lib/database.types';
import { fetchPRHistory } from '../../../lib/prTable';
import {
  buildIstMap,
  captureIndividualRows,
  computeSollIst,
  deleteSollIstAnalysis,
  deleteSollIstModel,
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
  updateSollIstModelMeta,
  duplicateSollIstModel,
} from '../../../lib/sollIst';
import { modelToCsv } from '../../../lib/sollIstCsv';
import { addExerciseAlias, isKnownAs } from '../../../lib/exerciseAliases';
import { formatDateToDDMMYYYY, toLocalISO } from '../../../lib/dateUtils';
import { downloadText } from '../builder/exportUtils';
import { ExerciseSearch } from '../../planner/ExerciseSearch';
import { SollIstTable } from './SollIstTable';
import { SollIstWizard, type WizardResult } from './SollIstWizard';
import { SollIstModelManager } from './SollIstModelManager';
import { loadRatioDraft, saveRatioDraft } from '../../../lib/ratioAnalysisDraft';
import {
  buildRowGroups,
  defaultView,
  emptySheet,
  modelOptions,
  parseKgInput,
  refValuesMap,
  resolveModelRef,
  sheetFromRecord,
  sheetToRecord,
  toSheetRefs,
  type SheetRef,
  type SheetState,
  type SheetView,
  exerciseOptionLabel,
  isSheetState,
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
  const { exercises, categories, fetchExercises, fetchCategories, setExercises } = useExerciseStore();
  // Restore the in-flight sheet. Walking over to the PR page unmounts this
  // component, so without the draft every unsaved edit was lost the moment the
  // coach went to look up a number — which is exactly when they go.
  // `initialAthleteId` only wins when there is no draft, so arriving from a
  // one-athlete Analysis scope does not silently swap the athlete under a
  // sheet the coach was already building.
  const [sheet, setSheet] = useState<SheetState>(() => {
    const draft = loadRatioDraft(isSheetState);
    if (draft) return { ...emptySheet(), ...draft };
    return { ...emptySheet(), athleteId: initialAthleteId };
  });
  const [models, setModels] = useState<SollIstModel[]>([]);
  const [analyses, setAnalyses] = useState<SollIstAnalysisRecord[]>([]);
  /**
   * PR history AND whose it is. The pair has to move together: the fetch is
   * async, so for a moment after switching athlete the sheet's athleteId is the
   * new one while `rows` is still the old one's. Autofilling in that window
   * stamped the previous athlete's PRs onto the new athlete's references — the
   * bug behind "it fails to load X's PRs", which was really "it shows Y's".
   */
  const [history, setHistory] = useState<{ athleteId: string | null; rows: AthletePRHistory[] }>(
    { athleteId: null, rows: [] },
  );
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refsOpen, setRefsOpen] = useState(false);
  const [saveModelOpen, setSaveModelOpen] = useState(false);
  const [modelName, setModelName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void fetchExercises();
    void fetchCategories();
  }, [fetchExercises, fetchCategories]);

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
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Couldn’t load Ratio Analysis data. Check your connection and try again.'));
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
    const forAthlete = sheet.athleteId;
    if (!forAthlete) {
      setHistory({ athleteId: null, rows: [] });
      return;
    }
    let cancelled = false;
    // Clear first: until the fetch lands, we must not be holding rows that
    // belong to somebody else.
    setHistory({ athleteId: forAthlete, rows: [] });
    void fetchPRHistory(forAthlete)
      .then((h) => !cancelled && setHistory({ athleteId: forAthlete, rows: h }))
      .catch(() => !cancelled && setHistory({ athleteId: forAthlete, rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [sheet.athleteId]);

  // Fill empty current/goal values of exercise-bound references from the PR
  // table. Only fills nulls, so loaded analyses and typed values are never
  // clobbered; switching athletes nulls the bound refs first (below).
  useEffect(() => {
    if (!sheet.athleteId) return;
    // The guard that makes this safe: never fill from rows belonging to a
    // different athlete than the one selected.
    if (history.athleteId !== sheet.athleteId) return;
    setSheet((s) => {
      if (!s.athleteId) return s;
      // A reference filled from a DIFFERENT athlete has to be cleared before
      // refilling — otherwise their PR silently stays under this athlete's
      // name. `onAthleteChange` clears them for the dropdown path, but the
      // athlete also arrives from the Analysis scope at mount and from a
      // restored draft, and those went unguarded.
      const staleAthlete = s.refsFilledFor !== null && s.refsFilledFor !== s.athleteId;
      const base = staleAthlete
        ? s.refs.map((r) => (r.exerciseId != null ? { ...r, current: null, goal: null } : r))
        : s.refs;

      // Nothing to fill from yet: keep the cleared refs and record whose sheet
      // this is, so an athlete with no PRs settles on blank instead of
      // inheriting the last one's numbers.
      if (history.rows.length === 0) {
        return staleAthlete || s.refsFilledFor !== s.athleteId
          ? { ...s, refs: base, refsFilledFor: s.athleteId }
          : s;
      }

      let changed = staleAthlete;
      const refs = base.map((r) => {
        if (r.exerciseId == null || r.current != null) return r;
        const sug = suggestReference(exercises.find((e) => e.id === r.exerciseId) ?? null, history.rows, s.onlyMeasured);
        if (!sug) return r;
        changed = true;
        return { ...r, current: sug.valueKg, goal: r.goal ?? roundKg(sug.valueKg * 1.025) };
      });
      if (!changed && s.refsFilledFor === s.athleteId) return s;
      return { ...s, refs, refsFilledFor: s.athleteId };
    });
  }, [sheet.athleteId, history, exercises, sheet.refs, sheet.onlyMeasured, sheet.refsFilledFor]);

  // Mirror the sheet on every change. Cheap (one small JSON write, no network)
  // and it is what makes the surface survive a remount.
  useEffect(() => { saveRatioDraft(sheet); }, [sheet]);

  const refValues = useMemo(() => refValuesMap(sheet.refs), [sheet.refs]);

  const istMap = useMemo(
    () => (sheet.athleteId
      // Same guard for the Actual column: mismatched history contributes
       // nothing rather than another athlete's numbers.
      ? buildIstMap(sheet.rows, exercises, history.athleteId === sheet.athleteId ? history.rows : [], sheet.overrides, sheet.onlyMeasured)
      : buildIstMap(sheet.rows, [], [], sheet.overrides, sheet.onlyMeasured)),
    [sheet.athleteId, sheet.rows, exercises, history, sheet.overrides, sheet.onlyMeasured],
  );

  const computed = useMemo(() => computeSollIst(sheet.rows, refValues, istMap), [sheet.rows, refValues, istMap]);

  const categoryOf = useCallback(
    (exerciseId: string | null): string | null => {
      if (!exerciseId) return null;
      const cat = exercises.find((e) => e.id === exerciseId)?.category;
      return cat ? String(cat) : null;
    },
    [exercises],
  );

  const codeOf = useCallback(
    (exerciseId: string | null): string | null =>
      (exerciseId ? exercises.find((e) => e.id === exerciseId)?.exercise_code ?? null : null),
    [exercises],
  );

  const categoryOrder = useMemo(
    () => [...categories].sort((a, b) => a.display_order - b.display_order).map((c) => c.name),
    [categories],
  );

  const groups = useMemo(
    () => buildRowGroups(computed, sheet.view, sheet.refs, categoryOf, categoryOrder, codeOf),
    [computed, sheet.view, sheet.refs, categoryOf, categoryOrder, codeOf],
  );

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
  const setView = useCallback((patch: Partial<SheetView>) => setSheet((s) => ({ ...s, view: { ...s.view, ...patch } })), []);

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

  // Alias memory: repointing a previously-unmapped row teaches the source
  // label (the preset's/CSV's name) to the chosen exercise, so the same
  // label resolves automatically next time. Fire-and-forget: an alias write
  // failure never blocks the repoint itself.
  const learnAlias = useCallback(
    (exerciseId: string, sourceLabel: string) => {
      const ex = exercises.find((e) => e.id === exerciseId);
      if (!ex || isKnownAs(ex, sourceLabel)) return;
      void addExerciseAlias(ex, sourceLabel)
        .then((aliases) => {
          const current = useExerciseStore.getState().exercises;
          setExercises(current.map((e) => (e.id === ex.id ? { ...e, aliases } : e)));
          flash(`Alias remembered: “${sourceLabel}” → ${ex.name}`);
        })
        .catch(() => undefined);
    },
    [exercises, setExercises],
  );

  // Inline model editing: rows are identified by object reference — computed
  // rows wrap the exact objects held in sheet.rows.
  const onEditRow = useCallback(
    (row: SollIstRow, patch: Partial<SollIstRow>) => {
      if (row.exerciseId == null && patch.exerciseId != null) learnAlias(patch.exerciseId, row.label);
      setSheet((s) => ({ ...s, rows: s.rows.map((r) => (r === row ? { ...r, ...patch } : r)) }));
    },
    [learnAlias],
  );

  const onRemoveRow = useCallback((row: SollIstRow) => {
    setSheet((s) => ({ ...s, rows: s.rows.filter((r) => r !== row) }));
  }, []);

  const addRow = (exerciseId: string) => {
    const ex = exercises.find((e) => e.id === exerciseId);
    if (!ex) return;
    setSheet((s) => ({
      ...s,
      rows: [...s.rows, { exerciseId: ex.id, label: ex.name, refKey: s.refs[0]?.key ?? 'ref', indexPct: 100, reps: 1 }],
    }));
  };

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
      refsFilledFor: null,
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
      const name = sheet.name.trim() || `${athleteName ?? 'Ratio Analysis'} — ${formatDateToDDMMYYYY(toLocalISO(new Date()))}`;
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

  // "Save model": persist the sheet's refs + rows as a reusable model — the
  // no-round-trip way to correct a preset's exercise mapping or tweak its
  // numbers. Presets stay immutable (textbook source); the coach's version
  // lands under Saved models. A stored model can also be updated in place.
  const storedModel = useMemo(() => models.find((m) => m.id === sheet.modelRef) ?? null, [models, sheet.modelRef]);
  const unmappedCount = sheet.rows.filter((r) => r.exerciseId == null).length;

  const openSaveModel = () => {
    setModelName(storedModel?.name ?? `${mainModelName} — my version`);
    setSaveModelOpen(true);
  };

  const doSaveModel = async (updateExisting: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const name = modelName.trim() || `${mainModelName} — my version`;
      const id = await saveSollIstModel({
        id: updateExisting && storedModel ? storedModel.id : null,
        name,
        kind: updateExisting && storedModel && storedModel.kind !== 'textbook' ? storedModel.kind : 'custom',
        athleteId: updateExisting && storedModel ? storedModel.athleteId : null,
        refs: sheet.refs.map(({ key, label, exerciseId }) => ({ key, label, exerciseId })),
        rows: sheet.rows,
      });
      setModels(await fetchSollIstModels(exercises));
      set({ modelRef: id });
      setSaveModelOpen(false);
      flash(`Model “${name}” saved`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving the model failed');
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

  /** Reload the model list after a manager action. */
  const refreshModels = async () => setModels(await fetchSollIstModels(exercises));

  const renameModel = async (id: string, name: string) => {
    setBusy(true);
    try {
      await updateSollIstModelMeta(id, { name });
      await refreshModels();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t rename the model. The name is unchanged.');
    } finally { setBusy(false); }
  };

  const duplicateModel = async (model: SollIstModel) => {
    setBusy(true);
    try {
      await duplicateSollIstModel(model);
      await refreshModels();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t duplicate the model. Nothing was copied.');
    } finally { setBusy(false); }
  };

  const removeModel = async (model: SollIstModel) => {
    setBusy(true);
    try {
      await deleteSollIstModel(model.id);
      await refreshModels();
      // The sheet keeps its rows — only the link to the deleted model goes, so
      // the coach does not lose what is on screen.
      setSheet((sh) => (sh.modelRef === model.id ? { ...sh, modelRef: null } : sh));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t delete the model. Nothing was deleted.');
    } finally { setBusy(false); }
  };

  const options = modelOptions(models);
  // Sentinels (TEXT / GPP / VIDEO / IMAGE) can never carry a PR, so they are
  // meaningless as a Ratio Analysis row — and now that codes are printed, their codes
  // would read as if they were lifts. Same filter ExerciseSearch already uses.
  const sortedExercises = useMemo(
    () => exercises.filter((e) => e.category !== '— System').sort((a, b) => a.name.localeCompare(b.name)),
    [exercises],
  );

  // Categories present in the sheet (for the filter dropdown), catalogue order.
  const sheetCategories = useMemo(() => {
    const present = new Set(sheet.rows.map((r) => categoryOf(r.exerciseId) ?? '—'));
    return [...categoryOrder.filter((c) => present.has(c)), ...(present.has('—') ? ['—'] : [])];
  }, [sheet.rows, categoryOf, categoryOrder]);

  const viewActive =
    sheet.view.search.trim() !== '' || sheet.view.refFilter != null || sheet.view.categoryFilter != null || sheet.view.sort != null || sheet.view.groupBy !== 'none';

  return (
    <div className="analysis-print-area" style={{ flex: 1, overflow: 'auto', padding: 'var(--space-lg)' }}>
      {/* toolbar: subject + model + reference values + actions */}
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', alignItems: 'flex-end', marginBottom: 'var(--space-sm)' }}>
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
        <Button
          variant="ghost"
          size="md"
          icon={<Library size={14} />}
          onClick={() => setManagerOpen(true)}
          title="Open a copy of a textbook model, or rename / duplicate / delete your saved ones"
        >
          Models…
        </Button>

        {/* per-reference current/goal inputs — full names, no chips */}
        <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-end', padding: '6px 10px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
          {sheet.refs.map((r, i) => (
            <div key={r.key} style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title={r.exerciseId == null ? `${r.label} — manual reference` : `${r.label} — current, suggested from the PR table`}>
                <span style={{ ...capStyle, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.label}
                  {r.exerciseId == null && ' ✎'} · current
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
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title={`${r.label} — goal, drives the Goal target kg column`}>
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
          ))}
          <Button variant="ghost" size="sm" icon={<Settings2 size={13} />} onClick={() => setRefsOpen((o) => !o)} title="Edit references — add, remove, rename, or bind to a catalogue exercise">
            Refs
          </Button>
          {/* An athlete with no personal records at all. The Actual column is
              simply empty in that case, which reads exactly like a failed load —
              say which it is. */}
          {sheet.athleteId && history.athleteId === sheet.athleteId && history.rows.length === 0 && (
            <span
              style={{
                fontSize: 'var(--text-caption)', color: 'var(--color-danger-text)',
                background: 'var(--color-danger-bg)', border: '0.5px solid var(--color-danger-border)',
                borderRadius: 'var(--radius-sm)', padding: '2px 8px', whiteSpace: 'nowrap',
              }}
              title="Ratios are built from the PR table. Add this athlete's xRM records on the Personal Records page and they will appear here."
            >
              {athleteName ?? 'This athlete'} has no personal records yet
            </span>
          )}
          {/* Has PRs, but none the model can use once estimates are excluded. */}
          {sheet.athleteId && history.rows.length > 0 && sheet.onlyMeasured && istMap.size === 0 && (
            <span
              style={{
                fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
                whiteSpace: 'nowrap',
              }}
              title="Every value this model needs is an estimate. Turn Measured only off, or record the missing xRM."
            >
              No measured xRM for this model
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
          {toggle('Heatmap', sheet.heatmap, (v) => set({ heatmap: v }))}
          {toggle('Diff', sheet.diff, (v) => set({ diff: v }))}
          <span title="Build Actual from xRM values the athlete has actually hit, ignoring the PR table's estimates. A ratio between two estimates is a ratio between two guesses.">
            {toggle('Measured only', sheet.onlyMeasured, (v) => set({ onlyMeasured: v }))}
          </span>
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
          <Button
            variant="ghost"
            size="md"
            icon={<Layers size={14} />}
            onClick={openSaveModel}
            disabled={busy || sheet.rows.length === 0}
            title="Save the sheet's references, exercises and indices as a reusable model — e.g. a corrected BVDG mapping"
          >
            Save model
          </Button>
          {hasAthlete && (
            <Button
              variant="ghost"
              size="md"
              icon={<UserRoundPlus size={14} />}
              onClick={() => void saveIndividualModel()}
              disabled={busy || computed.every((c) => c.ist == null)}
              title="Capture the athlete's actual ratios (current best ÷ current reference) as a dated individual model"
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

      {/* view bar: search / group / filter / add — the data-view controls */}
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <div style={{ width: 180 }}>
          <Input placeholder="Search exercises or codes…" value={sheet.view.search} onChange={(e) => setView({ search: e.target.value })} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
          Group by
          <div style={{ width: 130 }}>
            <Select value={sheet.view.groupBy} onChange={(e) => setView({ groupBy: e.target.value as SheetView['groupBy'] })}>
              <option value="none">— none —</option>
              <option value="ref">Reference</option>
              <option value="category">Category</option>
            </Select>
          </div>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
          Reference
          <div style={{ width: 160 }}>
            <Select value={sheet.view.refFilter ?? ''} onChange={(e) => setView({ refFilter: e.target.value || null })}>
              <option value="">— all —</option>
              {sheet.refs.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}>
          Category
          <div style={{ width: 160 }}>
            <Select value={sheet.view.categoryFilter ?? ''} onChange={(e) => setView({ categoryFilter: e.target.value || null })}>
              <option value="">— all —</option>
              {sheetCategories.map((c) => (
                <option key={c} value={c}>
                  {c === '—' ? 'No category' : c}
                </option>
              ))}
            </Select>
          </div>
        </label>
        <div
          style={{ width: 230, border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)' }}
          title="Append an exercise to the sheet (index 100 on the first reference — adjust inline)"
        >
          <ExerciseSearch exercises={exercises} onAdd={(ex) => addRow(ex.id)} disableSlashCommands dropUp={false} placeholder="Add exercise…" />
        </div>
        {viewActive && (
          <Button variant="ghost" size="sm" onClick={() => setView(defaultView())} title="Clear search, filters, grouping and sorting">
            Reset view
          </Button>
        )}
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
                        {exerciseOptionLabel(ex)}
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
        <strong>Ratio Analysis — {sheet.name || mainModelName}</strong>
        <span style={{ marginLeft: 12 }}>
          {athleteName ?? 'No athlete'} · {formatDateToDDMMYYYY(toLocalISO(new Date()))}
        </span>
      </div>

      {sheet.rows.length === 0 ? (
        <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
          No exercises yet — pick a model above, add exercises with <strong>+ Add exercise…</strong>, or build a sheet with <strong>New…</strong>
        </p>
      ) : (
        <SollIstTable
          groups={groups}
          side={side}
          modelName={mainModelName}
          refs={sheet.refs}
          exercises={sortedExercises}
          hasAthlete={hasAthlete}
          heatmap={sheet.heatmap}
          diff={sheet.diff}
          groupBy={sheet.view.groupBy}
          sort={sheet.view.sort}
          onSortChange={(sort) => setView({ sort })}
          onEditRow={onEditRow}
          onRemoveRow={onRemoveRow}
          onEditIst={onEditIst}
        />
      )}

      {/* legend */}
      <div className="no-print" style={{ display: 'flex', gap: 'var(--space-lg)', marginTop: 'var(--space-md)', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', flexWrap: 'wrap' }}>
        {hasAthlete ? (
          <>
            <span>
              <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 2, background: 'rgba(28,124,60,0.16)', verticalAlign: -1, marginRight: 4 }} />
              Current best ≥ Target (strength)
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 2, background: 'rgba(200,60,60,0.18)', verticalAlign: -1, marginRight: 4 }} />
              Current best &lt; Target (weakness — redder = larger gap)
            </span>
            <span>
              <em>≈ italic</em> = estimated rep-max from the PR table — type in the cell to override
            </span>
            <span>
              <strong>Target kg</strong> = index × current reference · <strong>Goal target kg</strong> = index × goal reference ·
              both <strong>Δ</strong> pairs = current best − that target
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
        onRemap={learnAlias}
      />

      <Modal
        isOpen={saveModelOpen}
        onClose={() => setSaveModelOpen(false)}
        size="md"
        title="Save model"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', width: '100%' }}>
            <Button variant="ghost" onClick={() => setSaveModelOpen(false)}>
              Cancel
            </Button>
            {storedModel && (
              <Button variant="secondary" disabled={busy} onClick={() => void doSaveModel(true)} title={`Overwrite “${storedModel.name}” with the current sheet`}>
                Update “{storedModel.name}”
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={() => void doSaveModel(false)}>
              Save as new
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Saves the sheet's references, exercises and indices as a reusable model under <em>Saved models</em>.
            Textbook presets themselves stay unchanged — your version becomes its own entry.
          </p>
          <div style={{ maxWidth: 340 }}>
            <label style={{ ...capStyle, display: 'block', marginBottom: 4 }}>Model name</label>
            <Input value={modelName} onChange={(e) => setModelName(e.target.value)} autoFocus />
          </div>
          {unmappedCount > 0 && (
            <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', margin: 0 }}>
              ⚠ {unmappedCount} row{unmappedCount === 1 ? ' is' : 's are'} not mapped to a catalogue exercise and will
              be skipped — repoint {unmappedCount === 1 ? 'it' : 'them'} in the Exercise column first to keep{' '}
              {unmappedCount === 1 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      </Modal>

      <style>{`
        .sollist-inline-input:hover, .sollist-inline-select:hover { border-color: var(--color-border-secondary) !important; }
        .sollist-inline-input:focus, .sollist-inline-select:focus { border-color: var(--color-accent) !important; background: var(--color-bg-primary) !important; outline: none; }
        .sollist-row .sollist-row-remove { visibility: hidden; }
        .sollist-row:hover .sollist-row-remove { visibility: visible; }
        .sollist-row-remove:hover { color: var(--color-danger-text, #b3261e) !important; background: var(--color-bg-secondary) !important; }
        .sollist-row:hover td { background: var(--color-bg-secondary); }
        @media print { .print-only { display: block !important; } }
      `}</style>
      <SollIstModelManager
        open={managerOpen}
        models={models}
        exercises={sortedExercises}
        athletes={athletes}
        busy={busy}
        onClose={() => setManagerOpen(false)}
        onOpen={(ref) => onModelChange(ref)}
        onRename={renameModel}
        onDuplicate={duplicateModel}
        onDelete={removeModel}
      />
    </div>
  );
}
