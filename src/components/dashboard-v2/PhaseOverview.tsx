import type { AthleteSnapshot } from '../../hooks/useCoachDashboardV2';

interface Props {
  athletes: AthleteSnapshot[];
}

interface PhaseGroup {
  name: string;
  color: string | null;
  athletes: { name: string; weekNumber: number; totalWeeks: number }[];
}

export function PhaseOverview({ athletes }: Props) {
  const withPhase = athletes.filter(a => a.phaseName);
  const withoutPhase = athletes.filter(a => !a.phaseName && a.macrocycle);
  const withoutMacro = athletes.filter(a => !a.macrocycle);

  if (withPhase.length === 0 && withoutPhase.length === 0) return null;

  const phaseMap = new Map<string, PhaseGroup>();
  for (const snap of withPhase) {
    const key = snap.phaseName!;
    if (!phaseMap.has(key)) {
      phaseMap.set(key, { name: key, color: snap.phaseColor, athletes: [] });
    }
    phaseMap.get(key)!.athletes.push({
      name: snap.athlete.name,
      weekNumber: (snap.macroWeek as any)?.week_number ?? 0,
      totalWeeks: snap.totalMacroWeeks,
    });
  }

  const phases = [...phaseMap.values()].sort((a, b) => b.athletes.length - a.athletes.length);

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="px-3 py-2 border-b border-gray-100">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Current phases</h3>
      </div>
      <div className="p-3 space-y-2">
        {phases.map(phase => (
          <div key={phase.name}>
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: phase.color || '#9ca3af' }}
              />
              <span className="text-xs font-medium text-gray-700">{phase.name}</span>
              <span className="text-[10px] text-gray-400">{phase.athletes.length} athlete{phase.athletes.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex flex-wrap gap-1 ml-4">
              {phase.athletes.map(a => (
                <span
                  key={a.name}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-gray-150 text-gray-600"
                  style={{ borderColor: phase.color ? `${phase.color}40` : '#e5e7eb' }}
                >
                  {a.name.split(' ')[0]}
                  <span className="text-gray-400 ml-0.5">W{a.weekNumber}/{a.totalWeeks}</span>
                </span>
              ))}
            </div>
          </div>
        ))}

        {withoutPhase.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-gray-300" />
              <span className="text-xs font-medium text-gray-500">No phase defined</span>
            </div>
            <div className="flex flex-wrap gap-1 ml-4">
              {withoutPhase.map(snap => (
                <span key={snap.athlete.id} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-150 text-gray-500">
                  {snap.athlete.name.split(' ')[0]}
                </span>
              ))}
            </div>
          </div>
        )}

        {withoutMacro.length > 0 && (
          <div className="pt-1 border-t border-gray-100">
            <span className="text-[10px] text-gray-400">
              {withoutMacro.length} athlete{withoutMacro.length !== 1 ? 's' : ''} without active cycle:
              {' '}{withoutMacro.map(s => s.athlete.name.split(' ')[0]).join(', ')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
