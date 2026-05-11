import { ArrowLeft, BarChart3, ChevronDown, Pencil, PieChart, Plus, Trash2, Users } from 'lucide-react';
import type { MacroCycle, Exercise, TrainingGroup } from '../../lib/database.types';
import type { GroupMemberWithAthlete } from '../../lib/database.types';
import type { MacroTrackedExerciseWithExercise } from '../../lib/database.types';
import { MacroExcelIO } from './MacroExcelIO';
import type { MacroTarget } from '../../lib/database.types';
import type { MacroWeek, MacroPhase, MacroCompetition } from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';

interface MacroCycleToolbarProps {
  selectedCycle: MacroCycle | null;
  macrocycles: MacroCycle[];
  cycleMenuOpen: boolean;
  isGroupMode: boolean;
  selectedGroup: TrainingGroup | null;
  groupMembers: GroupMemberWithAthlete[];
  individualViewAthleteId: string | null;
  showAddExercise: boolean;
  selectedExerciseId: string;
  availableExercises: Exercise[];
  showChart: boolean;
  showDistribution: boolean;
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  phases: MacroPhase[];
  actuals: MacroActualsMap;
  athleteName: string | undefined;
  athleteId: string | null;
  cycleNameForFile: string;
  cycleDateRange: { start: string; end: string } | null;
  onBack: () => void;
  onCycleMenuToggle: () => void;
  onSelectCycle: (cycle: MacroCycle) => void;
  onCreateCycle: () => void;
  onChartToggle: () => void;
  onDistributionToggle: () => void;
  onIndividualViewChange: (athleteId: string | null) => void;
  onShowAddExercise: () => void;
  onCancelAddExercise: () => void;
  onExerciseSelect: (id: string) => void;
  onAddExercise: () => void;
  onAddPhase: () => void;
  onEditCycle: () => void;
  onDeleteCycle: () => void;
  onImportTargets: (rows: { weekId: string; trackedExId: string; field: keyof MacroTarget; value: number }[]) => Promise<void>;
}

export function MacroCycleToolbar({
  selectedCycle,
  macrocycles,
  cycleMenuOpen,
  isGroupMode,
  selectedGroup,
  groupMembers,
  individualViewAthleteId,
  showAddExercise,
  selectedExerciseId,
  availableExercises,
  showChart,
  showDistribution,
  macroWeeks,
  trackedExercises,
  targets,
  phases,
  actuals,
  athleteName,
  athleteId,
  cycleNameForFile,
  cycleDateRange,
  onBack,
  onCycleMenuToggle,
  onSelectCycle,
  onCreateCycle,
  onChartToggle,
  onDistributionToggle,
  onIndividualViewChange,
  onShowAddExercise,
  onCancelAddExercise,
  onExerciseSelect,
  onAddExercise,
  onAddPhase,
  onEditCycle,
  onDeleteCycle,
  onImportTargets,
}: MacroCycleToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 flex-shrink-0 flex-wrap">
      {/* Back to annual wheel */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg mr-1"
        title="Back to annual view"
      >
        <ArrowLeft size={14} />
      </button>

      {/* Cycle selector */}
      <div className="flex items-center gap-1">
        {macrocycles.length > 0 && (
          <div className="relative">
            <button
              onClick={onCycleMenuToggle}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              {selectedCycle ? selectedCycle.name : 'Select macrocycle'}
              <ChevronDown size={14} />
            </button>
            {cycleMenuOpen && (
              <div className="absolute top-full left-0 mt-1 rounded-lg z-20 min-w-[200px]" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
                {macrocycles.map(mc => (
                  <button
                    key={mc.id}
                    onClick={() => onSelectCycle(mc)}
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
          onClick={onCreateCycle}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <Plus size={14} />
          {isGroupMode ? 'New group macro' : 'New macrocycle'}
        </button>
        {isGroupMode && (
          <span className="px-2 py-0.5 text-[11px] font-medium bg-purple-100 text-purple-700 rounded-full border border-purple-200">
            Group macro
          </span>
        )}
      </div>

      {selectedCycle && (
        <>
          {/* Chart toggle */}
          <button
            onClick={onChartToggle}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
              showChart ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <BarChart3 size={13} /> Chart
          </button>

          {/* Distribution toggle */}
          <button
            onClick={onDistributionToggle}
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
                onChange={e => onIndividualViewChange(e.target.value || null)}
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
                onChange={e => onExerciseSelect(e.target.value)}
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
                onClick={onAddExercise}
                disabled={!selectedExerciseId}
                className="px-2.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Add
              </button>
              <button
                onClick={onCancelAddExercise}
                className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onShowAddExercise}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Plus size={13} /> Track exercise
            </button>
          )}

          {/* Phases */}
          <button
            onClick={onAddPhase}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Phases
          </button>

          {/* Excel IO */}
          {cycleDateRange && (
            <MacroExcelIO
              macroWeeks={macroWeeks}
              trackedExercises={trackedExercises}
              targets={targets}
              phases={phases}
              actuals={actuals}
              cycleNameForFile={cycleNameForFile}
              cycleDateRange={cycleDateRange}
              athleteName={athleteName}
              athleteId={athleteId}
              onImportTargets={onImportTargets}
            />
          )}

          {/* Edit cycle */}
          <button
            onClick={onEditCycle}
            className="ml-auto flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Pencil size={13} /> Edit cycle
          </button>

          {/* Delete cycle */}
          <button
            onClick={onDeleteCycle}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
          >
            <Trash2 size={13} /> Delete
          </button>
        </>
      )}
    </div>
  );
}
