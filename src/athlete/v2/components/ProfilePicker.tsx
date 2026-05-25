import { Dumbbell, User, Users } from 'lucide-react';
import type { Athlete, TrainingGroup } from '../../../lib/database.types';
import { useAuth } from '../lib/AuthContext';

export function ProfilePicker() {
  const { athletes, groups, selectAthlete, selectGroup } = useAuth();
  const hasAthletes = athletes.length > 0;
  const hasGroups = groups.length > 0;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Dumbbell size={36} className="text-blue-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-white">EMOS</h1>
          <p className="text-sm text-gray-500 mt-1">Select your profile</p>
        </div>

        {!hasAthletes && !hasGroups ? (
          <p className="text-sm text-gray-500 text-center">No profiles or groups found.</p>
        ) : (
          <div className="space-y-5">
            {hasAthletes && (
              <section>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2 px-1">Athletes</p>
                <div className="space-y-2">
                  {athletes.map(a => (
                    <AthleteRow key={a.id} athlete={a} onSelect={selectAthlete} />
                  ))}
                </div>
              </section>
            )}
            {hasGroups && (
              <section>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2 px-1">
                  Group plans <span className="text-gray-600 normal-case font-normal">· view only</span>
                </p>
                <div className="space-y-2">
                  {groups.map(g => (
                    <GroupRow key={g.id} group={g} onSelect={selectGroup} />
                  ))}
                </div>
              </section>
            )}
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

function GroupRow({ group, onSelect }: { group: TrainingGroup; onSelect: (g: TrainingGroup) => void }) {
  return (
    <button
      onClick={() => onSelect(group)}
      className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-600 transition-colors text-left"
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-gray-800"
      >
        <Users size={18} className="text-gray-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{group.name}</p>
        <p className="text-xs text-gray-500">Group plan · view only</p>
      </div>
    </button>
  );
}
