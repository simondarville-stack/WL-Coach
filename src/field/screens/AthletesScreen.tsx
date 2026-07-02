/**
 * AthletesScreen — Field View: training groups and athletes as plain lists.
 * Tapping a group opens its group-level week plan; tapping an athlete opens
 * that athlete's full week.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Loader2, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import type { Athlete, TrainingGroup } from '../../lib/database.types';

export function AthletesScreen() {
  const navigate = useNavigate();
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [groups, setGroups] = useState<TrainingGroup[]>([]);
  const weekStart = getMondayOfWeekISO(new Date());

  useEffect(() => {
    let alive = true;
    (async () => {
      const ownerId = getOwnerId();
      const [{ data: athleteRows }, { data: groupRows }] = await Promise.all([
        supabase
          .from('athletes')
          .select('*')
          .eq('owner_id', ownerId)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('training_groups')
          .select('*')
          .eq('owner_id', ownerId)
          .order('name'),
      ]);
      if (!alive) return;
      setAthletes((athleteRows ?? []) as Athlete[]);
      setGroups((groupRows ?? []) as TrainingGroup[]);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-3 pt-4">
      <h1 className="text-lg font-bold text-white px-1 mb-3">Athletes</h1>
      {athletes === null ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-gray-600" />
        </div>
      ) : (
        <>
          {groups.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wide text-gray-600 px-1 mb-1">Groups</p>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-3">
                {groups.map((g, i) => (
                  <button
                    key={g.id}
                    onClick={() => navigate(`/field/g/${g.id}?w=${weekStart}`)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left active:bg-gray-800/50 ${
                      i > 0 ? 'border-t border-gray-800/80' : ''
                    }`}
                  >
                    <span className="text-sm text-white flex items-center gap-2 min-w-0">
                      <Users size={13} className="text-gray-500 shrink-0" />
                      <span className="truncate">{g.name}</span>
                    </span>
                    <ChevronRight size={14} className="text-gray-600 shrink-0" />
                  </button>
                ))}
              </div>
              <p className="text-[10px] uppercase tracking-wide text-gray-600 px-1 mb-1">Athletes</p>
            </>
          )}
          {athletes.length === 0 ? (
            <p className="text-sm text-gray-500 px-1">No active athletes in this environment.</p>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-4">
              {athletes.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => navigate(`/field/a/${a.id}?w=${weekStart}`)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-left active:bg-gray-800/50 ${
                    i > 0 ? 'border-t border-gray-800/80' : ''
                  }`}
                >
                  <span className="text-sm text-white truncate">{a.name}</span>
                  <ChevronRight size={14} className="text-gray-600 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
