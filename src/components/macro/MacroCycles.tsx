import { useState, useEffect, useCallback } from 'react';
import type { MacroCycle, MacroTarget, WeekType } from '../../lib/database.types';
import { useMacroCycles } from '../../hooks/useMacroCycles';
import type { MacroOwnerTarget } from '../../hooks/useMacroCycles';
import { useAthleteStore } from '../../store/athleteStore';
import { useExercises } from '../../hooks/useExercises';
import { generateMacroWeeks } from '../../lib/weekUtils';
import { MacroTableV2, DEFAULT_MACRO_TABLE_COLUMNS } from './MacroTableV2';
import type { MacroTableColumnKey } from './MacroTableV2';
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
import { MacroPhaseTimeline } from './MacroPhaseTimeline';


export function MacroCycles() {
  const { selectedAthlete, selectedGroup } = useAthleteStore();
  const { exercises, fetchExercisesByName } = useExercises();
  const { settings, fetchSettingsSilent } = useSettings();
  const { groupMembers: hookGroupMembers, fetchGroupMembers } = useTrainingGroups();

  const {
    macrocycles,
    macroWeeks,
    setMacroWeeks,
    trackedExercises,
    setTrackedExercises,
    targets,
    setTargets,
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
    fetchPhases,
    createPhase,
    updatePhase,
    deletePhase,
    fetchCompetitions,
    createCompetition,
    updateCompetition,
    deleteCompetition,
    fetchMacroActuals,
    fetchActualsForAthlete,
    updateMacrocycle,
    extendCycle,
    trimCycle,
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
  const [showPhasesPanel, setShowPhasesPanel] = useState(false);
  const [phasePanelInitialEdit, setPhasePanelInitialEdit] = useState<import('../../lib/database.types').MacroPhase | null>(null);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
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

  useEffect(() => {
    fetchSettingsSilent().then(s => {
      if (s?.macro_table_columns && s.macro_table_columns.length > 0) {
        setVisibleColumns(new Set(s.macro_table_columns as MacroTableColumnKey[]));
      }
    });
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
      setSelectedCycle(null);
      setIndividualViewAthleteId(null);
    }
  }, [selectedAthlete?.id, selectedGroup?.id]);


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

    // Create competitions
    await Promise.all(
      data.competitions.map(c =>
        createCompetition({
          macrocycle_id: cycle.id,
          competition_name: c.name,
          competition_date: c.date,
          is_primary: c.is_primary,
          event_id: null,
        })
      )
    );

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

    setSelectedCycle(cycle);
    setShowCreateModal(false);
  };

  // ─── Update week ─────────────────────────────────────────────────────────────

  const handleUpdateWeekType = useCallback(async (weekId: string, weekType: WeekType) => {
    await updateMacroWeek(weekId, { week_type: weekType });
  }, [updateMacroWeek]);

  const handleUpdateWeekLabel = useCallback(async (weekId: string, label: string) => {
    await updateMacroWeek(weekId, { week_type_text: label });
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

  const handleImportTargets = useCallback(async (
    rows: { weekId: string; trackedExId: string; field: keyof MacroTarget; value: number }[],
  ) => {
    for (const row of rows) {
      const existing = targets.find(t => t.macro_week_id === row.weekId && t.tracked_exercise_id === row.trackedExId);
      await upsertTarget(row.weekId, row.trackedExId, row.field, row.value, existing);
    }
  }, [targets, upsertTarget]);

  // ─── Exercise management ──────────────────────────────────────────────────────

  const handleAddExercise = async () => {
    if (!selectedCycle || !selectedExerciseId) return;
    const nextPosition = trackedExercises.length > 0
      ? Math.max(...trackedExercises.map(te => te.position)) + 1
      : 0;
    // Close UI immediately for instant feedback
    setSelectedExerciseId('');
    setShowAddExercise(false);
    await addTrackedExercise(selectedCycle.id, selectedExerciseId, nextPosition);
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
    competitions: Array<{ id?: string; name: string; date: string; is_primary: boolean }>;
  }) => {
    if (!selectedCycle) return;

    await updateMacrocycle(selectedCycle.id, {
      name: data.name,
      start_date: data.startDate,
      end_date: data.endDate,
    });

    const originalIds = competitions.map(c => c.id);
    const keptIds = data.competitions.filter(c => c.id).map(c => c.id!);

    for (const id of originalIds) {
      if (!keptIds.includes(id)) {
        await deleteCompetition(id);
      }
    }

    for (const comp of data.competitions) {
      if (comp.id) {
        const original = competitions.find(c => c.id === comp.id);
        if (
          original &&
          (original.competition_name !== comp.name ||
            original.competition_date !== comp.date ||
            original.is_primary !== comp.is_primary)
        ) {
          await updateCompetition(comp.id, {
            competition_name: comp.name,
            competition_date: comp.date,
            is_primary: comp.is_primary,
          });
        }
      } else if (comp.name.trim() && comp.date) {
        await createCompetition({
          macrocycle_id: selectedCycle.id,
          competition_name: comp.name,
          competition_date: comp.date,
          is_primary: comp.is_primary,
          event_id: null,
        });
      }
    }

    if (data.endDate !== selectedCycle.end_date) {
      if (data.endDate > selectedCycle.end_date) {
        const lastWeek = macroWeeks[macroWeeks.length - 1];
        if (lastWeek) {
          const s = await fetchSettingsSilent();
          const defaultWeekType = s?.week_types?.[0]?.abbreviation ?? '';
          await extendCycle(selectedCycle.id, lastWeek.week_number, lastWeek.week_start, data.endDate, defaultWeekType);
        }
      } else {
        await trimCycle(selectedCycle.id, data.endDate);
      }
    }

    const updated = { ...selectedCycle, name: data.name, start_date: data.startDate, end_date: data.endDate };
    setSelectedCycle(updated);
    await Promise.all([
      fetchMacroWeeks(selectedCycle.id),
      fetchCompetitions(selectedCycle.id),
    ]);
    setShowEditModal(false);
  };

  // ─── Delete cycle ─────────────────────────────────────────────────────────────

  const handleDeleteCycle = async () => {
    if (!selectedCycle) return;
    if (!confirm(`Delete "${selectedCycle.name}"? This cannot be undone.`)) return;
    await deleteMacrocycle(selectedCycle.id);
    setSelectedCycle(null);
  };

  // ─── Phase save / delete ──────────────────────────────────────────────────────

  const handleSavePhase = async (
    phaseData: Omit<import('../../lib/database.types').MacroPhase, 'id' | 'created_at' | 'updated_at'>,
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {selectedCycle ? (<>
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
        selectedExerciseId={selectedExerciseId}
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
        onBack={() => setSelectedCycle(null)}
        onCycleMenuToggle={() => setCycleMenuOpen(o => !o)}
        onSelectCycle={(mc) => { setSelectedCycle(mc); setCycleMenuOpen(false); }}
        onCreateCycle={() => setShowCreateModal(true)}
        onChartToggle={() => setShowChart(v => !v)}
        onDistributionToggle={() => setShowDistribution(v => { if (!v) setDistKey(k => k + 1); return !v; })}
        onIndividualViewChange={setIndividualViewAthleteId}
        onShowAddExercise={() => setShowAddExercise(true)}
        onCancelAddExercise={() => { setShowAddExercise(false); setSelectedExerciseId(''); }}
        onExerciseSelect={setSelectedExerciseId}
        onAddExercise={handleAddExercise}
        onAddPhase={() => { setPhasePanelInitialEdit(null); setShowPhasesPanel(true); }}
        onEditCycle={() => setShowEditModal(true)}
        onDeleteCycle={handleDeleteCycle}
        onImportTargets={handleImportTargets}
      />

      {/* Cycle info + proportional phase bar */}
      {selectedCycle && (
        <MacroPhaseTimeline
          selectedCycle={selectedCycle}
          macroWeeks={macroWeeks}
          phases={phases}
          competitions={competitions}
          isGroupMode={isGroupMode}
          selectedGroup={selectedGroup ?? null}
          groupMembers={groupMembers}
          onEditPhase={(phase) => { setPhasePanelInitialEdit(phase); setShowPhasesPanel(true); }}
        />
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center justify-between flex-shrink-0">
          {error}
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 ml-2">×</button>
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
          {/* Toggle bar: exercises + Reps chip */}
          {trackedExercises.length > 0 && (
            <div className="px-3 pt-2 pb-1 flex-shrink-0 flex items-center gap-2 flex-wrap border-b border-gray-100">
              <ExerciseToggleBar
                exercises={trackedExercises}
                visible={visibleExercises}
                onToggle={toggleExercise}
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
              onUpdateWeekLabel={handleUpdateWeekLabel}
              onUpdateTotalReps={handleUpdateTotalReps}
              onUpdateTonnageTarget={handleUpdateTonnageTarget}
              onUpdateAvgTarget={handleUpdateAvgTarget}
              onUpdateNotes={handleUpdateNotes}
              onMoveExerciseLeft={handleMoveExerciseLeft}
              onMoveExerciseRight={handleMoveExerciseRight}
              onRemoveExercise={handleRemoveExercise}
              onPasteTargets={handlePasteTargets}
              onExerciseDoubleClick={(id) => { setFocusedExerciseId(id); setShowChart(true); }}
              onSwapWeeks={handleSwapWeeks}
              competitionTotal={selectedAthlete?.competition_total ?? null}
              visibleExercises={visibleExercises}
              visibleColumns={visibleColumns}
              weekTypes={settings?.week_types ?? []}
            />
          </div>

          {/* Chart — shown below table when toggled */}
          {showChart && (
            <div className="px-4 pb-4 pt-2">
              <MacroGraphView
                macroWeeks={macroWeeks}
                trackedExercises={trackedExercises}
                targets={targets}
                phases={phases}
                competitions={competitions}
                actuals={displayedActuals}
                onDragTarget={handleDragTarget}
                focusedExerciseId={focusedExerciseId}
                visibleExercises={visibleExercises}
                showReps={showReps}
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
      </>) : (
        <div className="flex-1 overflow-y-auto">
          <MacroAnnualWheel
            macrocycles={macrocycles}
            onSelectCycle={(cycle) => setSelectedCycle(cycle)}
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
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateCycle}
        />
      )}

      {showEditModal && selectedCycle && (
        <MacroEditModal
          cycle={selectedCycle}
          competitions={competitions}
          loading={loading}
          onClose={() => setShowEditModal(false)}
          onSave={handleEditCycle}
        />
      )}

      {showPhasesPanel && selectedCycle && (
        <MacroPhasesPanel
          macrocycleId={selectedCycle.id}
          macroWeeks={macroWeeks}
          phases={phases}
          initialEditingPhase={phasePanelInitialEdit}
          onSave={handleSavePhase}
          onDelete={handleDeletePhase}
          onClose={() => { setShowPhasesPanel(false); setPhasePanelInitialEdit(null); }}
        />
      )}
    </div>
  );
}
