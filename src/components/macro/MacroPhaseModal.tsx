import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { MacroPhase, MacroWeek, PhaseType } from '../../lib/database.types';

interface MacroPhaseModalProps {
  macrocycleId: string;
  macroWeeks: MacroWeek[];
  editingPhase: MacroPhase | null;
  nextPosition: number;
  onSave: (phase: Omit<MacroPhase, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onClose: () => void;
}

const PHASE_TYPE_OPTIONS: { value: PhaseType; label: string; color: string }[] = [
  { value: 'preparatory', label: 'Preparatory', color: '#DBEAFE' },
  { value: 'strength', label: 'Strength', color: '#FEE2E2' },
  { value: 'competition', label: 'Competition', color: '#FEF3C7' },
  { value: 'transition', label: 'Transition', color: '#F3F4F6' },
  { value: 'custom', label: 'Custom', color: '#E5E7EB' },
];

export function MacroPhaseModal({
  macrocycleId,
  macroWeeks,
  editingPhase,
  nextPosition,
  onSave,
  onClose,
}: MacroPhaseModalProps) {
  const [name, setName] = useState('');
  const [phaseType, setPhaseType] = useState<PhaseType>('custom');
  const [startWeekNum, setStartWeekNum] = useState(1);
  const [endWeekNum, setEndWeekNum] = useState(macroWeeks.length || 1);
  const [color, setColor] = useState('#E5E7EB');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingPhase) {
      setName(editingPhase.name);
      setPhaseType(editingPhase.phase_type);
      setStartWeekNum(editingPhase.start_week_number);
      setEndWeekNum(editingPhase.end_week_number);
      setColor(editingPhase.color);
      setNotes(editingPhase.notes);
    }
  }, [editingPhase]);

  const handlePhaseTypeChange = (pt: PhaseType) => {
    setPhaseType(pt);
    const preset = PHASE_TYPE_OPTIONS.find(o => o.value === pt);
    if (preset) setColor(preset.color);
    if (!name || PHASE_TYPE_OPTIONS.some(o => o.label === name)) {
      setName(preset?.label || '');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        macrocycle_id: macrocycleId,
        name: name.trim(),
        phase_type: phaseType,
        start_week_number: startWeekNum,
        end_week_number: endWeekNum,
        color,
        notes,
        position: editingPhase?.position ?? nextPosition,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const weekNumbers = macroWeeks.map(w => w.week_number);
  const minWeek = weekNumbers.length > 0 ? Math.min(...weekNumbers) : 1;
  const maxWeek = weekNumbers.length > 0 ? Math.max(...weekNumbers) : 1;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="rounded-lg max-w-md w-full" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-medium text-gray-900">
            {editingPhase ? 'Edit Phase' : 'Add Phase'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Accumulation, Strength Block"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phase type</label>
            {/* Free-text entry with preset suggestions — PhaseType is an open string (see database.types.ts) */}
            <input
              list="phase-type-suggestions"
              value={phaseType}
              onChange={e => handlePhaseTypeChange(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Preparatory, Strength, Competition…"
            />
            <datalist id="phase-type-suggestions">
              {PHASE_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start week</label>
              <select
                value={startWeekNum}
                onChange={e => setStartWeekNum(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: maxWeek - minWeek + 1 }, (_, i) => minWeek + i).map(n => (
                  <option key={n} value={n}>Week {n}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End week</label>
              <select
                value={endWeekNum}
                onChange={e => setEndWeekNum(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: maxWeek - startWeekNum + 1 }, (_, i) => startWeekNum + i).map(n => (
                  <option key={n} value={n}>Week {n}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
              />
              <span className="text-sm text-gray-500">Background color for the phase band</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Optional notes about this phase..."
            />
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : editingPhase ? 'Update' : 'Add Phase'}
          </button>
        </div>
      </div>
    </div>
  );
}
