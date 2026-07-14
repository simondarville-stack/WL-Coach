import { useState } from 'react';
import { X } from 'lucide-react';
import type { MacroCycle } from '../../lib/database.types';
import { Button } from '../ui';
import { DateInput } from '../ui/DateInput';

interface MacroEditModalProps {
  cycle: MacroCycle;
  loading: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    startDate: string;
    endDate: string;
  }) => Promise<void>;
}

// Competitions & training camps are managed from the toolbar's "Add event"
// menu (they live in the shared events model), not here — Edit cycle is now
// just the cycle's name and its date range.
export function MacroEditModal({ cycle, loading, onClose, onSave }: MacroEditModalProps) {
  const [name, setName] = useState(cycle.name);
  const [startDate, setStartDate] = useState(cycle.start_date);
  const [endDate, setEndDate] = useState(cycle.end_date);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !startDate || !endDate) return;
    setSubmitting(true);
    try {
      await onSave({ name: name.trim(), startDate, endDate });
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
      <div className="rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--color-border-tertiary)] flex-shrink-0">
          <h2 className="text-base font-medium" style={{ color: 'var(--color-text-primary)' }}>Edit Macrocycle</h2>
          <button onClick={onClose} className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-secondary)]"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-border)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Start date *</label>
              <DateInput value={startDate} onChange={setStartDate} snapToMonday />
              {startChanged && (
                <p className="text-[11px] text-amber-600 mt-1">
                  The whole cycle shifts to the new start — week structure, types and targets are preserved.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>End date *</label>
              <DateInput value={endDate} onChange={setEndDate} snapToMonday />
              {endExtended && (
                <p className="text-[11px] text-green-600 mt-1">New weeks will be added to the end.</p>
              )}
              {endShortened && (
                <p className="text-[11px] text-amber-600 mt-1">Weeks past the new end date will be removed.</p>
              )}
            </div>
          </div>

          <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            Add competitions and training camps from the toolbar’s <span className="font-medium">Add event</span> menu.
          </p>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-[color:var(--color-border-tertiary)] flex-shrink-0">
          <Button
            variant="secondary"
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting || loading}
            className="flex-1"
          >
            {submitting ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
