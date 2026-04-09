// TODO: Consider extracting MacroWeekRow and MacroPhaseRow into sub-components
// TODO: Consider extracting target editing into useMacroTargetEditor hook
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, BarChart3, ChevronDown, Pencil, Users, PieChart } from 'lucide-react';
import type { MacroCycle, MacroTarget, WeekType, GroupMemberWithAthlete } from '../../lib/database.types';
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
import { MacroGraphView } from './MacroGraphView';
import { MacroDistributionChart } from './MacroDistributionChart';
import { Chart as ChartJS, BarController, LineController, DoughnutController } from 'chart.js';
ChartJS.register(BarController, LineController, DoughnutController);
import { MacroSummaryBar } from './MacroSummaryBar';
import { MacroCreateModal } from './MacroCreateModal';
import { MacroEditModal } from './MacroEditModal';
import { MacroPhaseModal } from './MacroPhaseModal';
import { MacroCompetitionBadge } from './MacroCompetitionBadge';
import { MacroExcelIO } from './MacroExcelIO';
import { supabase } from '../../lib/supabase';


export function MacroCycles() {
  const { selectedAthlete, selectedGroup } = useAthleteStore();
  const { exercises, fetchExercisesByName } = useExercises();
  const { fetchSettingsSilent } = useSettings();

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
  const [showPhaseModal, setShowPhaseModal] = useState(false);
  const [editingPhase, setEditingPhase] = useState<import('../../lib/database.types').MacroPhase | null>(null);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [cycleMenuOpen, setCycleMenuOpen] = useState(false);

  // Group mode state
  const [groupMembers, setGroupMembers] = useState<GroupMemberWithAthlete[]>([]);
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
    if (!selectedGroup) {
      setGroupMembers([]);
      return;
    }
    supabase
      .from('group_members')
      .select('*, athlete:athletes(*)')
      .eq('group_id', selectedGroup.id)
      .is('left_at', null)
      .then(({ data }) => setGroupMembers((data as GroupMemberWithAthlete[]) || []));
  }, [selectedGroup?.id]);

  // Load macrocycles when target changes
  useEffect(() => {
    if (macroTarget) {
      fetchMacrocycles(macroTarget);
      setSelectedCycle(null);
      setIndividualViewAthleteId(null);
    }
  }, [selectedAthlete?.id, selectedGroup?.id]);

  // Auto-select most recent cycle
  useEffect(() => {
    if (macrocycles.length > 0 && !selectedCycle) {
      setSelectedCycle(macrocycles[0]);
    }
  }, [macrocycles]);

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

    const weekInserts = generateMacroWeeks(data.startDate, data.endDate).map(w => ({
      macrocycle_id: '',
      week_start: w.week_start,
      week_number: w.week_number,
      week_type: 'Medium' as WeekType,
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
    await addTrackedExercise(selectedCycle.id, selectedExerciseId, nextPosition);
    await fetchTrackedExercises(selectedCycle.id);
    setSelectedExerciseId('');
    setShowAddExercise(false);
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
          const newStart = new Date(lastWeek.week_start);
          newStart.setDate(newStart.getDate() + 7);
          const newWeeks = generateMacroWeeks(newStart.toISOString().slice(0, 10), data.endDate);
          if (newWeeks.length > 0) {
            const inserts = newWeeks.map((w, i) => ({
              macrocycle_id: selectedCycle.id,
              week_start: w.week_start,
              week_number: lastWeek.week_number + 1 + i,
              week_type: 'Medium' as WeekType,
              week_type_text: '',
              notes: '',
            }));
            await supabase.from('macro_weeks').insert(inserts);
          }
        }
      } else {
        await supabase
          .from('macro_weeks')
          .delete()
          .eq('macrocycle_id', selectedCycle.id)
          .gt('week_start', data.endDate);
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

  // ─── Phase save ───────────────────────────────────────────────────────────────

  const handleSavePhase = async (phaseData: Omit<import('../../lib/database.types').MacroPhase, 'id' | 'created_at' | 'updated_at'>) => {
    if (editingPhase) {
      await updatePhase(editingPhase.id, phaseData);
    } else {
      await createPhase(phaseData);
    }
    setEditingPhase(null);
    setShowPhaseModal(false);
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
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Select an athlete or group to view macrocycles.
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
      {/* Top toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 flex-shrink-0 flex-wrap">
        {/* Cycle selector */}
        <div className="flex items-center gap-1">
          {macrocycles.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setCycleMenuOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {selectedCycle ? selectedCycle.name : 'Select macrocycle'}
                <ChevronDown size={14} />
              </button>
              {cycleMenuOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[200px]">
                  {macrocycles.map(mc => (
                    <button
                      key={mc.id}
                      onClick={() => { setSelectedCycle(mc); setCycleMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${selectedCycle?.id === mc.id ? 'text-blue-600 font-medium' : 'text-gray-700'}`}
                    >
                      {mc.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <Plus size={14} />
            {isGroupMode ? 'New group macro' : 'New macrocycle'}
          </button>
          {isGroupMode && (
            <span className="px-2 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 rounded-full border border-purple-200">
              Group macro
            </span>
          )}
        </div>

        {selectedCycle && (
          <>
            {/* Chart toggle */}
            <button
              onClick={() => setShowChart(v => !v)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                showChart ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <BarChart3 size={13} /> Chart
            </button>

            {/* Distribution toggle */}
            <button
              onClick={() => setShowDistribution(v => { if (!v) setDistKey(k => k + 1); return !v; })}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                showDistribution ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <PieChart size={13} /> Distribution
            </button>

            {/* Individual view dropdown (group mode only) */}
            {isGroupMode && groupMembers.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Users size={13} className="text-gray-400" />
                <select
                  value={individualViewAthleteId ?? ''}
                  onChange={e => setIndividualViewAthleteId(e.target.value || null)}
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  title="Individual view: see one athlete's actuals"
                >
                  <option value="">Group average actuals</option>
                  {groupMembers.map(gm => (
                    <option key={gm.athlete_id} value={gm.athlete_id}>
                      {gm.athlete.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Add exercise */}
            {showAddExercise ? (
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedExerciseId}
                  onChange={e => setSelectedExerciseId(e.target.value)}
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select exercise…</option>
                  {availableExercises.map(ex => (
                    <option key={ex.id} value={ex.id}>
                      {ex.exercise_code ? `${ex.exercise_code} — ` : ''}{ex.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddExercise}
                  disabled={!selectedExerciseId}
                  className="px-2.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => { setShowAddExercise(false); setSelectedExerciseId(''); }}
                  className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddExercise(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <Plus size={13} /> Track exercise
              </button>
            )}

            {/* Add phase */}
            <button
              onClick={() => { setEditingPhase(null); setShowPhaseModal(true); }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Plus size={13} /> Add phase
            </button>

            {/* Excel IO */}
            <MacroExcelIO
              macroWeeks={macroWeeks}
              trackedExercises={trackedExercises}
              targets={targets}
              phases={phases}
              actuals={actuals}
              cycleNameForFile={selectedCycle.name}
              cycleDateRange={{ start: selectedCycle.start_date, end: selectedCycle.end_date }}
              athleteName={isGroupMode ? selectedGroup?.name : selectedAthlete?.name}
              athleteId={selectedAthlete?.id ?? null}
              onImportTargets={handleImportTargets}
            />

            {/* Edit cycle */}
            <button
              onClick={() => setShowEditModal(true)}
              className="ml-auto flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Pencil size={13} /> Edit cycle
            </button>

            {/* Delete cycle */}
            <button
              onClick={handleDeleteCycle}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            >
              <Trash2 size={13} /> Delete
            </button>
          </>
        )}
      </div>

      {/* Cycle info + proportional phase bar */}
      {selectedCycle && (
        <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50">
          {/* Meta row */}
          <div className="flex items-center gap-3 px-4 py-1.5 text-xs text-gray-600 flex-wrap">
            <span className="font-medium text-gray-800">{selectedCycle.name}</span>
            <span className="text-gray-400">{selectedCycle.start_date} → {selectedCycle.end_date}</span>
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
              <MacroCompetitionBadge key={comp.id} competition={comp} />
            ))}
          </div>

          {/* Detailed phase timeline */}
          {macroWeeks.length > 0 && (() => {
            const total = macroWeeks.length;
            const colPct = 100 / total;

            // ISO week helper
            const isoWeek = (dateStr: string) => {
              const d = new Date(dateStr);
              const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
              const day = dt.getUTCDay() || 7;
              dt.setUTCDate(dt.getUTCDate() + 4 - day);
              const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
              return Math.ceil((((dt.getTime() - y0.getTime()) / 86400000) + 1) / 7);
            };
            const fmtMD = (dateStr: string) => {
              const d = new Date(dateStr);
              return `${d.getMonth() + 1}/${d.getDate()}`;
            };
            const addDays = (dateStr: string, days: number) => {
              const d = new Date(dateStr);
              d.setDate(d.getDate() + days);
              return `${d.getMonth() + 1}/${d.getDate()}`;
            };

            // Month groups
            type MonthGroup = { label: string; spanWeeks: number };
            const monthGroups: MonthGroup[] = [];
            macroWeeks.forEach(w => {
              const d = new Date(w.week_start);
              const label = d.toLocaleString('default', { month: 'short' }) + ' ' + String(d.getFullYear()).slice(2);
              if (!monthGroups.length || monthGroups[monthGroups.length - 1].label !== label) {
                monthGroups.push({ label, spanWeeks: 1 });
              } else {
                monthGroups[monthGroups.length - 1].spanWeeks++;
              }
            });

            // Phase segments
            const sorted = [...phases].sort((a, b) => a.start_week_number - b.start_week_number);
            type Seg = { type: 'phase'; phase: typeof phases[0]; startIdx: number; endIdx: number }
                     | { type: 'gap'; startIdx: number; endIdx: number };
            const segs: Seg[] = [];
            let cur = 1;
            for (const p of sorted) {
              if (p.start_week_number > cur) segs.push({ type: 'gap', startIdx: cur - 1, endIdx: p.start_week_number - 2 });
              segs.push({ type: 'phase', phase: p, startIdx: p.start_week_number - 1, endIdx: p.end_week_number - 1 });
              cur = p.end_week_number + 1;
            }
            if (cur <= total) segs.push({ type: 'gap', startIdx: cur - 1, endIdx: total - 1 });

            return (
              <div className="w-full border-t border-gray-200 overflow-hidden select-none">
                {/* Month row */}
                <div className="flex w-full bg-white border-b border-gray-200" style={{ height: 18 }}>
                  {monthGroups.map((mg, i) => (
                    <div
                      key={i}
                      className="flex items-center border-r border-gray-300 px-1 overflow-hidden flex-shrink-0"
                      style={{ width: `${mg.spanWeeks * colPct}%` }}
                    >
                      <span className="text-[8px] font-semibold text-gray-500 truncate">{mg.label}</span>
                    </div>
                  ))}
                </div>

                {/* Phase band + week dividers */}
                <div className="relative w-full flex" style={{ height: 22 }}>
                  {segs.map((seg, i) => {
                    const weeks = seg.endIdx - seg.startIdx + 1;
                    const w = `${weeks * colPct}%`;
                    if (seg.type === 'phase') {
                      return (
                        <button
                          key={seg.phase.id}
                          onClick={() => { setEditingPhase(seg.phase); setShowPhaseModal(true); }}
                          className="relative flex items-center justify-center text-[10px] font-semibold hover:brightness-95 transition-all overflow-hidden flex-shrink-0"
                          style={{ width: w, backgroundColor: seg.phase.color }}
                          title={`${seg.phase.name} · Wk ${seg.phase.start_week_number}–${seg.phase.end_week_number}`}
                        >
                          <span className="truncate px-1 text-white/90">{seg.phase.name}</span>
                        </button>
                      );
                    }
                    return <div key={`gap-${i}`} className="bg-gray-200 flex-shrink-0" style={{ width: w }} />;
                  })}
                  {/* Week divider lines overlay */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {macroWeeks.map(w => (
                      <div key={w.id} className="border-r border-white/25 h-full flex-shrink-0" style={{ width: `${colPct}%` }} />
                    ))}
                  </div>
                </div>

                {/* Week label row */}
                <div className="flex w-full bg-white border-t border-gray-200">
                  {macroWeeks.map(w => (
                    <div
                      key={w.id}
                      className="flex flex-col items-center justify-center border-r border-gray-100 py-0.5 overflow-hidden flex-shrink-0"
                      style={{ width: `${colPct}%` }}
                    >
                      <span className="text-[9px] font-bold text-gray-700 leading-none">{w.week_number}</span>
                      <span className="text-[7px] text-gray-400 leading-none mt-px">W{isoWeek(w.week_start)}</span>
                      <span className="text-[7px] text-gray-300 leading-none mt-px">{fmtMD(w.week_start)}–{addDays(w.week_start, 6)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center justify-between flex-shrink-0">
          {error}
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 ml-2">×</button>
        </div>
      )}

      {/* Main content */}
      {!selectedCycle ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-gray-400 mb-4">No macrocycle selected.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 mx-auto"
            >
              <Plus size={16} />
              {isGroupMode ? 'Create group macro' : 'Create macrocycle'}
            </button>
          </div>
        </div>
      ) : loading ? (
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
      {selectedCycle && macroWeeks.length > 0 && (
        <MacroSummaryBar
          macroWeeks={macroWeeks}
          targets={targets}
          trackedExercises={trackedExercises}
          actuals={displayedActuals}
        />
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

      {showPhaseModal && selectedCycle && (
        <MacroPhaseModal
          macrocycleId={selectedCycle.id}
          macroWeeks={macroWeeks}
          editingPhase={editingPhase}
          nextPosition={phases.length + 1}
          onSave={handleSavePhase}
          onClose={() => { setShowPhaseModal(false); setEditingPhase(null); }}
        />
      )}
    </div>
  );
}
