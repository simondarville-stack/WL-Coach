// @ts-nocheck
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../lib/dateHelpers';
import { Target, Flag, Layers } from 'lucide-react';
import type { MacroCycle, MacroWeek, MacroPhase, MacroCompetition } from '../../lib/database.types';

interface CycleData {
  macro: MacroCycle;
  weeks: MacroWeek[];
  phases: MacroPhase[];
  competitions: MacroCompetition[];
}

export function CycleScreen() {
  const { athlete } = useAuth();
  const [cycleData, setCycleData] = useState<CycleData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (athlete) loadCycle();
  }, [athlete]);

  async function loadCycle() {
    if (!athlete) return;
    setLoading(true);

    const { data: macros } = await supabase
      .from('macrocycles')
      .select('*')
      .eq('athlete_id', athlete.id)
      .order('start_date', { ascending: false })
      .limit(1);

    if (!macros || macros.length === 0) {
      setCycleData(null);
      setLoading(false);
      return;
    }

    const macro = macros[0];

    const [
      { data: weeks },
      { data: phases },
      { data: competitions },
    ] = await Promise.all([
      supabase
        .from('macro_weeks')
        .select('*')
        .eq('macrocycle_id', macro.id)
        .order('week_number'),
      supabase
        .from('macro_phases')
        .select('*')
        .eq('macrocycle_id', macro.id)
        .order('start_week_number'),
      supabase
        .from('macro_competitions')
        .select('*')
        .eq('macrocycle_id', macro.id)
        .order('competition_date'),
    ]);

    setCycleData({
      macro,
      weeks: weeks || [],
      phases: phases || [],
      competitions: competitions || [],
    });

    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!cycleData) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6">
        <h1 className="text-xl font-bold text-white mb-5">Cycle Overview</h1>
        <div className="text-center py-16">
          <Layers size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No training cycle set up</p>
          <p className="text-gray-600 text-sm mt-1">Your coach will create your macro plan</p>
        </div>
      </div>
    );
  }

  const { macro, weeks, phases, competitions } = cycleData;
  const today = new Date().toISOString().split('T')[0];
  const totalWeeks = weeks.length;

  const currentWeekIdx = weeks.findIndex(w => {
    const ws = new Date(w.week_start + 'T00:00:00');
    const we = new Date(ws);
    we.setDate(we.getDate() + 7);
    return today >= w.week_start && today < we.toISOString().split('T')[0];
  });

  const currentWeek = currentWeekIdx >= 0 ? weeks[currentWeekIdx] : null;
  const progressPct = totalWeeks > 0 && currentWeekIdx >= 0
    ? Math.round(((currentWeekIdx + 1) / totalWeeks) * 100)
    : 0;

  const currentPhase = currentWeek?.phase_id
    ? phases.find(p => p.id === currentWeek.phase_id)
    : null;

  const nextCompetition = competitions.find(c => c.competition_date >= today);
  const daysToComp = nextCompetition
    ? Math.ceil((new Date(nextCompetition.competition_date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <h1 className="text-xl font-bold text-white mb-1">{macro.name}</h1>
      <p className="text-sm text-gray-500 mb-5">
        {formatDate(macro.start_date)} - {formatDate(macro.end_date)}
      </p>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target size={14} className="text-blue-400" />
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Progress</span>
          </div>
          <span className="text-sm font-bold text-white">
            Week {currentWeekIdx >= 0 ? currentWeekIdx + 1 : '-'} of {totalWeeks}
          </span>
        </div>

        <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-700"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <p className="text-xs text-gray-500 text-right">{progressPct}% complete</p>
      </div>

      {currentPhase && (
        <div
          className="rounded-xl border p-4 mb-4"
          style={{
            backgroundColor: currentPhase.color + '15',
            borderColor: currentPhase.color + '40',
          }}
        >
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Current Phase</p>
          <p className="text-base font-bold text-white">{currentPhase.name}</p>
          {currentWeek && (
            <p className="text-xs text-gray-400 mt-1">
              Week type: {currentWeek.week_type_text || currentWeek.week_type}
            </p>
          )}
        </div>
      )}

      {nextCompetition && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Flag size={14} className="text-amber-400" />
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Next Competition</span>
          </div>
          <p className="text-base font-bold text-white">{nextCompetition.competition_name}</p>
          <p className="text-sm text-gray-400">{formatDate(nextCompetition.competition_date)}</p>
          {daysToComp !== null && (
            <p className="text-2xl font-black text-blue-400 mt-2">
              {daysToComp} <span className="text-sm font-medium text-gray-500">days out</span>
            </p>
          )}
        </div>
      )}

      {phases.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Phases</p>
          <div className="space-y-2">
            {phases.map(phase => {
              const isCurrent = currentPhase?.id === phase.id;
              const isPast = currentWeekIdx >= 0 && phase.end_week_number < (currentWeekIdx + 1);

              return (
                <div
                  key={phase.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                    isCurrent
                      ? 'border-blue-700/50 bg-blue-950/20'
                      : isPast
                      ? 'border-gray-800 bg-gray-900/50 opacity-60'
                      : 'border-gray-800 bg-gray-900'
                  }`}
                >
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: phase.color }}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-200">{phase.name}</p>
                    <p className="text-[11px] text-gray-500">
                      Weeks {phase.start_week_number} - {phase.end_week_number}
                    </p>
                  </div>
                  {isCurrent && (
                    <span className="text-[10px] font-semibold text-blue-400 uppercase">Current</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {competitions.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Competitions</p>
          <div className="space-y-2">
            {competitions.map(comp => {
              const isPast = comp.competition_date < today;
              return (
                <div
                  key={comp.id}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                    isPast ? 'border-gray-800 bg-gray-900/50 opacity-60' : 'border-gray-800 bg-gray-900'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-200">{comp.competition_name}</p>
                    <p className="text-xs text-gray-500">{formatDate(comp.competition_date)}</p>
                  </div>
                  {comp.is_primary && (
                    <span className="text-[10px] font-semibold text-amber-400 uppercase">Primary</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
