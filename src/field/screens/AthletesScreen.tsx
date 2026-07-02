/**
 * AthletesScreen — Field View: plain athlete list; tapping a name opens
 * that athlete's full week.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import type { Athlete } from '../../lib/database.types';

export function AthletesScreen() {
  const navigate = useNavigate();
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const weekStart = getMondayOfWeekISO(new Date());

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('athletes')
        .select('*')
        .eq('owner_id', getOwnerId())
        .eq('is_active', true)
        .order('name');
      if (alive) setAthletes((data ?? []) as Athlete[]);
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
      ) : athletes.length === 0 ? (
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
    </div>
  );
}
