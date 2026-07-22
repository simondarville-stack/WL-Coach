import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import type { MacroCycle, MacroTarget, MacroTableLayout, WeekType, PhaseTypePreset, RhythmPreset, EventType, Athlete, Exercise } from '../../lib/database.types';
import { DEFAULT_PHASE_TYPE_PRESETS, DEFAULT_RHYTHM_PRESETS } from '../../lib/constants';
import { MacroFillGuide } from './MacroFillGuide';
import { RhythmPresetManager } from './RhythmPresetManager';
import { MacroTemplateSaveModal } from './MacroTemplateSaveModal';
import { useMacroTemplates } from '../../hooks/useMacroTemplates';
import { materializeTemplate } from '../../lib/macroTemplate';
import type { MacroTemplateRow } from '../../lib/macroTemplate';
import { buildFillPlan } from './fillGuidePlan';
import type { FillGuideInputs, FillGuidePreview, FillWritePlan } from './fillGuidePlan';
import { useMacroCycles } from '../../hooks/useMacroCycles';
import type { MacroOwnerTarget } from '../../hooks/useMacroCycles';
import { useAthleteStore } from '../../store/athleteStore';
import { useExercises } from '../../hooks/useExercises';
import { generateMacroWeeks, getMondayOfWeekISO, findCurrentMacroWeek } from '../../lib/weekUtils';
import { formatDateToDDMMYYYY, addDaysToISO } from '../../lib/dateUtils';
import { MacroTableV2, DEFAULT_MACRO_TABLE_COLUMNS, DEFAULT_EXERCISE_METRICS, STRUCTURAL_MACRO_COLUMNS } from './MacroTableV2';
import type { MacroTableColumnKey, ExerciseMetricConfig, ExerciseColumnState } from './MacroTableV2';
import { MacroViewMenu } from './MacroViewMenu';
import { ExerciseToggleBar } from './ExerciseToggleBar';
import type { GeneralMetricKey } from './ExerciseToggleBar';
import { useSettings } from '../../hooks/useSettings';
import { useTrainingGroups } from '../../hooks/useTrainingGroups';
import { MacroGraphView } from './MacroGraphView';
import { MacroDistributionChart } from './MacroDistributionChart';
import { Chart as ChartJS, BarController, LineController, DoughnutController } from 'chart.js';
ChartJS.register(BarController, LineController, DoughnutController);
import { MacroSummaryBar } from './MacroSummaryBar';
import { MacroCreateModal } from './MacroCreateModal';
import { MacroEditModal } from './MacroEditModal';
import { MacroPhasesPanel } from './MacroPhasesPanel';
import { AthleteCardPicker } from '../AthleteCardPicker';
import { MacroAnnualWheel } from './MacroAnnualWheel';
import { MacroCycleToolbar } from './MacroCycleToolbar';
import { MacroCompetitionBadge } from './MacroCompetitionBadge';
import { useEvents } from '../../hooks/useEvents';
import { EventFormModal } from '../calendar/EventFormModal';
import { MacroTimeline } from '../planning';
import { resolveScopeAthleteIds, fetchTimelineMarkers } from '../../lib/macroTimelineData';
import type { TimelineMarker } from '../../lib/macroTimelineData';
import { StandardPage, AdaptiveDialog } from '../ui';
import { MacroExerciseDetail } from './MacroExerciseDetail';
import type { MacroContext } from '../planner/WeeklyPlanner';


export function MacroCycles() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { cycleId: urlCycleId } = useParams<{ cycleId?: string }>();
  const { selectedAthlete, selectedGroup, athletes: allAthletes } = useAthleteStore();
  const { exercises, fetchExercisesByName } = useExercises();
  const { settings, fetchSettingsSilent, updateSettings } = useSettings();
  const { groupMembers: hookGroupMembers, fetchGroupMembers } = useTrainingGroups();
  const { createEvent } = useEvents();

  const {
    macrocycles,
    macroWeeks,
    trackedExercises,
    targets,
    phases,
    competitions,
    loading,
    error,
    setError,
    fetchMacrocycles,
    createMacrocycle,
    deleteMacrocycle,
    fetchMacroWeeks,
    updateMacroWeek,
    swapMacroWeeks,
    fetchTrackedExercises,
    addTrackedExercise,
    swapTrackedExercisePositions,
    removeTrackedExercise,
    fetchTargets,
    upsertTarget,
    bulkUpsertTargets,
    bulkDeleteTargets,
    bulkUpdateWeeks,
    updateTrackedExerciseReference,
    fetchPhases,
    createPhase,
    updatePhase,
    deletePhase,
    fetchCompetitions,
    fetchMacroActuals,
    fetchActualsForAthlete,
    updateMacrocycle,
    updateMacrocycleLayout,
    extendCycle,
    trimCycle,
    shiftMacroWeeks,
  } = useMacroCycles();

  const [selectedCycle, setSelectedCycle] = useState<MacroCycle | null>(null);
  const [showChart, setShowChart] = useState(false);
  const [showDistribution, setShowDistribution] = useState(false);
  const [distKey, setDistKey] = useState(0);
  const [showReps, setShowReps] = useState(true);
  const [focusedExerciseId, setFocusedExerciseId] = useState<string | null>(null);
  const [actuals, setActuals] = useState<import('../../hooks/useMacroCycles').MacroActualsMap>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  // Non-null while the "Add event" modal is open, holding the preselected type
  // (competition / training camp) chosen from the toolbar menu.
  const [eventModalType, setEventModalType] = useState<EventType | null>(null);
  // Bumped after a cycle edit so the top MacroTimeline strip re-fetches the
  // shifted/updated weeks (its own effect is keyed only on ids, which don't
  // change when just the dates move).
  const [timelineReloadKey, setTimelineReloadKey] = useState(0);
  // Competition/camp markers overlapping each macro week (weekId → markers),
  // surfaced as Trophy/Tent icons in the table's week cell.
  const [weekMarkers, setWeekMarkers] = useState<Map<string, TimelineMarker[]>>(new Map());
  const [showPhasesPanel, setShowPhasesPanel] = useState(false);
  const [phasePanelInitialEdit, setPhasePanelInitialEdit] = useState<import('../../lib/database.types').MacroPhase | null>(null);
  const [showAddExercise, setShowAddExercise] = useState(false);
  /** Tracked-exercise id whose PR/history panel is open (null = closed). */
  const [detailTrackedExId, setDetailTrackedExId] = useState<string | null>(null);
  const [cycleMenuOpen, setCycleMenuOpen] = useState(false);

  // Group mode state — members come from useTrainingGroups
  const groupMembers = hookGroupMembers;
  const [individualViewAthleteId, setIndividualViewAthleteId] = useState<string | null>(null);
  const [individualActuals, setIndividualActuals] = useState<import('../../hooks/useMacroCycles').MacroActualsMap>({});

  // Shared exercise visibility state (lifted here so table and graph share the same state)
  const [visibleExercises, setVisibleExercises] = useState<Set<string>>(new Set());
  // Macro table column visibility — loaded from settings
  const [visibleColumns, setVisibleColumns] = useState<Set<MacroTableColumnKey>>(
    new Set(DEFAULT_MACRO_TABLE_COLUMNS)
  );
  // General metric visibility in the chart
  const [visibleGeneralMetrics, setVisibleGeneralMetrics] = useState<Set<GeneralMetricKey>>(
    new Set<GeneralMetricKey>(['k', 'tonnage', 'avg'])
  );

  const [highlightedPhaseId, setHighlightedPhaseId] = useState<string | null>(null);

  // ── Fill guide state ─────────────────────────────────────────────────────────
  const [showFillGuide, setShowFillGuide] = useState(false);
  const [fillPreview, setFillPreview] = useState<FillGuidePreview | null>(null);
  const [fillUndo, setFillUndo] = useState<{
    existingRows: MacroTarget[];
    createdIds: string[];
    weekRows: Array<{ id: string; week_type: string; total_reps_target: number | null }>;
  } | null>(null);
  const [lastFillInputs, setLastFillInputs] = useState<FillGuideInputs | null>(null);
  const [showRhythmManager, setShowRhythmManager] = useState(false);
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  // Chart ◆ anchor drags route into the fill guide through this registered setter
  const anchorSetterRef = useRef<((which: 'from' | 'to', kg: number) => void) | null>(null);
  const { templates, fetchTemplates, createTemplate, deleteTemplate, applyTemplate } = useMacroTemplates();

  useEffect(() => { void fetchTemplates(); }, []);

  // Coach rhythm presets: settings override, app defaults otherwise
  const rhythmPresets: RhythmPreset[] =
    (settings?.rhythm_presets?.length ? settings.rhythm_presets : DEFAULT_RHYTHM_PRESETS);

  const handleSaveRhythmPresets = useCallback(async (presets: RhythmPreset[]) => {
    if (!settings) return;
    await updateSettings(settings.id, { rhythm_presets: presets });
  }, [settings, updateSettings]);

  // ── Table view config (metric registry, column states, tints) — per macro ────
  const [exerciseMetrics, setExerciseMetrics] = useState<ExerciseMetricConfig[]>(DEFAULT_EXERCISE_METRICS);
  const [exColStates, setExColStates] = useState<Record<string, ExerciseColumnState>>({});
  const [consistencyTint, setConsistencyTint] = useState(true);
  const [collapsedHeatmap, setCollapsedHeatmap] = useState(true);
  const [notesCollapsed, setNotesCollapsed] = useState(false);

  // Persist the whole view config to macrocycles.table_layout (quiet write).
  // Each setter passes its NEXT value explicitly so we never persist stale state.
  const persistLayout = useCallback((overrides: Partial<MacroTableLayout>) => {
    if (!selectedCycle) return;
    const layout: MacroTableLayout = {
      exercises: exColStates,
      metrics: exerciseMetrics,
      // Always carry the current column visibility — otherwise a non-column
      // persist (collapse/expand, metric reorder, a tint toggle) would drop
      // baseColumns and the coach's hidden columns would spring back on reload.
      baseColumns: Array.from(visibleColumns),
      viewToggles: { consistency: consistencyTint, heatmap: collapsedHeatmap, notesCollapsed },
      v: 1, // stamp current layout version (see MacroTableLayout.v)
      ...overrides,
    };
    void updateMacrocycleLayout(selectedCycle.id, layout);
  }, [selectedCycle, exColStates, exerciseMetrics, visibleColumns, consistencyTint, collapsedHeatmap, notesCollapsed, updateMacrocycleLayout]);

  const applyMetrics = useCallback((m: ExerciseMetricConfig[]) => {
    setExerciseMetrics(m);
    persistLayout({ metrics: m });
  }, [persistLayout]);

  const applyColStates = useCallback((next: Record<string, ExerciseColumnState>) => {
    setExColStates(next);
    persistLayout({ exercises: next });
  }, [persistLayout]);

  const handleToggleCollapse = useCallback((teId: string) => {
    const cur = exColStates[teId] ?? {};
    applyColStates({ ...exColStates, [teId]: { collapsed: !cur.collapsed, expanded: false } });
  }, [exColStates, applyColStates]);

  const handleToggleExpand = useCallback((teId: string) => {
    const cur = exColStates[teId] ?? {};
    applyColStates({ ...exColStates, [teId]: { collapsed: false, expanded: !cur.expanded } });
  }, [exColStates, applyColStates]);

  // Helper: scroll to a phase row in the table and apply a brief highlight
  const scrollToPhase = useCallback((phaseId: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-phase-id="${phaseId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedPhaseId(phaseId);
        window.setTimeout(() => setHighlightedPhaseId(null), 1500);
      }
    });
  }, []);

  // Listen to ?phase= query param and scroll to that phase on load
  useEffect(() => {
    const phaseParam = searchParams.get('phase');
    if (phaseParam && phases.some(p => p.id === phaseParam)) {
      scrollToPhase(phaseParam);
      const next = new URLSearchParams(searchParams);
      next.delete('phase');
      setSearchParams(next, { replace: true });
    }
  }, [phases, searchParams, setSearchParams, scrollToPhase]);

  const toggleExercise = (teId: string) => {
    setVisibleExercises(prev => {
      const next = new Set(prev);
      if (next.has(teId)) next.delete(teId);
      else next.add(teId);
      return next;
    });
  };

  const toggleGeneralMetric = (metric: GeneralMetricKey) => {
    setVisibleGeneralMetrics(prev => {
      const next = new Set(prev);
      if (next.has(metric)) next.delete(metric);
      else next.add(metric);
      return next;
    });
  };

  // Determine current target (group or individual)
  const macroTarget: MacroOwnerTarget | null = selectedGroup
    ? { type: 'group', id: selectedGroup.id }
    : selectedAthlete
    ? { type: 'athlete', id: selectedAthlete.id }
    : null;

  const isGroupMode = macroTarget?.type === 'group';

  // Load exercises on mount + settings for column visibility
  useEffect(() => { fetchExercisesByName(); }, []);

  // Settings are fetched once; column visibility itself resolves in the
  // per-macro layout effect below (per-macro override → settings → defaults).
  useEffect(() => {
    void fetchSettingsSilent();
  }, []);

  // Load group members when in group mode
  useEffect(() => {
    if (selectedGroup) {
      fetchGroupMembers(selectedGroup.id);
    }
  }, [selectedGroup?.id]);

  // Load macrocycles when target changes
  useEffect(() => {
    if (macroTarget) {
      fetchMacrocycles(macroTarget);
      setIndividualViewAthleteId(null);
    }
  }, [selectedAthlete?.id, selectedGroup?.id]);

  // When the coach switches athlete/group via the top-right selector while
  // viewing a specific cycle, that cycle belongs to the PREVIOUS target — its
  // id won't match any macrocycle in the new list, so the URL-sync effect below
  // can't resolve it and the page would stay pinned to the previous athlete's
  // macro. Drop the stale :cycleId on an actual switch. A ref skips the initial
  // mount so deep-links (/macrocycles/:id) still resolve on first load.
  const prevTargetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = selectedAthlete?.id ?? (selectedGroup ? `g:${selectedGroup.id}` : null);
    const prev = prevTargetKeyRef.current;
    prevTargetKeyRef.current = key;
    // Only on a real athlete↔athlete/group SWITCH (both sides non-null). Clearing
    // the selection (key === null) is handled by AthleteSelector, which routes to
    // /dashboard — reacting here too would double-navigate.
    if (prev !== null && key !== null && prev !== key && urlCycleId) {
      setSelectedCycle(null);
      navigate('/macrocycles');
    }
  // urlCycleId/navigate are intentionally not triggers — only a target switch is.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAthlete?.id, selectedGroup?.id]);

  // Sync the URL cycleId param to selectedCycle. When the URL changes
  // (entering /macrocycles/:cycleId or going back to /macrocycles),
  // update internal state.
  useEffect(() => {
    if (!urlCycleId) {
      setSelectedCycle(null);
      return;
    }
    const cycle = macrocycles.find(c => c.id === urlCycleId);
    if (cycle) {
      setSelectedCycle(cycle);
    }
    // If cycle isn't loaded yet (initial mount before macros fetch
    // resolves), the dependency on `macrocycles` re-runs this when
    // they arrive.
  }, [urlCycleId, macrocycles]);

  // Load cycle data when cycle changes
  useEffect(() => {
    if (!selectedCycle) return;
    const id = selectedCycle.id;
    Promise.all([
      fetchMacroWeeks(id),
      fetchTrackedExercises(id),
      fetchPhases(id),
      fetchCompetitions(id),
    ]);
  }, [selectedCycle?.id]);

  // Fill-guide session state is per cycle — reset on navigation
  useEffect(() => {
    setShowFillGuide(false);
    setFillPreview(null);
    setFillUndo(null);
    setLastFillInputs(null);
  }, [selectedCycle?.id]);

  // Load the per-macro table view config. Saved metric order wins for known
  // keys; new registry entries (future metrics) append with their defaults.
  useEffect(() => {
    const layout = selectedCycle?.table_layout;
    const known = new Map(DEFAULT_EXERCISE_METRICS.map(m => [m.key, m]));
    const merged: ExerciseMetricConfig[] = [];
    for (const saved of layout?.metrics ?? []) {
      const base = known.get(saved.key as ExerciseMetricConfig['key']);
      if (base) {
        merged.push({ key: base.key, on: saved.on !== false });
        known.delete(base.key);
      }
    }
    merged.push(...Array.from(known.values(), m => ({ ...m })));
    setExerciseMetrics(merged);
    setExColStates((layout?.exercises as Record<string, ExerciseColumnState> | undefined) ?? {});
    setConsistencyTint(layout?.viewToggles?.consistency ?? true);
    setCollapsedHeatmap(layout?.viewToggles?.heatmap ?? true);
    setNotesCollapsed(layout?.viewToggles?.notesCollapsed ?? false);
    // Base columns: per-macro override → coach settings → app defaults.
    // Layouts (and the global default) saved before the Training Week / Dates /
    // Events columns existed get them unioned in so they aren't silently hidden;
    // once the layout is re-saved (v stamped) the coach's explicit hide/show
    // choices are respected verbatim.
    if (layout?.baseColumns?.length) {
      const cols = new Set(layout.baseColumns as MacroTableColumnKey[]);
      if (!layout.v) STRUCTURAL_MACRO_COLUMNS.forEach(c => cols.add(c));
      setVisibleColumns(cols);
    } else if (settings?.macro_table_columns?.length) {
      setVisibleColumns(new Set([...(settings.macro_table_columns as MacroTableColumnKey[]), ...STRUCTURAL_MACRO_COLUMNS]));
    } else {
      setVisibleColumns(new Set(DEFAULT_MACRO_TABLE_COLUMNS));
    }
  }, [selectedCycle?.id, selectedCycle?.table_layout, settings?.macro_table_columns]);

  const handleVisibleColumnsChange = useCallback((next: Set<MacroTableColumnKey>) => {
    setVisibleColumns(next);
    persistLayout({ baseColumns: Array.from(next) });
  }, [persistLayout]);

  // Load targets when weeks change
  useEffect(() => {
    if (macroWeeks.length > 0) {
      fetchTargets(macroWeeks.map(w => w.id));
    }
  }, [macroWeeks.length]);

  // Initialize visibleExercises when tracked exercises load
  useEffect(() => {
    setVisibleExercises(new Set(trackedExercises.map(t => t.id)));
  }, [trackedExercises.length]);

  // Load actuals when weeks + tracked exercises are ready
  useEffect(() => {
    if (!macroTarget || macroWeeks.length === 0 || trackedExercises.length === 0) return;
    fetchMacroActuals(macroTarget, macroWeeks, trackedExercises).then(setActuals);
  }, [selectedAthlete?.id, selectedGroup?.id, macroWeeks.length, trackedExercises.length]);

  // Fetch competitions + camps for the cycle range and bucket them per week
  // (weekId → markers overlapping that week's Mon–Sun) for the table icons.
  // Reuses the timeline data path so macro_competitions, competition-type
  // events and training camps are all included and de-duplicated.
  useEffect(() => {
    let cancelled = false;
    if (!selectedCycle || macroWeeks.length === 0) { setWeekMarkers(new Map()); return; }
    void (async () => {
      try {
        const athleteIds = await resolveScopeAthleteIds(selectedAthlete?.id ?? null, selectedGroup?.id ?? null);
        // Fetch over the week-aligned span (first Monday … last Sunday), NOT the
        // raw cycle dates — those are often mid-week, so a marker inside a
        // boundary week but outside [start_date, end_date] would be filtered out
        // before bucketing and its icon silently dropped (the top strip, which
        // fetches week-aligned, would still show it → inconsistent UI).
        const weekStarts = macroWeeks.map(w => w.week_start);
        const rangeStart = weekStarts.reduce((a, b) => (a < b ? a : b));
        const rangeEnd = addDaysToISO(weekStarts.reduce((a, b) => (a > b ? a : b)), 6);
        const markers = await fetchTimelineMarkers(
          athleteIds, [selectedCycle.id], rangeStart, rangeEnd,
        );
        if (cancelled) return;
        const bucket = new Map<string, TimelineMarker[]>();
        for (const w of macroWeeks) {
          const wStart = w.week_start;
          const wEnd = addDaysToISO(w.week_start, 6);
          const hits = markers.filter(m => m.date <= wEnd && (m.endDate ?? m.date) >= wStart);
          if (hits.length) bucket.set(w.id, hits);
        }
        setWeekMarkers(bucket);
      } catch (err) {
        if (!cancelled) { console.error('MacroCycles: marker load failed', err); setWeekMarkers(new Map()); }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCycle?.id, selectedCycle?.start_date, selectedCycle?.end_date, selectedAthlete?.id, selectedGroup?.id, macroWeeks, timelineReloadKey]);

  // Load individual athlete actuals for "individual view" in group mode
  useEffect(() => {
    if (!individualViewAthleteId || macroWeeks.length === 0 || trackedExercises.length === 0) {
      setIndividualActuals({});
      return;
    }
    fetchActualsForAthlete(individualViewAthleteId, macroWeeks, trackedExercises)
      .then(setIndividualActuals);
  }, [individualViewAthleteId, macroWeeks.length, trackedExercises.length]);

  // ─── Create macrocycle ───────────────────────────────────────────────────────

  const handleCreateCycle = async (data: {
    name: string;
    startDate: string;
    endDate: string;
    competitions: { name: string; date: string; is_primary: boolean }[];
    phasePreset: 'none' | '8week' | '12week' | 'custom';
    template?: MacroTemplateRow;
    templateReferences?: Record<string, number | null>;
  }) => {
    if (!macroTarget) return;

    const defaultWeekType = (settings?.week_types?.[0]?.abbreviation ?? '') as WeekType;
    const weekInserts = generateMacroWeeks(data.startDate, data.endDate).map(w => ({
      macrocycle_id: '',
      week_start: w.week_start,
      week_number: w.week_number,
      week_type: defaultWeekType,
      week_type_text: '',
      notes: '',
    }));

    const cycle = await createMacrocycle(
      macroTarget, data.name, data.startDate, data.endDate, weekInserts,
    );

    // Create competitions as shared events (calendar ↔ macro are one source),
    // attached to the macro's athlete(s). The primary one becomes the cycle's
    // target event (macrocycles.primary_event_id).
    const scopeAthleteIds = isGroupMode
      ? groupMembers.map(gm => gm.athlete_id)
      : (selectedAthlete ? [selectedAthlete.id] : []);
    let primaryEventId: string | null = null;
    for (const c of data.competitions) {
      if (!c.name.trim() || !c.date) continue;
      const ev = await createEvent(
        { name: c.name.trim(), event_type: 'competition', event_date: c.date, is_all_day: true },
        scopeAthleteIds,
      );
      if (ev && c.is_primary) primaryEventId = ev.id;
    }
    if (primaryEventId) await updateMacrocycle(cycle.id, { primary_event_id: primaryEventId });

    // Apply a template: week rhythm + phases + exercises + targets, all in one
    if (data.template) {
      const mat = materializeTemplate(data.template, data.templateReferences ?? {});
      await applyTemplate(cycle.id, mat);
      navigate(`/macrocycles/${cycle.id}`);
      setShowCreateModal(false);
      return;
    }

    // Create phase presets
    const totalWeeks = weekInserts.length;
    if (data.phasePreset === '8week' && totalWeeks >= 8) {
      const prep = Math.max(1, totalWeeks - 4);
      await createPhase({ macrocycle_id: cycle.id, name: 'Preparatory', phase_type: 'preparatory', start_week_number: 1, end_week_number: prep, color: '#DBEAFE', notes: '', position: 1 });
      await createPhase({ macrocycle_id: cycle.id, name: 'Competition', phase_type: 'competition', start_week_number: prep + 1, end_week_number: totalWeeks, color: '#FEF3C7', notes: '', position: 2 });
    } else if (data.phasePreset === '12week' && totalWeeks >= 12) {
      const accum = Math.floor(totalWeeks * 0.4);
      const strength = Math.floor(totalWeeks * 0.35);
      const compStart = accum + strength + 1;
      await createPhase({ macrocycle_id: cycle.id, name: 'Accumulation', phase_type: 'preparatory', start_week_number: 1, end_week_number: accum, color: '#DBEAFE', notes: '', position: 1 });
      await createPhase({ macrocycle_id: cycle.id, name: 'Strength', phase_type: 'strength', start_week_number: accum + 1, end_week_number: accum + strength, color: '#FEE2E2', notes: '', position: 2 });
      await createPhase({ macrocycle_id: cycle.id, name: 'Competition', phase_type: 'competition', start_week_number: compStart, end_week_number: totalWeeks, color: '#FEF3C7', notes: '', position: 3 });
    }

    navigate(`/macrocycles/${cycle.id}`);
    setShowCreateModal(false);
  };

  // ─── Update week ─────────────────────────────────────────────────────────────

  const handleUpdateWeekType = useCallback(async (weekId: string, weekType: WeekType) => {
    await updateMacroWeek(weekId, { week_type: weekType });
  }, [updateMacroWeek]);

  const handleUpdateTotalReps = useCallback(async (weekId: string, value: string) => {
    const num = value.trim() === '' ? null : parseInt(value, 10);
    if (num !== null && isNaN(num)) return;
    await updateMacroWeek(weekId, { total_reps_target: num });
  }, [updateMacroWeek]);

  const handleUpdateNotes = useCallback(async (weekId: string, notes: string) => {
    await updateMacroWeek(weekId, { notes });
  }, [updateMacroWeek]);

  const handleSwapWeeks = useCallback(async (weekId1: string, weekId2: string) => {
    await swapMacroWeeks(weekId1, weekId2);
  }, [swapMacroWeeks]);

  const handleUpdateTonnageTarget = useCallback(async (weekId: string, value: string) => {
    const num = value.trim() === '' ? null : parseFloat(value);
    if (num !== null && isNaN(num)) return;
    await updateMacroWeek(weekId, { tonnage_target: num });
  }, [updateMacroWeek]);

  const handleUpdateAvgTarget = useCallback(async (weekId: string, value: string) => {
    const num = value.trim() === '' ? null : parseFloat(value);
    if (num !== null && isNaN(num)) return;
    await updateMacroWeek(weekId, { avg_intensity_target: num });
  }, [updateMacroWeek]);

  // ─── Update target ────────────────────────────────────────────────────────────

  const handleUpdateTarget = useCallback(async (weekId: string, trackedExId: string, field: keyof MacroTarget, value: string) => {
    const numValue = value.trim() === '' ? null : parseFloat(value);
    if (numValue !== null && isNaN(numValue)) return;
    const existing = targets.find(t => t.macro_week_id === weekId && t.tracked_exercise_id === trackedExId);
    await upsertTarget(weekId, trackedExId, field, numValue, existing);
  }, [targets, upsertTarget]);

  const handleDragTarget = useCallback(async (weekId: string, trackedExId: string, field: keyof MacroTarget, value: number) => {
    const existing = targets.find(t => t.macro_week_id === weekId && t.tracked_exercise_id === trackedExId);
    await upsertTarget(weekId, trackedExId, field, value, existing);
  }, [targets, upsertTarget]);

  // ─── Fill guide ───────────────────────────────────────────────────────────────
  // Apply writes plain rows (table = source of truth); undo restores a snapshot.

  const pairKey = (weekId: string, teId: string) => `${weekId}|${teId}`;

  // Shared in-flight flag for the bulk fill operations (apply / undo /
  // re-modulate) — prevents concurrent bulk writes from double-clicks.
  const [fillBusy, setFillBusy] = useState(false);

  const handleApplyFill = useCallback(async (plan: FillWritePlan, inputs: FillGuideInputs) => {
    if (fillBusy) return;
    const affectedPairs = new Set(plan.targetRows.map(r => pairKey(r.macro_week_id, r.tracked_exercise_id)));
    const existingRows = targets
      .filter(t => affectedPairs.has(pairKey(t.macro_week_id, t.tracked_exercise_id)))
      .map(t => ({ ...t }));
    const existingPairSet = new Set(existingRows.map(t => pairKey(t.macro_week_id, t.tracked_exercise_id)));
    const weekRows = macroWeeks
      .filter(w => plan.weekUpdates.some(u => u.id === w.id))
      .map(w => ({ id: w.id, week_type: w.week_type, total_reps_target: w.total_reps_target }));

    setFillBusy(true);
    let returned: MacroTarget[] = [];
    try {
      returned = await bulkUpsertTargets(plan.targetRows);
      await bulkUpdateWeeks(plan.weekUpdates);
    } catch (err) {
      // Partial apply is possible (writes commit group by group): arm undo
      // with everything we know landed, drop the stale ghost overlay, and
      // resync targets from the DB. The hook's error banner explains the
      // failure; the guide stays open so the coach can retry.
      const createdIds = returned
        .filter(r => !existingPairSet.has(pairKey(r.macro_week_id, r.tracked_exercise_id)))
        .map(r => r.id);
      if (createdIds.length > 0 || existingRows.length > 0) {
        setFillUndo({ existingRows, createdIds, weekRows });
        setLastFillInputs(inputs);
      }
      setFillPreview(null);
      if (macroWeeks.length > 0) void fetchTargets(macroWeeks.map(w => w.id));
      setFillBusy(false);
      throw err; // let the fill guide's Apply button reset its own busy state
    }

    const createdIds = returned
      .filter(r => !existingPairSet.has(pairKey(r.macro_week_id, r.tracked_exercise_id)))
      .map(r => r.id);
    setFillUndo({ existingRows, createdIds, weekRows });
    setLastFillInputs(inputs);
    setShowFillGuide(false);
    setFillPreview(null);
    setFillBusy(false);
  }, [fillBusy, targets, macroWeeks, bulkUpsertTargets, bulkUpdateWeeks, fetchTargets]);

  const handleUndoFill = useCallback(async () => {
    if (!fillUndo || fillBusy) return;
    setFillBusy(true);
    try {
      await bulkDeleteTargets(fillUndo.createdIds);
      await bulkUpsertTargets(fillUndo.existingRows.map(t => ({
        macro_week_id: t.macro_week_id,
        tracked_exercise_id: t.tracked_exercise_id,
        fields: {
          target_reps: t.target_reps,
          target_avg: t.target_avg,
          target_max: t.target_max,
          target_reps_at_max: t.target_reps_at_max,
          target_sets_at_max: t.target_sets_at_max,
          note: t.note,
        },
      })));
      await bulkUpdateWeeks(fillUndo.weekRows);
      setFillUndo(null);
    } finally {
      setFillBusy(false);
    }
  }, [fillUndo, fillBusy, bulkDeleteTargets, bulkUpsertTargets, bulkUpdateWeeks]);

  // Re-modulate: re-run the last fill's anchors + rhythm against the CURRENT
  // week types (explicit action, overwrites that fill's cells).
  const handleRemodulate = useCallback(async () => {
    if (!lastFillInputs || fillBusy) return;
    const inputs = { ...lastFillInputs, overwrite: true };
    const plan = buildFillPlan(inputs, macroWeeks, trackedExercises, targets, settings?.week_types ?? []);
    if (plan.cellCount === 0) {
      setError('Re-modulate produced no cells — the anchors or tracked exercises have changed since the last fill.');
      return;
    }
    try {
      await handleApplyFill(plan, lastFillInputs);
    } catch {
      // surfaced via the error banner
    }
  }, [lastFillInputs, fillBusy, macroWeeks, trackedExercises, targets, settings?.week_types, handleApplyFill, setError]);

  // ─── Weekly exercise note ───────────────────────────────────────────────────
  // A macro_targets row may hold only a note (all numeric targets NULL).
  const handleUpdateTargetNote = useCallback(async (weekId: string, teId: string, note: string) => {
    const trimmed = note.trim();
    await bulkUpsertTargets([{
      macro_week_id: weekId,
      tracked_exercise_id: teId,
      fields: { note: trimmed || null },
    }]);
  }, [bulkUpsertTargets]);

  // ─── Paste week ───────────────────────────────────────────────────────────────

  const handlePasteTargets = useCallback(async (
    targetWeekId: string,
    copiedTargets: Record<string, Partial<MacroTarget>>,
  ) => {
    await Promise.all(
      Object.entries(copiedTargets).flatMap(([trackedExId, vals]) =>
        (Object.entries(vals) as [keyof MacroTarget, number | null][]).map(([field, val]) => {
          if (val === null || val === undefined) return Promise.resolve();
          const existing = targets.find(t => t.macro_week_id === targetWeekId && t.tracked_exercise_id === trackedExId);
          return upsertTarget(targetWeekId, trackedExId, field, val, existing);
        })
      )
    );
  }, [targets, upsertTarget]);

  // ─── Import from Excel ────────────────────────────────────────────────────────

  /**
   * Write imported targets. Rows arrive one FIELD at a time (5 per exercise
   * per week), so a 12-week × 6-exercise file is ~360 rows. Writing them one
   * at a time was ~360 sequential round-trips; folding the fields of one
   * (week, exercise) into a single row makes it a handful of bulk upserts.
   */
  const handleImportTargets = useCallback(async (
    rows: { weekId: string; trackedExId: string; field: keyof MacroTarget; value: number }[],
  ) => {
    const merged = new Map<string, { macro_week_id: string; tracked_exercise_id: string; fields: Partial<MacroTarget> }>();
    for (const row of rows) {
      const key = `${row.weekId}|${row.trackedExId}`;
      const entry = merged.get(key) ?? {
        macro_week_id: row.weekId,
        tracked_exercise_id: row.trackedExId,
        fields: {},
      };
      (entry.fields as Record<string, number>)[row.field] = row.value;
      merged.set(key, entry);
    }
    await bulkUpsertTargets(Array.from(merged.values()));
  }, [bulkUpsertTargets]);

  /** Week-level import (a template's week type + weekly Σreps target). */
  const handleImportWeeks = useCallback(async (
    rows: Array<{ id: string; week_type?: string; total_reps_target?: number | null }>,
  ) => {
    await bulkUpdateWeeks(rows);
  }, [bulkUpdateWeeks]);

  // ─── Exercise management ──────────────────────────────────────────────────────

  // Add a tracked exercise directly from the ranked ExerciseSearch. The search
  // field stays open so the coach can add several in a row (already-tracked ones
  // drop out of availableExercises automatically).
  const handleAddExerciseDirect = async (exercise: Exercise) => {
    if (!selectedCycle) return;
    const nextPosition = trackedExercises.length > 0
      ? Math.max(...trackedExercises.map(te => te.position)) + 1
      : 0;
    await addTrackedExercise(selectedCycle.id, exercise.id, nextPosition);
    await fetchTrackedExercises(selectedCycle.id);
  };

  const handleMoveExerciseLeft = async (trackedExId: string) => {
    const idx = trackedExercises.findIndex(te => te.id === trackedExId);
    if (idx <= 0) return;
    const prev = trackedExercises[idx - 1];
    await swapTrackedExercisePositions(trackedExId, prev.position, prev.id, trackedExercises[idx].position);
    await fetchTrackedExercises(selectedCycle!.id);
  };

  const handleMoveExerciseRight = async (trackedExId: string) => {
    const idx = trackedExercises.findIndex(te => te.id === trackedExId);
    if (idx < 0 || idx >= trackedExercises.length - 1) return;
    const next = trackedExercises[idx + 1];
    await swapTrackedExercisePositions(trackedExId, next.position, next.id, trackedExercises[idx].position);
    await fetchTrackedExercises(selectedCycle!.id);
  };

  const handleRemoveExercise = async (trackedExId: string) => {
    if (!confirm('Remove this exercise from tracking? Targets will be deleted.')) return;
    await removeTrackedExercise(trackedExId);
    await fetchTrackedExercises(selectedCycle!.id);
  };

  // ─── Edit cycle ───────────────────────────────────────────────────────────────

  const handleEditCycle = async (data: {
    name: string;
    startDate: string;
    endDate: string;
  }) => {
    if (!selectedCycle) return;

    // A start-date edit slides the WHOLE cycle in time — every week keeps its
    // structure, type, notes and targets. The shift is Monday-of-new minus
    // Monday-of-old (always a multiple of 7). When only the start moved, the
    // end slides by the same amount so the week count is preserved; an explicit
    // end edit wins.
    const oldStartMonday = getMondayOfWeekISO(new Date(selectedCycle.start_date + 'T00:00:00'));
    const newStartMonday = getMondayOfWeekISO(new Date(data.startDate + 'T00:00:00'));
    const shiftDays = Math.round((Date.parse(newStartMonday) - Date.parse(oldStartMonday)) / 86400000);
    const endChangedByUser = data.endDate !== selectedCycle.end_date;
    const slidEnd = shiftDays !== 0 ? addDaysToISO(selectedCycle.end_date, shiftDays) : selectedCycle.end_date;
    const desiredEnd = endChangedByUser ? data.endDate : slidEnd;

    await updateMacrocycle(selectedCycle.id, {
      name: data.name,
      start_date: data.startDate,
      end_date: desiredEnd,
    });

    // 1) Slide existing weeks (DB + local) so the table re-dates on a start move.
    if (shiftDays !== 0) {
      await shiftMacroWeeks(selectedCycle.id, shiftDays);
    }
    // 2) Reconcile the tail against the desired end, operating on the SHIFTED
    //    weeks: extend adds Mondays past the (shifted) last week; trim deletes
    //    weeks now beyond the desired end. `macroWeeks` here is the pre-shift
    //    snapshot, so the shifted last-week start is derived explicitly.
    if (desiredEnd > slidEnd) {
      const lastWeek = macroWeeks[macroWeeks.length - 1];
      if (lastWeek) {
        const s = await fetchSettingsSilent();
        const defaultWeekType = s?.week_types?.[0]?.abbreviation ?? '';
        await extendCycle(
          selectedCycle.id,
          lastWeek.week_number,
          addDaysToISO(lastWeek.week_start, shiftDays),
          desiredEnd,
          defaultWeekType,
        );
      }
    } else if (desiredEnd < slidEnd) {
      await trimCycle(selectedCycle.id, desiredEnd);
    }

    const updated = { ...selectedCycle, name: data.name, start_date: data.startDate, end_date: desiredEnd };
    setSelectedCycle(updated);
    await Promise.all([
      fetchMacroWeeks(selectedCycle.id),
      fetchCompetitions(selectedCycle.id),
    ]);
    setTimelineReloadKey(k => k + 1);
    setShowEditModal(false);
  };

  // ─── Events (competitions / training camps) ───────────────────────────────────
  // Added from the toolbar's "Add event" menu. Competitions and camps live in
  // the shared events model (event_athletes), so one entry shows on the macro
  // timeline, the calendar and the athlete dashboard alike. The current scope's
  // athletes are preselected.
  const eventAthletes: Athlete[] = isGroupMode
    ? groupMembers.map(m => m.athlete)
    : (selectedAthlete ? [selectedAthlete] : []);

  const handleSaveEvent = async (data: {
    name: string; event_type: EventType; event_date: string; end_date: string;
    is_all_day: boolean; start_time: string; end_time: string; location: string;
    description: string; notes: string; external_url: string; color: string;
    athlete_ids: string[];
  }) => {
    // An event with no athletes attaches to nobody and never surfaces on the
    // timeline/table (markers are fetched via event_athletes). Require ≥1.
    if (data.athlete_ids.length === 0) {
      alert('Add at least one athlete so this event shows on the timeline.');
      return;
    }
    await createEvent({
      name: data.name,
      event_type: data.event_type,
      event_date: data.event_date,
      end_date: data.end_date || null,
      description: data.description || null,
      location: data.location || null,
      color: data.color || null,
      notes: data.notes || null,
      is_all_day: data.is_all_day,
      start_time: data.is_all_day ? null : (data.start_time || null),
      end_time: data.is_all_day ? null : (data.end_time || null),
      external_url: data.external_url || null,
    }, data.athlete_ids);
    setEventModalType(null);
    setTimelineReloadKey(k => k + 1);
    // Competitions feed the header chips + chart from the events model, so
    // refresh them too (not just the timeline strip / week markers).
    if (selectedCycle) await fetchCompetitions(selectedCycle.id);
  };

  // Designate (or clear) the macro's target competition — clicking a header
  // competition chip sets macrocycles.primary_event_id to that event.
  const handleSetPrimaryCompetition = async (eventId: string | null) => {
    if (!selectedCycle || !eventId) return;
    const next = selectedCycle.primary_event_id === eventId ? null : eventId;
    await updateMacrocycle(selectedCycle.id, { primary_event_id: next });
    setSelectedCycle({ ...selectedCycle, primary_event_id: next });
    await fetchCompetitions(selectedCycle.id);
    setTimelineReloadKey(k => k + 1);
  };

  // ─── Delete cycle ─────────────────────────────────────────────────────────────

  const handleDeleteCycle = async () => {
    if (!selectedCycle) return;
    if (!confirm(`Delete "${selectedCycle.name}"? This cannot be undone.`)) return;
    await deleteMacrocycle(selectedCycle.id);
    setSelectedCycle(null);
    navigate('/macrocycles');
  };

  // ─── Phase save / delete ──────────────────────────────────────────────────────

  const handleSavePhase = async (
    phaseData: Omit<import('../../lib/database.types').MacroPhase, 'id' | 'owner_id' | 'created_at' | 'updated_at'>,
    editingId?: string
  ) => {
    if (editingId) {
      await updatePhase(editingId, phaseData);
    } else {
      await createPhase(phaseData);
    }
  };

  const handleDeletePhase = async (id: string) => {
    await deletePhase(id);
  };

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'c' || e.key === 'C') setShowChart(v => !v);
      if (e.key === 'd' || e.key === 'D') setShowDistribution(v => { if (!v) setDistKey(k => k + 1); return !v; });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (!macroTarget) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <AthleteCardPicker />
      </div>
    );
  }

  const availableExercises = exercises.filter(
    ex => ex.category !== '— System' && !trackedExercises.some(te => te.exercise_id === ex.id)
  );

  // Decide which actuals to show in views
  const displayedActuals = (isGroupMode && individualViewAthleteId) ? individualActuals : actuals;

  // ── Exercise detail panel (PRs + load history) ──────────────────────────
  // Opened from the table's exercise header / toggle chip. The chart wants a
  // MacroContext so it can draw this cycle's SOLL line and mark the current
  // week; we anchor on the live macro week (or week 1 for a past/future cycle).
  const detailExercise = trackedExercises.find(te => te.id === detailTrackedExId)?.exercise ?? null;
  const detailAthleteId = individualViewAthleteId ?? selectedAthlete?.id ?? null;
  const detailAthleteName =
    allAthletes.find(a => a.id === detailAthleteId)?.name ?? selectedAthlete?.name ?? null;
  const detailAnchorWeek = findCurrentMacroWeek(macroWeeks) ?? macroWeeks[0] ?? null;
  const detailMacroContext: MacroContext | null = selectedCycle && detailAnchorWeek
    ? {
        macroId: selectedCycle.id,
        macroName: selectedCycle.name,
        weekType: detailAnchorWeek.week_type,
        weekTypeText: detailAnchorWeek.week_type_text,
        weekNumber: detailAnchorWeek.week_number,
        totalWeeks: macroWeeks.length,
        phaseName: null,
        phaseColor: null,
        totalRepsTarget: detailAnchorWeek.total_reps_target,
        weekNotes: '',
      }
    : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Error banner — outside the cycle/wheel branch so load failures are
          visible on the annual-wheel landing view too (not just inside a cycle). */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center justify-between flex-shrink-0">
          {error}
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 ml-2">×</button>
        </div>
      )}
      {selectedCycle ? (<StandardPage>
      {/* Top toolbar */}
      <MacroCycleToolbar
        selectedCycle={selectedCycle}
        macrocycles={macrocycles}
        cycleMenuOpen={cycleMenuOpen}
        isGroupMode={isGroupMode}
        selectedGroup={selectedGroup ?? null}
        groupMembers={groupMembers}
        individualViewAthleteId={individualViewAthleteId}
        showAddExercise={showAddExercise}
        availableExercises={availableExercises}
        showChart={showChart}
        showDistribution={showDistribution}
        macroWeeks={macroWeeks}
        trackedExercises={trackedExercises}
        targets={targets}
        phases={phases}
        actuals={actuals}
        athleteName={isGroupMode ? selectedGroup?.name : selectedAthlete?.name}
        athleteId={selectedAthlete?.id ?? null}
        cycleNameForFile={selectedCycle?.name ?? ''}
        cycleDateRange={selectedCycle ? { start: selectedCycle.start_date, end: selectedCycle.end_date } : null}
        onBack={() => navigate('/macrocycles')}
        onCycleMenuToggle={() => setCycleMenuOpen(o => !o)}
        onSelectCycle={(mc) => { navigate(`/macrocycles/${mc.id}`); setCycleMenuOpen(false); }}
        onCreateCycle={() => setShowCreateModal(true)}
        onChartToggle={() => setShowChart(v => !v)}
        onDistributionToggle={() => setShowDistribution(v => { if (!v) setDistKey(k => k + 1); return !v; })}
        onIndividualViewChange={setIndividualViewAthleteId}
        onShowAddExercise={() => setShowAddExercise(true)}
        onCancelAddExercise={() => setShowAddExercise(false)}
        onAddExerciseDirect={handleAddExerciseDirect}
        onAddPhase={() => { setPhasePanelInitialEdit(null); setShowPhasesPanel(true); }}
        onAddEvent={(type) => setEventModalType(type)}
        onEditCycle={() => setShowEditModal(true)}
        onDeleteCycle={handleDeleteCycle}
        onImportTargets={handleImportTargets}
        onImportWeeks={handleImportWeeks}
        weekTypes={settings?.week_types ?? []}
        fillGuideOpen={showFillGuide}
        onFillGuideToggle={() => setShowFillGuide(v => !v)}
        canUndoFill={!!fillUndo}
        onUndoFill={handleUndoFill}
        canRemodulate={!!lastFillInputs}
        onRemodulate={handleRemodulate}
        fillBusy={fillBusy}
        onSaveTemplate={() => setShowTemplateSave(true)}
      />

      {/* Cycle info + phase bar */}
      {selectedCycle && (
        <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50">
          <div style={{ padding: '12px 16px 8px' }}>
            <MacroTimeline
              mode="macro"
              cycleId={selectedCycle.id}
              contextWeeks={0}
              reloadKey={timelineReloadKey}
              athleteId={selectedAthlete?.id ?? null}
              groupId={selectedGroup?.id ?? null}
              onPhaseClick={(week) => {
                const phase = phases.find(
                  p => p.macrocycle_id === week.macroId && p.name === week.phaseName
                );
                if (phase) scrollToPhase(phase.id);
              }}
            />
          </div>

          {/* Meta row: cycle name, dates, week count, group, competitions */}
          <div className="flex items-center gap-3 px-4 py-1.5 text-xs text-gray-600 flex-wrap">
            <span className="font-medium text-gray-800">{selectedCycle.name}</span>
            <span className="text-gray-400">{formatDateToDDMMYYYY(selectedCycle.start_date)} → {formatDateToDDMMYYYY(selectedCycle.end_date)}</span>
            <span className="text-gray-400">{macroWeeks.length} weeks</span>
            {isGroupMode && selectedGroup && (
              <span className="flex items-center gap-1 text-purple-600 font-medium">
                <Users size={11} />
                {selectedGroup.name}
                {groupMembers.length > 0 && (
                  <span className="text-gray-400 font-normal ml-1">
                    ({groupMembers.length} members: {groupMembers.map(m => m.athlete.name).join(', ')})
                  </span>
                )}
              </span>
            )}
            {competitions.map(comp => (
              <MacroCompetitionBadge
                key={comp.id}
                competition={comp}
                onSetPrimary={() => handleSetPrimaryCompetition(comp.event_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Toggle bar: exercises + general metrics + view menu — present as
              soon as the cycle has weeks, so general targets are workable
              before any exercise is tracked */}
          {macroWeeks.length > 0 && (
            <div className="px-3 pt-2 pb-1 flex-shrink-0 flex items-center gap-2 flex-wrap border-b border-gray-100">
              <ExerciseToggleBar
                exercises={trackedExercises}
                visible={visibleExercises}
                onToggle={toggleExercise}
                onOpenDetail={setDetailTrackedExId}
                onShowAll={() => setVisibleExercises(new Set(trackedExercises.map(t => t.id)))}
                generalMetrics={['k', 'tonnage', 'avg']}
                visibleMetrics={visibleGeneralMetrics}
                onToggleMetric={toggleGeneralMetric}
              />
              {/* Reps toggle chip */}
              <button
                onClick={() => setShowReps(v => !v)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors flex-shrink-0 ${
                  showReps
                    ? 'bg-gray-700 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-400 line-through'
                }`}
                title="Toggle reps bar in chart"
              >
                Reps
              </button>
              <MacroViewMenu
                metrics={exerciseMetrics}
                onMetricsChange={applyMetrics}
                visibleColumns={visibleColumns}
                onVisibleColumnsChange={handleVisibleColumnsChange}
                notesCollapsed={notesCollapsed}
                onNotesCollapsedChange={(v) => { setNotesCollapsed(v); persistLayout({ viewToggles: { consistency: consistencyTint, heatmap: collapsedHeatmap, notesCollapsed: v } }); }}
                consistencyTint={consistencyTint}
                onConsistencyTintChange={(v) => { setConsistencyTint(v); persistLayout({ viewToggles: { consistency: v, heatmap: collapsedHeatmap, notesCollapsed } }); }}
                collapsedHeatmap={collapsedHeatmap}
                onCollapsedHeatmapChange={(v) => { setCollapsedHeatmap(v); persistLayout({ viewToggles: { consistency: consistencyTint, heatmap: v, notesCollapsed } }); }}
                onCollapseAll={() => applyColStates(Object.fromEntries(trackedExercises.map(te => [te.id, { collapsed: true, expanded: false }])))}
                onExpandAll={() => applyColStates({})}
              />
            </div>
          )}

          {/* Table — always visible */}
          <div className="px-4 pt-3 pb-2">
            <MacroTableV2
              macroWeeks={macroWeeks}
              trackedExercises={trackedExercises}
              targets={targets}
              phases={phases}
              actuals={displayedActuals}
              onUpdateTarget={handleUpdateTarget}
              onUpdateWeekType={handleUpdateWeekType}
              onUpdateTotalReps={handleUpdateTotalReps}
              onUpdateTonnageTarget={handleUpdateTonnageTarget}
              onUpdateAvgTarget={handleUpdateAvgTarget}
              onUpdateNotes={handleUpdateNotes}
              onMoveExerciseLeft={handleMoveExerciseLeft}
              onMoveExerciseRight={handleMoveExerciseRight}
              onRemoveExercise={handleRemoveExercise}
              onPasteTargets={handlePasteTargets}
              onExerciseDoubleClick={(id) => { setFocusedExerciseId(id); setShowChart(true); }}
              onOpenExerciseDetail={setDetailTrackedExId}
              onSwapWeeks={handleSwapWeeks}
              competitionTotal={selectedAthlete?.competition_total ?? null}
              visibleExercises={visibleExercises}
              visibleColumns={visibleColumns}
              weekTypes={settings?.week_types ?? []}
              highlightedPhaseId={highlightedPhaseId}
              fillPreview={fillPreview}
              metrics={exerciseMetrics}
              exerciseColumnStates={exColStates}
              onToggleCollapse={handleToggleCollapse}
              onToggleExpand={handleToggleExpand}
              consistencyTint={consistencyTint}
              collapsedHeatmap={collapsedHeatmap}
              notesCollapsed={notesCollapsed}
              onUpdateTargetNote={handleUpdateTargetNote}
              weekMarkers={weekMarkers}
            />
          </div>

          {/* Chart — shown below table when toggled */}
          {showChart && (
            <div className="px-4 pb-4 pt-2">
              <MacroGraphView
                macroWeeks={macroWeeks}
                trackedExercises={trackedExercises}
                targets={targets}
                competitions={competitions}
                actuals={displayedActuals}
                weekTypes={settings?.week_types ?? []}
                onDragTarget={handleDragTarget}
                focusedExerciseId={focusedExerciseId}
                visibleExercises={visibleExercises}
                showReps={showReps}
                fillPreview={fillPreview}
                visibleGeneralSeries={visibleGeneralMetrics}
                onDragWeekTarget={async (weekId, field, value) => { await updateMacroWeek(weekId, { [field]: value }); }}
                onDragAnchor={(which, kg) => anchorSetterRef.current?.(which, kg)}
              />
            </div>
          )}

          {/* Distribution chart */}
          {showDistribution && (
            <div key={distKey} className="px-4 pb-4 pt-2">
              <MacroDistributionChart
                macroWeeks={macroWeeks}
                trackedExercises={trackedExercises}
                targets={targets}
                phases={phases}
                visibleExercises={visibleExercises}
              />
            </div>
          )}
        </div>
      )}

      {/* Summary bar */}
      {macroWeeks.length > 0 && (
        <MacroSummaryBar
          macroWeeks={macroWeeks}
          targets={targets}
          trackedExercises={trackedExercises}
          actuals={displayedActuals}
        />
      )}
      </StandardPage>) : (
        <div className="flex-1 overflow-y-auto">
          <MacroAnnualWheel
            macrocycles={macrocycles}
            onSelectCycle={(cycle) => navigate(`/macrocycles/${cycle.id}`)}
            onCreateCycle={() => setShowCreateModal(true)}
            athleteName={selectedAthlete?.name}
            groupName={selectedGroup?.name}
            athleteId={selectedAthlete?.id}
            groupId={selectedGroup?.id}
          />
        </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <MacroCreateModal
          loading={loading}
          templates={templates}
          onDeleteTemplate={deleteTemplate}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateCycle}
        />
      )}

      {showTemplateSave && selectedCycle && (
        <MacroTemplateSaveModal
          cycleName={selectedCycle.name}
          macroWeeks={macroWeeks}
          phases={phases}
          trackedExercises={trackedExercises}
          targets={targets}
          onSave={async (name, mode, weekCount, payload) => { await createTemplate(name, mode, weekCount, payload); }}
          onClose={() => setShowTemplateSave(false)}
        />
      )}

      {showEditModal && selectedCycle && (
        <MacroEditModal
          cycle={selectedCycle}
          loading={loading}
          onClose={() => setShowEditModal(false)}
          onSave={handleEditCycle}
        />
      )}

      {eventModalType && (
        // The current athlete/group is preselected, but the coach can attach the
        // event to ANY athlete in the roster from here (not just the macro scope).
        <EventFormModal
          editing={null}
          athletes={allAthletes.length > 0 ? allAthletes : eventAthletes}
          initialType={eventModalType}
          initialAthleteIds={eventAthletes.map(a => a.id)}
          onSave={handleSaveEvent}
          onClose={() => setEventModalType(null)}
        />
      )}

      {showFillGuide && selectedCycle && macroWeeks.length > 0 && (
        <MacroFillGuide
          macroWeeks={macroWeeks}
          trackedExercises={trackedExercises}
          targets={targets}
          weekTypes={settings?.week_types ?? []}
          rhythmPresets={rhythmPresets}
          onPreviewChange={setFillPreview}
          onApply={handleApplyFill}
          onUpdateReference={updateTrackedExerciseReference}
          onEditPresets={() => setShowRhythmManager(true)}
          registerAnchorSetter={(fn) => { anchorSetterRef.current = fn; }}
          onClose={() => { setShowFillGuide(false); setFillPreview(null); }}
        />
      )}

      {showRhythmManager && (
        <RhythmPresetManager
          presets={rhythmPresets}
          weekTypes={settings?.week_types ?? []}
          onSave={handleSaveRhythmPresets}
          onClose={() => setShowRhythmManager(false)}
        />
      )}

      {showPhasesPanel && selectedCycle && (
        <MacroPhasesPanel
          macrocycleId={selectedCycle.id}
          macroWeeks={macroWeeks}
          phases={phases}
          initialEditingPhase={phasePanelInitialEdit}
          phaseTypePresets={(settings?.phase_type_presets as PhaseTypePreset[] | null | undefined) ?? DEFAULT_PHASE_TYPE_PRESETS}
          onSave={handleSavePhase}
          onDelete={handleDeletePhase}
          onClose={() => { setShowPhasesPanel(false); setPhasePanelInitialEdit(null); }}
        />
      )}

      {detailExercise && (
        <AdaptiveDialog
          mode={settings?.dialog_mode ?? 'center'}
          maxWidth={640}
          onClose={() => setDetailTrackedExId(null)}
        >
          <MacroExerciseDetail
            exercise={detailExercise}
            athleteId={detailAthleteId}
            athleteName={detailAthleteName}
            macroContext={detailMacroContext}
            anchorWeekStart={detailAnchorWeek?.week_start}
            onClose={() => setDetailTrackedExId(null)}
          />
        </AdaptiveDialog>
      )}
    </div>
  );
}
