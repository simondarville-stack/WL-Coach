import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Athlete, TrainingGroup } from '../lib/database.types';
import { getOwnerId } from '../lib/ownerContext';

interface AthleteState {
  athletes: Athlete[];
  athletesLoaded: boolean;
  athletesLoading: boolean;
  selectedAthlete: Athlete | null;
  groups: TrainingGroup[];
  selectedGroup: TrainingGroup | null;
  setAthletes: (athletes: Athlete[]) => void;
  setSelectedAthlete: (athlete: Athlete | null) => void;
  setGroups: (groups: TrainingGroup[]) => void;
  setSelectedGroup: (group: TrainingGroup | null) => void;
  /** Fetch all athletes for this owner; no-ops on subsequent calls unless forced. */
  fetchAthletes: (force?: boolean) => Promise<void>;
}

export const useAthleteStore = create<AthleteState>((set, get) => ({
  athletes: [],
  athletesLoaded: false,
  athletesLoading: false,
  selectedAthlete: null,
  groups: [],
  selectedGroup: null,
  setAthletes: (athletes) => set({ athletes }),
  setSelectedAthlete: (selectedAthlete) => set({ selectedAthlete, selectedGroup: null }),
  setGroups: (groups) => set({ groups }),
  setSelectedGroup: (selectedGroup) => set({ selectedGroup, selectedAthlete: null }),

  fetchAthletes: async (force = false) => {
    const { athletesLoaded, athletesLoading } = get();
    if ((athletesLoaded && !force) || athletesLoading) return;
    set({ athletesLoading: true });
    try {
      const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .eq('owner_id', getOwnerId())
        .order('is_active', { ascending: false })
        .order('name');
      if (error) throw error;
      set({ athletes: data || [], athletesLoaded: true });
    } finally {
      set({ athletesLoading: false });
    }
  },
}));
