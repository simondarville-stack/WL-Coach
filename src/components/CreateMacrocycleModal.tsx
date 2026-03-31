import { X } from 'lucide-react';
import { ModalShell } from './ModalShell';

interface CreateMacrocycleModalProps {
  formData: { name: string; start_date: string; end_date: string };
  loading: boolean;
  onChange: (updates: Partial<{ name: string; start_date: string; end_date: string }>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function CreateMacrocycleModal({ formData, loading, onChange, onSubmit, onClose }: CreateMacrocycleModalProps) {
  return (
    <ModalShell>
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-lg">
        <h2 className="text-xl font-bold text-gray-900">Create New Macrocycle</h2>
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="Close"
        >
          <X size={20} />
        </button>
      </div>
      <div className="p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="e.g., Spring 2024"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <input
              type="date"
              value={formData.start_date}
              onChange={(e) => onChange({ start_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <input
              type="date"
              value={formData.end_date}
              onChange={(e) => onChange({ end_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
            >
              Create Macrocycle
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}
