import { useAuth } from '../lib/AuthContext';
import { Dumbbell, User } from 'lucide-react';
import type { Athlete } from '../../lib/database.types';

export function ProfilePicker() {
  const { athletes, selectAthlete } = useAuth();

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Dumbbell size={36} className="text-blue-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-white">WinWota</h1>
          <p className="text-sm text-gray-500 mt-1">Select your profile</p>
        </div>

        {athletes.length === 0 ? (
          <p className="text-sm text-gray-500 text-center">No athlete profiles found.</p>
        ) : (
          <div className="space-y-2">
            {athletes.map(a => (
              <AthleteRow key={a.id} athlete={a} onSelect={selectAthlete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AthleteRow({ athlete, onSelect }: { athlete: Athlete; onSelect: (a: Athlete) => void }) {
  return (
    <button
      onClick={() => onSelect(athlete)}
      className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-600 transition-colors text-left"
    >
      <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {athlete.photo_url ? (
          <img src={athlete.photo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <User size={18} className="text-gray-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{athlete.name}</p>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {athlete.weight_class && <span>{athlete.weight_class}</span>}
          {athlete.club && <span>{athlete.club}</span>}
        </div>
      </div>
    </button>
  );
}
