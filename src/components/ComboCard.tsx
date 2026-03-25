import { CreditCard as Edit2, Trash2, GripVertical } from 'lucide-react';
import type { PlannedComboWithDetails, DefaultUnit } from '../lib/database.types';

interface ComboCardProps {
  combo: PlannedComboWithDetails;
  onEdit: (combo: PlannedComboWithDetails) => void;
  onDelete: (comboId: string) => void;
}

function formatUnit(unit: DefaultUnit): string {
  if (unit === 'absolute_kg') return 'kg';
  if (unit === 'percentage') return '%';
  if (unit === 'rpe') return 'RPE';
  return '';
}

function getComboDisplayName(combo: PlannedComboWithDetails): string {
  if (combo.combo_name) return combo.combo_name;
  if (combo.template?.name) return combo.template.name;
  return combo.items.map(i => i.exercise.name).join(' + ');
}

function calcComboSummary(combo: PlannedComboWithDetails): { totalSets: number; totalReps: number; highestLoad: number | null; avgLoad: number | null } {
  if (combo.set_lines.length === 0) return { totalSets: 0, totalReps: 0, highestLoad: null, avgLoad: null };
  let totalSets = 0;
  let totalReps = 0;
  let weightedLoadSum = 0;
  let highestLoad = 0;
  const hasLoad = combo.set_lines.some(l => l.load_value > 0);
  for (const line of combo.set_lines) {
    const repsInTuple = line.reps_tuple_text.split('+').reduce((s, p) => s + (parseInt(p.trim(), 10) || 0), 0);
    totalSets += line.sets;
    totalReps += line.sets * repsInTuple;
    if (line.load_value > highestLoad) highestLoad = line.load_value;
    weightedLoadSum += line.load_value * line.sets * repsInTuple;
  }
  const avgLoad = totalReps > 0 ? weightedLoadSum / totalReps : null;
  return {
    totalSets,
    totalReps,
    highestLoad: hasLoad ? highestLoad : null,
    avgLoad: hasLoad && avgLoad !== null ? avgLoad : null,
  };
}

export function ComboCard({ combo, onEdit, onDelete }: ComboCardProps) {
  const unitSymbol = formatUnit(combo.unit);
  const displayName = getComboDisplayName(combo);
  const hasSetLines = combo.set_lines.length > 0 && combo.set_lines.some(l => l.load_value > 0);
  const summary = calcComboSummary(combo);
  const hasSummary = summary.totalSets > 0;
  const ribbonColor = combo.color || '#3B82F6';

  return (
    <div className="group border-l-4 border rounded bg-white hover:bg-gray-50 transition-colors cursor-pointer" style={{ borderLeftColor: ribbonColor }}>
      <div className="flex items-start gap-2 p-3">
        <GripVertical size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0" onClick={() => onEdit(combo)}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="font-medium text-sm text-gray-900 truncate">{displayName}</div>
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded flex-shrink-0" style={{ backgroundColor: ribbonColor + '20', color: ribbonColor }}>
                COMBO
              </span>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(combo);
                }}
                className="p-1 hover:bg-gray-100 rounded text-gray-600"
                title="Edit combo"
              >
                <Edit2 className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(combo.id);
                }}
                className="p-1 text-red-600 hover:bg-red-50 rounded"
                title="Delete combo"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {!combo.combo_name && !combo.template?.name && combo.items.length <= 4 ? null : (
            <div className="text-xs text-gray-500 mb-1">
              {combo.items.map((item, index) => (
                <span key={item.id}>
                  {index > 0 && ' + '}
                  {item.exercise.name}
                </span>
              ))}
            </div>
          )}

          {hasSetLines ? (
            <div className="text-xs text-gray-700">
              {combo.set_lines.map((line, index) => (
                <span key={line.id}>
                  {line.load_value}{unitSymbol} x {line.reps_tuple_text}
                  {line.sets > 1 && <> x {line.sets}</>}
                  {index < combo.set_lines.length - 1 && ', '}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs italic text-gray-400">Click to add prescription</span>
          )}

          {hasSummary && (
            <div className="text-[10px] text-gray-500 mt-1">
              S {summary.totalSets} | R {summary.totalReps}
              {summary.highestLoad !== null && combo.unit === 'absolute_kg' && (
                <> | Hi {summary.highestLoad.toFixed(0)} | Avg {summary.avgLoad?.toFixed(0)}</>
              )}
            </div>
          )}

          {combo.notes && (
            <div className="mt-1 text-xs text-gray-600 italic">{combo.notes}</div>
          )}
        </div>
      </div>
    </div>
  );
}
