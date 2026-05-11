
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatDate, toISODate } from '../lib/dateHelpers';
import { LogOut, Scale, User, Plus } from 'lucide-react';
import type { BodyweightEntry } from '../../lib/database.types';

export function ProfileScreen() {
  const { athlete, signOut } = useAuth();
  const [bodyweightEntries, setBodyweightEntries] = useState<BodyweightEntry[]>([]);
  const [newWeight, setNewWeight] = useState('');
  const [addingWeight, setAddingWeight] = useState(false);
  const [coachName, setCoachName] = useState('');

  useEffect(() => {
    if (athlete) {
      loadBodyweight();
      loadCoach();
    }
  }, [athlete]);

  async function loadBodyweight() {
    if (!athlete) return;
    const { data } = await supabase
      .from('bodyweight_entries')
      .select('*')
      .eq('athlete_id', athlete.id)
      .order('date', { ascending: false })
      .limit(30);

    setBodyweightEntries(data || []);
  }

  async function loadCoach() {
    if (!athlete) return;
    const { data } = await supabase
      .from('coach_profiles')
      .select('name')
      .eq('id', athlete.owner_id)
      .maybeSingle();

    setCoachName(data?.name || '');
  }

  async function handleAddWeight() {
    if (!athlete || !newWeight) return;
    setAddingWeight(true);

    const todayStr = toISODate(new Date());
    const weight = parseFloat(newWeight);
    if (isNaN(weight) || weight <= 0) {
      setAddingWeight(false);
      return;
    }

    const existing = bodyweightEntries.find(e => e.date === todayStr);
    if (existing) {
      await supabase
        .from('bodyweight_entries')
        .update({ weight_kg: weight })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('bodyweight_entries')
        .insert({ athlete_id: athlete.id, date: todayStr, weight_kg: weight });
    }

    await supabase
      .from('athletes')
      .update({ bodyweight: weight })
      .eq('id', athlete.id);

    setNewWeight('');
    await loadBodyweight();
    setAddingWeight(false);
  }

  if (!athlete) return null;

  const latestWeight = bodyweightEntries.length > 0 ? bodyweightEntries[0].weight_kg : athlete.bodyweight;
  const age = athlete.birthdate
    ? Math.floor((Date.now() - new Date(athlete.birthdate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24 * 365.25))
    : null;

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {athlete.photo_url ? (
            <img src={athlete.photo_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <User size={28} className="text-gray-500" />
          )}
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{athlete.name}</h1>
          <div className="flex items-center gap-3 text-sm text-gray-500 mt-0.5">
            {athlete.weight_class && <span>{athlete.weight_class}</span>}
            {age && <span>{age} yrs</span>}
            {athlete.club && <span>{athlete.club}</span>}
          </div>
        </div>
      </div>

      {coachName && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3 mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Coach</p>
          <p className="text-sm font-medium text-gray-200 mt-0.5">{coachName}</p>
        </div>
      )}

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Scale size={14} className="text-blue-400" />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Bodyweight</span>
        </div>

        {latestWeight && (
          <p className="text-3xl font-black text-white mb-3">
            {latestWeight}<span className="text-sm font-medium text-gray-500 ml-1">kg</span>
          </p>
        )}

        <div className="flex gap-2 mb-4">
          <input
            type="number"
            step="0.1"
            value={newWeight}
            onChange={e => setNewWeight(e.target.value)}
            placeholder="Log today's weight"
            className="flex-1 px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={handleAddWeight}
            disabled={addingWeight || !newWeight}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-40 transition-colors"
          >
            <Plus size={18} />
          </button>
        </div>

        {bodyweightEntries.length > 0 && (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {bodyweightEntries.slice(0, 10).map(entry => (
              <div key={entry.id} className="flex items-center justify-between text-sm py-1">
                <span className="text-gray-500">{formatDate(entry.date)}</span>
                <span className="font-medium text-gray-300">{entry.weight_kg}kg</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {athlete.notes && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Notes</p>
          <p className="text-sm text-gray-300">{athlete.notes}</p>
        </div>
      )}

      <button
        onClick={signOut}
        className="w-full flex items-center justify-center gap-2 py-3 bg-gray-900 border border-gray-800 rounded-xl text-red-400 hover:bg-red-950/20 hover:border-red-800/50 transition-colors mt-6"
      >
        <LogOut size={16} />
        <span className="text-sm font-medium">Sign Out</span>
      </button>
    </div>
  );
}
