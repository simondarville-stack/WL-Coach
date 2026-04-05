import { X } from 'lucide-react';
import { ModalShell } from './ModalShell';

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_LABELS = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'];
const TIME_PRESETS = ['06:00', '09:00', '12:00', '15:30', '17:00', '19:00'];

export type DaySchedule = Record<number, { weekday: number; time: string | null }>;

interface DayConfigModalProps {
  dayDisplayOrder: number[];
  editingDayLabels: Record<number, string>;
  activeDays: number[];
  daySchedule: DaySchedule;
  draggedDayIndex: number | null;
  onDragStart: (dayIndex: number) => void;
  onDragOver: (e: React.DragEvent, dayIndex: number) => void;
  onDragEnd: () => void;
  onToggleDay: (dayIndex: number) => void;
  onLabelChange: (dayIndex: number, value: string) => void;
  onScheduleChange: (dayIndex: number, entry: { weekday: number; time: string | null } | null) => void;
  onRemoveDay: (dayIndex: number) => void;
  onAddDay: () => void;
  onCancel: () => void;
  onSave: () => void;
}

// Returns weekday conflicts for validation
function getConflicts(schedule: DaySchedule): Map<number, number[]> {
  const byWeekday = new Map<number, number[]>();
  for (const [slot, entry] of Object.entries(schedule)) {
    const wd = entry.weekday;
    const arr = byWeekday.get(wd) ?? [];
    arr.push(Number(slot));
    byWeekday.set(wd, arr);
  }
  // Only return weekdays with 2+ slots
  const conflicts = new Map<number, number[]>();
  byWeekday.forEach((slots, wd) => { if (slots.length > 1) conflicts.set(wd, slots); });
  return conflicts;
}

export function DayConfigModal({
  dayDisplayOrder,
  editingDayLabels,
  activeDays,
  daySchedule,
  draggedDayIndex,
  onDragStart,
  onDragOver,
  onDragEnd,
  onToggleDay,
  onLabelChange,
  onScheduleChange,
  onRemoveDay,
  onAddDay,
  onCancel,
  onSave,
}: DayConfigModalProps) {
  const conflicts = getConflicts(daySchedule);

  // Validation: block save if same weekday with no times, or same weekday+time
  let saveError: string | null = null;
  for (const [wd, slots] of conflicts) {
    const entries = slots.map(s => daySchedule[s]);
    const timeless = entries.filter(e => !e.time);
    if (timeless.length > 0) {
      saveError = `${WEEKDAY_NAMES[wd]}: all same-day sessions need a time`;
      break;
    }
    const times = entries.map(e => e.time);
    if (new Set(times).size < times.length) {
      saveError = `${WEEKDAY_NAMES[wd]}: two sessions share the same time`;
      break;
    }
  }

  return (
    <ModalShell maxWidth="max-w-2xl">
      <div className="p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-medium text-gray-900">Training Days</h2>
          <button onClick={onCancel} className="p-1 hover:bg-gray-100 rounded transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-600">
              Drag to reorder · assign weekday to enable calendar view
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
              .filter(dayIndex => editingDayLabels[dayIndex] !== undefined)
              .map(dayIndex => {
                const entry = daySchedule[dayIndex] ?? null;
                const hasWeekday = entry !== null;
                const isInConflict = hasWeekday && (conflicts.get(entry.weekday)?.includes(dayIndex) ?? false);
                const needsTime = isInConflict && !entry?.time;

                return (
                  <div
                    key={dayIndex}
                    draggable
                    onDragStart={() => onDragStart(dayIndex)}
                    onDragOver={e => onDragOver(e, dayIndex)}
                    onDragEnd={onDragEnd}
                    className={`border rounded-lg transition-all cursor-move ${
                      draggedDayIndex === dayIndex
                        ? 'opacity-50 scale-95'
                        : isInConflict && saveError?.startsWith(WEEKDAY_NAMES[entry?.weekday ?? -1] ?? '__')
                          ? 'border-red-300 bg-red-50/30'
                          : 'border-gray-200 hover:bg-gray-50 hover:shadow-sm'
                    }`}
                  >
                    {/* Main row */}
                    <div className="flex items-center gap-2 p-3">
                      {/* Drag handle */}
                      <div className="flex flex-col gap-px flex-shrink-0">
                        {[0,1,2].map(i => <div key={i} className="h-1 w-1 bg-gray-400 rounded-full" />)}
                      </div>

                      {/* Active toggle */}
                      <input
                        type="checkbox"
                        checked={activeDays.includes(dayIndex)}
                        onChange={() => onToggleDay(dayIndex)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                      />

                      {/* Label */}
                      <input
                        type="text"
                        value={editingDayLabels[dayIndex] || ''}
                        onChange={e => onLabelChange(dayIndex, e.target.value)}
                        placeholder={`Day ${dayIndex}`}
                        className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />

                      {/* Weekday dropdown */}
                      <select
                        value={hasWeekday ? String(entry!.weekday) : ''}
                        onChange={e => {
                          const val = e.target.value;
                          if (!val) {
                            onScheduleChange(dayIndex, null);
                          } else {
                            const wd = Number(val);
                            // Auto-fill label if it's a default "Day N" label
                            const currentLabel = editingDayLabels[dayIndex] || '';
                            if (!currentLabel || DEFAULT_LABELS.includes(currentLabel)) {
                              onLabelChange(dayIndex, WEEKDAY_NAMES[wd]);
                            }
                            onScheduleChange(dayIndex, { weekday: wd, time: entry?.time ?? null });
                          }
                        }}
                        className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white flex-shrink-0"
                        style={{ minWidth: 110 }}
                      >
                        <option value="">Unassigned</option>
                        {WEEKDAY_NAMES.map((name, i) => (
                          <option key={i} value={String(i)}>{name}</option>
                        ))}
                      </select>

                      {/* Time input — only shown when weekday is assigned */}
                      {hasWeekday && (
                        <input
                          type="time"
                          value={entry?.time ?? ''}
                          onChange={e => {
                            onScheduleChange(dayIndex, { weekday: entry!.weekday, time: e.target.value || null });
                          }}
                          className={`text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 flex-shrink-0 ${
                            needsTime ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-300'
                          }`}
                          style={{ width: 110 }}
                        />
                      )}

                      {/* Remove */}
                      <button
                        onClick={() => onRemoveDay(dayIndex)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                        title="Remove"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    {/* Time presets — shown when weekday assigned */}
                    {hasWeekday && (
                      <div className="flex items-center gap-1.5 px-3 pb-2">
                        {needsTime && (
                          <span className="text-[10px] text-red-500 mr-1">Time required for same-day sessions</span>
                        )}
                        {!needsTime && (
                          <span className="text-[10px] text-gray-400 mr-1">Quick:</span>
                        )}
                        {TIME_PRESETS.map(t => (
                          <button
                            key={t}
                            onClick={() => onScheduleChange(dayIndex, { weekday: entry!.weekday, time: t })}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                              entry?.time === t
                                ? 'bg-blue-100 text-blue-700 border-blue-200'
                                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Same-day split info */}
                    {isInConflict && !needsTime && (
                      <div className="px-3 pb-2 text-[10px] text-purple-600">
                        AM/PM split — sessions will be stacked
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          <p className="text-xs text-gray-400 mt-2">
            Assign weekdays to enable the 7-column calendar view with rest gaps.
          </p>
        </div>

        {saveError && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {saveError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!!saveError}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
