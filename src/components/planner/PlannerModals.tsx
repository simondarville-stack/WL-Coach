import { lazy, Suspense } from 'react';
import type { Athlete, TrainingGroup } from '../../lib/database.types';
import { DAYS_OF_WEEK } from '../../lib/constants';
import { DayConfigModal } from '../DayConfigModal';
import type { DaySchedule } from '../DayConfigModal';
// Lazy for two reasons: the print view is rarely opened, and a static import
// here pinned PrintWeek into the planner chunk, defeating the athlete app's
// own lazy import of the same module (Vite warned about exactly this).
const PrintWeek = lazy(() => import('./PrintWeek').then(m => ({ default: m.PrintWeek })));

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
  // Shared (print)
  selectedDate: string;
  selectedAthlete: Athlete | null;
  selectedGroup: TrainingGroup | null;
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
  selectedDate, selectedAthlete, selectedGroup,
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

      {showPrintModal && (selectedAthlete || selectedGroup) && (
        <Suspense fallback={null}>
          <PrintWeek
            athlete={selectedAthlete}
            group={selectedGroup}
            weekStart={selectedDate}
            onClose={onPrintClose}
            dayLabels={dayLabels}
            weekDescription={weekDescription}
          />
        </Suspense>
      )}
    </>
  );
}

// Re-export for convenience in WeeklyPlanner
export { DAYS_OF_WEEK };
