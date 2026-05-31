import { create } from 'zustand';
import type { Athlete, TrainingGroup } from '../lib/database.types';
import { getOwnerId } from '../lib/ownerContext';
import { fetchAccessibleAthletes, type AccessRole } from '../lib/accessScope';

/** Access classification per athlete from the active coach's perspective. */
export type AthleteAccess = AccessRole;

interface AthleteState {
  athletes: Athlete[];
  athletesLoaded: boolean;
  athletesLoading: boolean;
  /** Map from athlete id → how the active coach can access them. Athletes
   *  not in the map should not appear in `athletes`; the map is the
   *  authoritative source for UI badges and edit-permission gating. */
  athleteAccess: Record<string, AthleteAccess>;
  /** Map from athlete id → host coach's display name, populated for
   *  shared athletes so the UI can render "Shared by Coach Jensen". */
  athleteHostName: Record<string, string>;
  selectedAthlete: Athlete | null;
  groups: TrainingGroup[];
  selectedGroup: TrainingGroup | null;
  setAthletes: (athletes: Athlete[]) => void;
  /** Replace the athlete list AND its access/host metadata together, so a
   *  hook-level fetch (planner, events) doesn't strand a stale access map. */
  setAthletesWithAccess: (payload: {
    athletes: Athlete[];
    accessById: Record<string, AthleteAccess>;
    hostNameById: Record<string, string>;
  }) => void;
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
  athleteAccess: {},
  athleteHostName: {},
  selectedAthlete: null,
  groups: [],
  selectedGroup: null,
  setAthletes: (athletes) => set({ athletes }),
  setAthletesWithAccess: ({ athletes, accessById, hostNameById }) =>
    set({ athletes, athleteAccess: accessById, athleteHostName: hostNameById, athletesLoaded: true }),
  setSelectedAthlete: (selectedAthlete) => set({ selectedAthlete, selectedGroup: null }),
  setGroups: (groups) => set({ groups }),
  setSelectedGroup: (selectedGroup) => set({ selectedGroup, selectedAthlete: null }),

  fetchAthletes: async (force = false) => {
    const { athletesLoaded, athletesLoading } = get();
    if ((athletesLoaded && !force) || athletesLoading) return;
    set({ athletesLoading: true });
    try {
      const { athletes, accessById, hostNameById } = await fetchAccessibleAthletes(getOwnerId());
      set({
        athletes,
        athleteAccess: accessById,
        athleteHostName: hostNameById,
        athletesLoaded: true,
      });
    } finally {
      set({ athletesLoading: false });
    }
  },
}));
