import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CoachProfile } from '../lib/database.types';

interface CoachState {
  activeCoach: CoachProfile | null;
  coaches: CoachProfile[];
  setActiveCoach: (coach: CoachProfile) => void;
  setCoaches: (coaches: CoachProfile[]) => void;
}

export const useCoachStore = create<CoachState>()(
  persist(
    (set) => ({
      activeCoach: null,
      coaches: [],
      setActiveCoach: (activeCoach) => set({ activeCoach }),
      setCoaches: (coaches) => set({ coaches }),
    }),
    {
      name: 'emos-coach',  // localStorage key
    }
  )
);
