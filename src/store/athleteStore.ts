import { create } from 'zustand';
import type { Athlete, TrainingGroup } from '../lib/database.types';

interface AthleteState {
  athletes: Athlete[];
  selectedAthlete: Athlete | null;
  groups: TrainingGroup[];
  selectedGroup: TrainingGroup | null;
  setAthletes: (athletes: Athlete[]) => void;
  setSelectedAthlete: (athlete: Athlete | null) => void;
  setGroups: (groups: TrainingGroup[]) => void;
  setSelectedGroup: (group: TrainingGroup | null) => void;
}

export const useAthleteStore = create<AthleteState>((set) => ({
  athletes: [],
  selectedAthlete: null,
  groups: [],
  selectedGroup: null,
  setAthletes: (athletes) => set({ athletes }),
  setSelectedAthlete: (selectedAthlete) => set({ selectedAthlete, selectedGroup: null }),
  setGroups: (groups) => set({ groups }),
  setSelectedGroup: (selectedGroup) => set({ selectedGroup, selectedAthlete: null }),
}));
