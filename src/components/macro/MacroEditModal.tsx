import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { MacroCycle, MacroCompetition } from '../../lib/database.types';

interface CompetitionRow {
  id?: string; // existing competitions have an id
  name: string;
  date: string;
  is_primary: boolean;
}

interface MacroEditModalProps {
  cycle: MacroCycle;
  competitions: MacroCompetition[];
  loading: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    startDate: string;
    endDate: string;
    competitions: CompetitionRow[];
  }) => Promise<void>;
}

export function MacroEditModal({ cycle, competitions, loading, onClose, onSave }: MacroEditModalProps) {
  const [name, setName] = useState(cycle.name);
  const [startDate, setStartDate] = useState(cycle.start_date);
  const [endDate, setEndDate] = useState(cycle.end_date);
  const [comps, setComps] = useState<CompetitionRow[]>(
    competitions.map(c => ({
      id: c.id,
      name: c.competition_name,
      date: c.competition_date,
      is_primary: c.is_primary,
    }))
  );
  const [submitting, setSubmitting] = useState(false);

  const addCompetition = () => {
    setComps(prev => [...prev, { name: '', date: '', is_primary: false }]);
  };

  const removeCompetition = (i: number) => {
    setComps(prev => prev.filter((_, idx) => idx !== i));
  };

  const updateComp = (i: number, field: keyof CompetitionRow, value: string | boolean) => {
    setComps(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !startDate || !endDate) return;
    setSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        startDate,
        endDate,
        competitions: comps,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const startChanged = startDate !== cycle.start_date;
  const endChanged = endDate !== cycle.end_date;
  const endExtended = endChanged && endDate > cycle.end_date;
  const endShortened = endChanged && endDate < cycle.end_date;

  const canSubmit = name.trim() && startDate && endDate && startDate <= endDate;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-base font-medium text-gray-900">Edit Macrocycle</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
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
              {startChanged && (
                <p className="text-[11px] text-amber-600 mt-1">
                  Changing the start date updates the cycle header only — individual week dates are unchanged.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End date *</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {endExtended && (
                <p className="text-[11px] text-green-600 mt-1">New weeks will be added to the end.</p>
              )}
              {endShortened && (
                <p className="text-[11px] text-amber-600 mt-1">Weeks past the new end date will be removed.</p>
              )}
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

            {comps.length === 0 && (
              <p className="text-xs text-gray-400">No competitions added yet.</p>
            )}

            {comps.map((comp, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={comp.name}
                  onChange={e => updateComp(i, 'name', e.target.value)}
                  placeholder="Competition name"
                  className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="date"
                  value={comp.date}
                  onChange={e => updateComp(i, 'date', e.target.value)}
                  className="w-32 px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <label className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={comp.is_primary}
                    onChange={e => updateComp(i, 'is_primary', e.target.checked)}
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
            {submitting ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
