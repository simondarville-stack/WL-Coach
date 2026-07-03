/**
 * EnvironmentSwitcher — Field View: shows the active coach environment and
 * lets the coach switch to another from a bottom sheet. Mirrors the desktop
 * behaviour (coachStore.setActiveCoach + full reload so every owner-scoped
 * query re-runs under the new environment).
 */
import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useCoachStore } from '../../store/coachStore';
import type { CoachProfile } from '../../lib/database.types';

export function EnvironmentSwitcher() {
  const { activeCoach, coaches, setActiveCoach } = useCoachStore();
  const [open, setOpen] = useState(false);

  if (!activeCoach) return null;

  const pick = (coach: CoachProfile) => {
    setOpen(false);
    if (coach.id === activeCoach.id) return;
    setActiveCoach(coach);
    window.location.reload();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-0.5 text-xs text-gray-500 hover:text-gray-300"
        aria-label={`Environment: ${activeCoach.name}. Tap to switch`}
      >
        <span className="truncate max-w-[140px]">{activeCoach.name}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex flex-col justify-end"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-label="Switch environment"
        >
          <div
            className="bg-gray-900 border-t border-gray-800 rounded-t-2xl max-w-2xl w-full mx-auto pb-6"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[11px] uppercase tracking-wide text-gray-500 px-4 pt-4 pb-2">
              Environment
            </p>
            {coaches.map(c => (
              <button
                key={c.id}
                onClick={() => pick(c)}
                className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-gray-800/50"
              >
                <span className={`text-sm ${c.id === activeCoach.id ? 'text-white font-medium' : 'text-gray-300'}`}>
                  {c.name}
                </span>
                {c.id === activeCoach.id && <Check size={15} className="text-blue-400" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
