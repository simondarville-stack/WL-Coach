import { ArrowLeft, BarChart3, ChevronDown, Pencil, PieChart, Plus, RefreshCw, Trash2, Undo2, Users, Wand2 } from 'lucide-react';
import { Button } from '../ui';
import type { MacroCycle, Exercise, TrainingGroup } from '../../lib/database.types';
import type { GroupMemberWithAthlete } from '../../lib/database.types';
import type { MacroTrackedExerciseWithExercise } from '../../lib/database.types';
import { MacroExcelIO } from './MacroExcelIO';
import type { MacroTarget } from '../../lib/database.types';
import type { MacroWeek, MacroPhase } from '../../lib/database.types';
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
  fillGuideOpen: boolean;
  onFillGuideToggle: () => void;
  canUndoFill: boolean;
  onUndoFill: () => void;
  canRemodulate: boolean;
  onRemodulate: () => void;
}

export function MacroCycleToolbar({
  selectedCycle,
  macrocycles,
  cycleMenuOpen,
  isGroupMode,
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
  fillGuideOpen,
  onFillGuideToggle,
  canUndoFill,
  onUndoFill,
  canRemodulate,
  onRemodulate,
}: MacroCycleToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 flex-shrink-0 flex-wrap">
      {/* Back to annual wheel */}
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft size={14} />}
        title="Back to annual view"
        onClick={onBack}
        className="mr-1"
      />

      {/* Cycle selector */}
      <div className="flex items-center gap-1">
        {macrocycles.length > 0 && (
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              icon={<ChevronDown size={14} />}
              iconPosition="right"
              onClick={onCycleMenuToggle}
            >
              {selectedCycle ? selectedCycle.name : 'Select macrocycle'}
            </Button>
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
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={onCreateCycle}
        >
          {isGroupMode ? 'New group macro' : 'New macrocycle'}
        </Button>
      </div>

      {selectedCycle && (
        <>
          {/* Chart toggle */}
          <Button
            variant={showChart ? 'primary' : 'secondary'}
            size="sm"
            icon={<BarChart3 size={13} />}
            onClick={onChartToggle}
          >
            Chart
          </Button>

          {/* Distribution toggle */}
          <Button
            variant={showDistribution ? 'primary' : 'secondary'}
            size="sm"
            icon={<PieChart size={13} />}
            onClick={onDistributionToggle}
          >
            Distribution
          </Button>

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
              <Button
                variant="primary"
                size="sm"
                onClick={onAddExercise}
                disabled={!selectedExerciseId}
              >
                Add
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancelAddExercise}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus size={13} />}
              onClick={onShowAddExercise}
            >
              Track exercise
            </Button>
          )}

          {/* Phases */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onAddPhase}
          >
            Phases
          </Button>

          {/* Fill guide */}
          <Button
            variant={fillGuideOpen ? 'primary' : 'secondary'}
            size="sm"
            icon={<Wand2 size={13} />}
            onClick={onFillGuideToggle}
            title="Generate weekly targets from anchors + a rhythm"
          >
            Fill guide
          </Button>
          {canRemodulate && (
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} />}
              onClick={onRemodulate}
              title="Re-apply the last fill's anchors + rhythm against the current week types (overwrites that fill)"
            >
              Re-modulate
            </Button>
          )}
          {canUndoFill && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Undo2 size={13} />}
              onClick={onUndoFill}
              title="Undo the last fill"
            >
              Undo fill
            </Button>
          )}

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
          <Button
            variant="secondary"
            size="sm"
            icon={<Pencil size={13} />}
            onClick={onEditCycle}
            className="ml-auto"
          >
            Edit cycle
          </Button>

          {/* Delete cycle */}
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={13} />}
            onClick={onDeleteCycle}
          >
            Delete
          </Button>
        </>
      )}
    </div>
  );
}
