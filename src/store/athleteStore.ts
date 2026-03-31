import { create } from 'zustand';
import type { Athlete } from '../lib/database.types';

interface AthleteState {
  athletes: Athlete[];
  selectedAthlete: Athlete | null;
  setAthletes: (athletes: Athlete[]) => void;
  setSelectedAthlete: (athlete: Athlete | null) => void;
}

export const useAthleteStore = create<AthleteState>((set) => ({
  athletes: [],
  selectedAthlete: null,
  setAthletes: (athletes) => set({ athletes }),
  setSelectedAthlete: (selectedAthlete) => set({ selectedAthlete }),
}));
