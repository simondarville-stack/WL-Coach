import { X } from 'lucide-react';
import { ModalShell } from './ModalShell';

interface DayConfigModalProps {
  dayDisplayOrder: number[];
  editingDayLabels: Record<number, string>;
  activeDays: number[];
  draggedDayIndex: number | null;
  onDragStart: (dayIndex: number) => void;
  onDragOver: (e: React.DragEvent, dayIndex: number) => void;
  onDragEnd: () => void;
  onToggleDay: (dayIndex: number) => void;
  onLabelChange: (dayIndex: number, value: string) => void;
  onRemoveDay: (dayIndex: number) => void;
  onAddDay: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function DayConfigModal({
  dayDisplayOrder,
  editingDayLabels,
  activeDays,
  draggedDayIndex,
  onDragStart,
  onDragOver,
  onDragEnd,
  onToggleDay,
  onLabelChange,
  onRemoveDay,
  onAddDay,
  onCancel,
  onSave,
}: DayConfigModalProps) {
  return (
    <ModalShell maxWidth="max-w-2xl">
      <div className="p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Training Days</h2>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-600">
              Drag to reorder, customize names, and toggle days on/off
            </p>
            <button
              onClick={onAddDay}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
            >
              + Add Day
            </button>
          </div>
          <div className="space-y-2">
            {dayDisplayOrder
              .filter((dayIndex) => editingDayLabels[dayIndex] !== undefined)
              .map((dayIndex) => (
                <div
                  key={dayIndex}
                  draggable
                  onDragStart={() => onDragStart(dayIndex)}
                  onDragOver={(e) => onDragOver(e, dayIndex)}
                  onDragEnd={onDragEnd}
                  className={`flex items-center gap-2 p-3 border border-gray-200 rounded-lg transition-all cursor-move ${
                    draggedDayIndex === dayIndex
                      ? 'opacity-50 scale-95'
                      : 'hover:bg-gray-50 hover:shadow-sm'
                  }`}
                >
                  <div className="flex flex-col text-gray-400">
                    <div className="h-1 w-1 bg-gray-400 rounded-full mb-0.5"></div>
                    <div className="h-1 w-1 bg-gray-400 rounded-full mb-0.5"></div>
                    <div className="h-1 w-1 bg-gray-400 rounded-full"></div>
                  </div>
                  <input
                    type="checkbox"
                    checked={activeDays.includes(dayIndex)}
                    onChange={() => onToggleDay(dayIndex)}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={editingDayLabels[dayIndex] || ''}
                    onChange={(e) => onLabelChange(dayIndex, e.target.value)}
                    placeholder={`Day ${dayIndex}`}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => onRemoveDay(dayIndex)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Remove this day"
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Examples: "Monday", "Session 1", "Upper Body", "AM Workout", etc.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
