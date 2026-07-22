import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, BookmarkPlus, CalendarPlus, ChevronDown, Layers, Pencil, PieChart, Plus, RefreshCw, Tent, Trash2, Trophy, Undo2, Users, Wand2 } from 'lucide-react';
import { Button } from '../ui';
import { ExerciseSearch } from '../planner/ExerciseSearch';
import type { MacroCycle, Exercise, TrainingGroup, EventType, WeekTypeConfig } from '../../lib/database.types';
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
  onAddExerciseDirect: (exercise: Exercise) => void;
  onAddPhase: () => void;
  onAddEvent: (type: EventType) => void;
  onEditCycle: () => void;
  onDeleteCycle: () => void;
  onImportTargets: (rows: { weekId: string; trackedExId: string; field: keyof MacroTarget; value: number }[]) => Promise<void>;
  onImportWeeks: (rows: Array<{ id: string; week_type?: string; total_reps_target?: number | null }>) => Promise<void>;
  /** Coach's week-type definitions — gates which types a template may import. */
  weekTypes: WeekTypeConfig[];
  fillGuideOpen: boolean;
  onFillGuideToggle: () => void;
  canUndoFill: boolean;
  onUndoFill: () => void;
  canRemodulate: boolean;
  onRemodulate: () => void;
  /** A bulk fill operation (apply / undo / re-modulate) is in flight. */
  fillBusy: boolean;
  onSaveTemplate: () => void;
}

export function MacroCycleToolbar({
  selectedCycle,
  macrocycles,
  cycleMenuOpen,
  isGroupMode,
  groupMembers,
  individualViewAthleteId,
  showAddExercise,
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
  onAddExerciseDirect,
  onAddPhase,
  onAddEvent,
  onEditCycle,
  onDeleteCycle,
  onImportTargets,
  onImportWeeks,
  weekTypes,
  fillGuideOpen,
  onFillGuideToggle,
  canUndoFill,
  onUndoFill,
  canRemodulate,
  onRemodulate,
  fillBusy,
  onSaveTemplate,
}: MacroCycleToolbarProps) {
  // "Add event" dropdown (competition / training camp)
  const [eventMenuOpen, setEventMenuOpen] = useState(false);
  const eventMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!eventMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (eventMenuRef.current && !eventMenuRef.current.contains(e.target as Node)) setEventMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [eventMenuOpen]);
  const pickEvent = (type: EventType) => { setEventMenuOpen(false); onAddEvent(type); };

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
          {/* Groups read left→right, separated by thin dividers:
              NAV · BUILD (exercises · fill · phases · events) · VIEWS · REUSE · MANAGE. */}
          <div className="w-px h-5 bg-gray-200 mx-0.5" />

          {/* Add exercise — the shared ranked ExerciseSearch (same as the
              planner). Selecting a match adds it and keeps the field open so a
              coach can add several in a row; Done closes it. */}
          {showAddExercise ? (
            <div className="flex items-center gap-1.5">
              <div className="border border-gray-300 rounded-lg px-1" style={{ width: 240 }}>
                <ExerciseSearch
                  exercises={availableExercises}
                  onAdd={onAddExerciseDirect}
                  disableSlashCommands
                  dropUp={false}
                  autoFocus
                  placeholder="Search exercise…"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancelAddExercise}
              >
                Done
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
              disabled={fillBusy}
              title="Re-apply the last fill's anchors + rhythm against the current week types (overwrites that fill)"
            >
              {fillBusy ? 'Working…' : 'Re-modulate'}
            </Button>
          )}
          {canUndoFill && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Undo2 size={13} />}
              onClick={onUndoFill}
              disabled={fillBusy}
              title="Undo the last fill"
            >
              {fillBusy ? 'Working…' : 'Undo fill'}
            </Button>
          )}

          {/* Phases */}
          <Button
            variant="secondary"
            size="sm"
            icon={<Layers size={13} />}
            onClick={onAddPhase}
          >
            Phases
          </Button>

          {/* Add event — competition / training camp (shared events model) */}
          <div ref={eventMenuRef} className="relative">
            <Button
              variant="secondary"
              size="sm"
              icon={<CalendarPlus size={13} />}
              onClick={() => setEventMenuOpen(o => !o)}
              title="Add a competition or training camp for this athlete"
            >
              Add event
            </Button>
            {eventMenuOpen && (
              <div
                className="absolute top-full left-0 mt-1 rounded-lg z-30 min-w-[168px] py-1"
                style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)', boxShadow: '0 6px 20px rgba(15,40,70,.14)' }}
              >
                <button
                  onClick={() => pickEvent('competition')}
                  className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-[var(--color-accent-muted)]"
                >
                  <Trophy size={13} style={{ color: '#E24B4A' }} /> Competition
                </button>
                <button
                  onClick={() => pickEvent('training_camp')}
                  className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-[var(--color-accent-muted)]"
                >
                  <Tent size={13} style={{ color: '#2563eb' }} /> Training camp
                </button>
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-gray-200 mx-0.5" />

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

          <div className="w-px h-5 bg-gray-200 mx-0.5" />

          {/* Save as template */}
          <Button
            variant="secondary"
            size="sm"
            icon={<BookmarkPlus size={13} />}
            onClick={onSaveTemplate}
            title="Save this cycle as a reusable template (exact kg or general % model)"
          >
            Template
          </Button>

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
              weekTypes={weekTypes}
              onImportTargets={onImportTargets}
              onImportWeeks={onImportWeeks}
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
