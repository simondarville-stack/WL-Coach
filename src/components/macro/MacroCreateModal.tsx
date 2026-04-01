import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

interface CompetitionRow {
  name: string;
  date: string;
  is_primary: boolean;
}

type PhasePreset = 'none' | '8week' | '12week' | 'custom';

interface MacroCreateModalProps {
  loading: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    startDate: string;
    endDate: string;
    competitions: CompetitionRow[];
    phasePreset: PhasePreset;
  }) => Promise<void>;
}

export function MacroCreateModal({ loading, onClose, onCreate }: MacroCreateModalProps) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [phasePreset, setPhasePreset] = useState<PhasePreset>('none');
  const [submitting, setSubmitting] = useState(false);

  const addCompetition = () => {
    setCompetitions(prev => [...prev, { name: '', date: '', is_primary: false }]);
  };

  const removeCompetition = (i: number) => {
    setCompetitions(prev => prev.filter((_, idx) => idx !== i));
  };

  const updateCompetition = (i: number, field: keyof CompetitionRow, value: string | boolean) => {
    setCompetitions(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !startDate || !endDate) return;
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        startDate,
        endDate,
        competitions: competitions.filter(c => c.name.trim() && c.date),
        phasePreset,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = name.trim() && startDate && endDate && startDate <= endDate;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Create Macrocycle</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. 2026 Olympic Prep"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start date *</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End date *</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Phase preset</label>
            <div className="space-y-2">
              {([
                ['none', 'No phases'],
                ['8week', '8-week (Prep + Comp)'],
                ['12week', '12-week (Accum + Strength + Comp)'],
                ['custom', 'Custom (add phases manually later)'],
              ] as [PhasePreset, string][]).map(([val, label]) => (
                <label key={val} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="phasePreset"
                    value={val}
                    checked={phasePreset === val}
                    onChange={() => setPhasePreset(val)}
                    className="text-blue-600"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Competition dates</label>
              <button
                onClick={addCompetition}
                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <Plus size={12} /> Add
              </button>
            </div>

            {competitions.length === 0 && (
              <p className="text-xs text-gray-400">No competitions added yet.</p>
            )}

            {competitions.map((comp, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={comp.name}
                  onChange={e => updateCompetition(i, 'name', e.target.value)}
                  placeholder="Competition name"
                  className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="date"
                  value={comp.date}
                  onChange={e => updateCompetition(i, 'date', e.target.value)}
                  className="w-32 px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <label className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={comp.is_primary}
                    onChange={e => updateCompetition(i, 'is_primary', e.target.checked)}
                    className="text-blue-600"
                  />
                  Primary
                </label>
                <button onClick={() => removeCompetition(i)} className="text-red-500 hover:text-red-700">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting || loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
