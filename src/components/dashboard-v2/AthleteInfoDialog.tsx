// Lightweight info dialog for an athlete. Surfaces the basics (photo, name,
// weight class, club, birthdate-derived age, bodyweight) plus quick actions
// (open planner, open macro plan, view full athlete profile).

import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { AthleteStatus } from '../../hooks/useCoachDashboard';
import type { AthleteEnrichment } from '../../hooks/useCoachDashboardV2';
import { calculateAge } from '../../lib/calculations';
import { Avatar, RawChip, BwDelta, PhasePill, WeekPill } from './atoms';

interface Props {
  status: AthleteStatus;
  enrichment: AthleteEnrichment;
  onClose: () => void;
  onOpenPlanner: (status: AthleteStatus) => void;
  onOpenMacro: (status: AthleteStatus) => void;
  onOpenAthletesPage: () => void;
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">{label}</span>
      <span className="text-sm text-gray-900">{children}</span>
    </div>
  );
}

export function AthleteInfoDialog({
  status, enrichment, onClose, onOpenPlanner, onOpenMacro, onOpenAthletesPage,
}: Props) {
  const a = status.athlete;
  const age = calculateAge(a.birthdate);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={`Athlete · ${a.name}`}
        className="relative bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-center gap-3 border-b border-gray-100">
          {a.photo_url ? (
            <img
              src={a.photo_url}
              alt=""
              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <Avatar name={a.name} size={48} />
          )}
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-base font-medium text-gray-900 truncate">{a.name}</span>
            <span className="text-xs text-gray-500 truncate">
              {a.weight_class || 'No weight class'}
              {a.club ? ` · ${a.club}` : ''}
              {age !== null ? ` · ${age}y` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Status quick view */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <KV label="Phase / week">
              <PhasePill
                name={enrichment.phaseName}
                color={enrichment.phaseColor}
                week={status.currentMacroWeek?.week_number ?? null}
                total={status.totalMacroWeeks}
              />
            </KV>
            <KV label="RAW (latest)">
              <RawChip pillars={enrichment.rawPillars} avg={status.rawAverage} />
            </KV>
            <KV label="This week">
              <WeekPill state={status.currentWeekPlanned ? 'planned' : 'missing'} />
            </KV>
            <KV label="Next week">
              <WeekPill state={status.nextWeekPlanned ? 'planned' : 'missing'} />
            </KV>
            <KV label="Bodyweight">
              {a.track_bodyweight
                ? <BwDelta bw={enrichment.bw} expanded />
                : <span className="text-sm text-gray-400">Not tracked</span>}
            </KV>
            <KV label="Competition total">
              <span className="tabular-nums">
                {a.competition_total !== null ? `${a.competition_total} kg` : '—'}
              </span>
            </KV>
          </div>

          {a.notes && (
            <div>
              <span className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">Notes</span>
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{a.notes}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2 flex-wrap bg-gray-50">
          <button
            type="button"
            onClick={() => onOpenPlanner(status)}
            className="px-3 py-1.5 text-xs rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Open planner
          </button>
          <button
            type="button"
            onClick={() => onOpenMacro(status)}
            disabled={!status.currentMacrocycle}
            className="px-3 py-1.5 text-xs rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Open macro plan
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onOpenAthletesPage}
            className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            View full profile →
          </button>
        </div>
      </div>
    </div>
  );
}
