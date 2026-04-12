import { useState, useEffect } from 'react';
import { User, Users } from 'lucide-react';
import { useAthleteStore } from '../store/athleteStore';
import { supabase } from '../lib/supabase';
import type { Athlete, TrainingGroup } from '../lib/database.types';

interface GroupWithMembers {
  group: TrainingGroup;
  athletes: Athlete[];
}

export function AthleteCardPicker() {
  const {
    athletes,
    groups,
    setSelectedAthlete,
    setSelectedGroup,
  } = useAthleteStore();

  const [groupedData, setGroupedData] = useState<GroupWithMembers[]>([]);
  const [ungrouped, setUngrouped] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);

  const activeAthletes = athletes.filter(a => a.is_active);

  useEffect(() => {
    loadGroupMemberships();
  }, [athletes, groups]);

  const loadGroupMemberships = async () => {
    if (groups.length === 0) {
      setGroupedData([]);
      setUngrouped(activeAthletes);
      setLoading(false);
      return;
    }

    try {
      const { data: members } = await supabase
        .from('group_members')
        .select('group_id, athlete_id')
        .is('left_at', null);

      const memberMap = new Map<string, Set<string>>();
      const athleteInGroup = new Set<string>();

      for (const m of members || []) {
        if (!memberMap.has(m.group_id)) memberMap.set(m.group_id, new Set());
        memberMap.get(m.group_id)!.add(m.athlete_id);
        athleteInGroup.add(m.athlete_id);
      }

      const activeMap = new Map(activeAthletes.map(a => [a.id, a]));

      const grouped: GroupWithMembers[] = groups
        .map(group => {
          const memberIds = memberMap.get(group.id) || new Set();
          const groupAthletes = [...memberIds]
            .map(id => activeMap.get(id))
            .filter((a): a is Athlete => !!a)
            .sort((a, b) => a.name.localeCompare(b.name));
          return { group, athletes: groupAthletes };
        })
        .filter(g => g.athletes.length > 0);

      const ungroupedAthletes = activeAthletes
        .filter(a => !athleteInGroup.has(a.id))
        .sort((a, b) => a.name.localeCompare(b.name));

      setGroupedData(grouped);
      setUngrouped(ungroupedAthletes);
    } catch {
      setUngrouped(activeAthletes);
      setGroupedData([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Loading athletes...
      </div>
    );
  }

  if (activeAthletes.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <User className="mx-auto text-gray-300 mb-3" size={36} />
          <p className="text-sm text-gray-500">No active athletes</p>
          <p className="text-xs text-gray-400 mt-1">Add athletes in the Athletes section first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <p className="text-sm text-gray-500 mb-5 text-center">Select an athlete to continue</p>

      {groupedData.map(({ group, athletes: groupAthletes }) => (
        <div key={group.id} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Users size={14} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{group.name}</h3>
            <button
              onClick={() => setSelectedGroup(group)}
              className="ml-auto text-[11px] text-blue-600 hover:text-blue-800 font-medium"
            >
              Select entire group
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {groupAthletes.map(athlete => (
              <AthleteCard key={athlete.id} athlete={athlete} onSelect={setSelectedAthlete} />
            ))}
          </div>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div className="mb-6">
          {groupedData.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <User size={14} className="text-gray-400" />
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Individual</h3>
            </div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {ungrouped.map(athlete => (
              <AthleteCard key={athlete.id} athlete={athlete} onSelect={setSelectedAthlete} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AthleteCard({ athlete, onSelect }: { athlete: Athlete; onSelect: (a: Athlete) => void }) {
  return (
    <button
      onClick={() => onSelect(athlete)}
      className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40 transition-all cursor-pointer group"
    >
      {athlete.photo_url ? (
        <img
          src={athlete.photo_url}
          alt={athlete.name}
          className="w-12 h-12 rounded-full object-cover ring-2 ring-gray-100 group-hover:ring-blue-200 transition-all"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center ring-2 ring-gray-100 group-hover:ring-blue-200 transition-all">
          <User size={20} className="text-gray-400" />
        </div>
      )}
      <span className="text-xs font-medium text-gray-700 text-center leading-tight truncate w-full">
        {athlete.name}
      </span>
      {athlete.weight_class && (
        <span className="text-[10px] text-gray-400 leading-none">{athlete.weight_class}</span>
      )}
    </button>
  );
}
