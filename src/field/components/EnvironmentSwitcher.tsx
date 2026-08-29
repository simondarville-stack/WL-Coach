/**
 * EnvironmentSwitcher — Field View: shows the active coach environment and
 * lets the coach switch to another from a bottom sheet. Mirrors the desktop
 * behaviour (coachStore.setActiveCoach + full reload so every owner-scoped
 * query re-runs under the new environment).
 */
import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useCoachStore } from '../../store/coachStore';
import { AdaptiveDialog } from '../../components/ui/AdaptiveDialog';
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
        className="inline-flex items-center gap-0.5 text-xs text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
        aria-label={`Environment: ${activeCoach.name}. Tap to switch`}
      >
        <span className="truncate max-w-[140px]">{activeCoach.name}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <AdaptiveDialog
          mode="sheet"
          panel="bare"
          onClose={() => setOpen(false)}
          ariaLabel="Switch environment"
        >
          <div className="bg-[var(--color-bg-primary)] border-t border-[color:var(--color-border-tertiary)] rounded-t-2xl max-w-2xl w-full mx-auto pb-6">
            <p className="text-[11px] uppercase tracking-wide text-[color:var(--color-text-secondary)] px-4 pt-4 pb-2">
              Environment
            </p>
            {coaches.map(c => (
              <button
                key={c.id}
                onClick={() => pick(c)}
                className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-gray-800/50"
              >
                <span className={`text-sm ${c.id === activeCoach.id ? 'text-white font-medium' : 'text-[color:var(--color-text-primary)]'}`}>
                  {c.name}
                </span>
                {c.id === activeCoach.id && <Check size={15} className="text-[color:var(--color-accent)]" />}
              </button>
            ))}
          </div>
        </AdaptiveDialog>
      )}
    </>
  );
}
