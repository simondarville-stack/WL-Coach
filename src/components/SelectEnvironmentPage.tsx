import { Dumbbell, Plus } from 'lucide-react';
import type { CoachProfile } from '../lib/database.types';
import { useCoachStore } from '../store/coachStore';

interface Props {
  coaches: CoachProfile[];
  onNewEnvironment: () => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

const CARD_COLORS = [
  'bg-blue-500', 'bg-sky-500', 'bg-emerald-500', 'bg-teal-500',
  'bg-orange-500', 'bg-amber-500', 'bg-cyan-500', 'bg-slate-500',
];

export function SelectEnvironmentPage({ coaches, onNewEnvironment }: Props) {
  const { setActiveCoach } = useCoachStore();

  function handleSelect(coach: CoachProfile) {
    setActiveCoach(coach);
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8">
      {/* Logo */}
      <div className="flex flex-col items-center gap-1 mb-10">
        <div className="flex items-center gap-2.5">
          <Dumbbell className="text-blue-600" size={28} />
          <span className="text-2xl font-semibold text-gray-900">EMOS</span>
        </div>
        <span className="text-xs text-gray-400">Erfolg Muss Organisiert Sein</span>
      </div>

      <div className="w-full max-w-xl">
        <h2 className="text-lg font-medium text-gray-800 mb-1">Select an environment</h2>
        <p className="text-sm text-gray-400 mb-6">
          Each environment is a separate coaching space with its own athletes, exercises, and plans.
        </p>

        {/* Environment cards */}
        {coaches.length > 0 ? (
          <div className="grid gap-3 mb-4">
            {coaches.map((coach, i) => (
              <button
                key={coach.id}
                onClick={() => handleSelect(coach)}
                className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-4
                           hover:border-blue-300 hover:shadow-sm transition-all text-left group"
              >
                {/* Avatar */}
                {coach.photo_url ? (
                  <img
                    src={coach.photo_url}
                    alt={coach.name}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ${CARD_COLORS[i % CARD_COLORS.length]}`}>
                    {initials(coach.name)}
                  </div>
                )}

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 text-sm group-hover:text-blue-600 transition-colors">
                    {coach.name}
                  </div>
                  {coach.club_name && (
                    <div className="text-xs text-gray-400 mt-0.5 truncate">{coach.club_name}</div>
                  )}
                </div>

                <div className="text-xs text-gray-300 group-hover:text-blue-400 transition-colors flex-shrink-0">
                  Enter →
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-8 text-center mb-4">
            <p className="text-sm text-gray-400">No environments yet. Create one to get started.</p>
          </div>
        )}

        {/* Create new */}
        <button
          onClick={onNewEnvironment}
          className="w-full flex items-center justify-center gap-2 border border-dashed border-gray-300
                     rounded-xl px-5 py-3.5 text-sm text-gray-500 hover:text-blue-600 hover:border-blue-300
                     hover:bg-blue-50/50 transition-all"
        >
          <Plus size={16} />
          New environment
        </button>
      </div>
    </div>
  );
}
