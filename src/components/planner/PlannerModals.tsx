import type { Athlete, TrainingGroup } from '../../lib/database.types';
import { DAYS_OF_WEEK } from '../../lib/constants';
import { DayConfigModal } from '../DayConfigModal';
import type { DaySchedule } from '../DayConfigModal';
import { CopyWeekModal } from './CopyWeekModal';
import { PrintWeek } from './PrintWeek';

interface PlannerModalsProps {
  // DayConfig
  showDayConfig: boolean;
  dayDisplayOrder: number[];
  editingDayLabels: Record<number, string>;
  activeDays: number[];
  daySchedule: DaySchedule;
  dayDragIndex: number | null;
  onDayDragStart: (idx: number) => void;
  onDayDragOver: (e: React.DragEvent, idx: number) => void;
  onDayDragEnd: () => void;
  onToggleDay: (dayIndex: number) => void;
  onLabelChange: (dayIndex: number, value: string) => void;
  onScheduleChange: (dayIndex: number, entry: { weekday: number; time: string | null } | null) => void;
  onRemoveDay: (dayIndex: number) => void;
  onAddDay: () => void;
  onDayConfigCancel: () => void;
  onDayConfigSave: () => void;
  // Copy/Paste
  showPasteModal: boolean;
  copiedWeekStart: string | null;
  selectedDate: string;
  selectedAthlete: Athlete | null;
  allAthletes: Athlete[];
  allGroups: TrainingGroup[];
  onPasteClose: () => void;
  onPasteComplete: () => void;
  // Print
  showPrintModal: boolean;
  dayLabels: Record<number, string>;
  weekDescription: string | null | undefined;
  onPrintClose: () => void;
}

export function PlannerModals({
  showDayConfig, dayDisplayOrder, editingDayLabels, activeDays, daySchedule, dayDragIndex,
  onDayDragStart, onDayDragOver, onDayDragEnd, onToggleDay, onLabelChange, onScheduleChange,
  onRemoveDay, onAddDay, onDayConfigCancel, onDayConfigSave,
  showPasteModal, copiedWeekStart, selectedDate, selectedAthlete,
  allAthletes, allGroups, onPasteClose, onPasteComplete,
  showPrintModal, dayLabels, weekDescription, onPrintClose,
}: PlannerModalsProps) {
  return (
    <>
      {showDayConfig && (
        <DayConfigModal
          dayDisplayOrder={dayDisplayOrder}
          editingDayLabels={editingDayLabels}
          activeDays={activeDays}
          daySchedule={daySchedule}
          draggedDayIndex={dayDragIndex}
          onDragStart={onDayDragStart}
          onDragOver={onDayDragOver}
          onDragEnd={onDayDragEnd}
          onToggleDay={onToggleDay}
          onLabelChange={onLabelChange}
          onScheduleChange={onScheduleChange}
          onRemoveDay={onRemoveDay}
          onAddDay={onAddDay}
          onCancel={onDayConfigCancel}
          onSave={onDayConfigSave}
        />
      )}

      {showPasteModal && copiedWeekStart && (
        <CopyWeekModal
          onClose={onPasteClose}
          onPasteComplete={onPasteComplete}
          destinationWeekStart={selectedDate}
          sourceWeekStart={copiedWeekStart}
          sourceAthlete={selectedAthlete}
          sourceGroup={null}
          destinationAthlete={selectedAthlete}
          destinationGroup={null}
          allAthletes={allAthletes}
          allGroups={allGroups}
        />
      )}

      {showPrintModal && selectedAthlete && (
        <PrintWeek
          athlete={selectedAthlete}
          weekStart={selectedDate}
          onClose={onPrintClose}
          dayLabels={dayLabels}
          weekDescription={weekDescription}
        />
      )}
    </>
  );
}

// Re-export for convenience in WeeklyPlanner
export { DAYS_OF_WEEK };
