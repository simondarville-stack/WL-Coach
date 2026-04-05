import { useState } from 'react';
import { X } from 'lucide-react';
import { useCoachProfiles } from '../hooks/useCoachProfiles';
import { supabase } from '../lib/supabase';
import type { CoachProfile } from '../lib/database.types';

interface CoachProfileModalProps {
  onClose: () => void;
  onCreated: (coach: CoachProfile) => void;
}

export function CoachProfileModal({ onClose, onCreated }: CoachProfileModalProps) {
  const { createCoach } = useCoachProfiles();
  const [name, setName] = useState('');
  const [clubName, setClubName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const coach = await createCoach({
        name: name.trim(),
        club_name: clubName.trim() || undefined,
        email: email.trim() || undefined,
      });

      // Create default settings for this coach
      await supabase.from('general_settings').insert({
        owner_id: coach.id,
        raw_enabled: true,
        raw_average_days: 7,
        grid_load_increment: 5,
        grid_click_increment: 1,
      });

      onCreated(coach);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create environment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-medium text-gray-900">New coaching environment</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Coach name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Club</label>
            <input
              type="text"
              value={clubName}
              onChange={e => setClubName(e.target.value)}
              placeholder="Club name (optional)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            This creates a completely separate data environment. Athletes, exercises, and plans are not shared between environments.
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create environment'}
          </button>
        </div>
      </div>
    </div>
  );
}
