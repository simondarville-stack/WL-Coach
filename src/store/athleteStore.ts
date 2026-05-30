import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Athlete, TrainingGroup, CollaboratorRole } from '../lib/database.types';
import { getOwnerId } from '../lib/ownerContext';

/** Access classification per athlete from the active coach's perspective. */
export type AthleteAccess = 'owned' | CollaboratorRole;

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
  setSelectedAthlete: (selectedAthlete) => set({ selectedAthlete, selectedGroup: null }),
  setGroups: (groups) => set({ groups }),
  setSelectedGroup: (selectedGroup) => set({ selectedGroup, selectedAthlete: null }),

  fetchAthletes: async (force = false) => {
    const { athletesLoaded, athletesLoading } = get();
    if ((athletesLoaded && !force) || athletesLoading) return;
    set({ athletesLoading: true });
    try {
      const coachId = getOwnerId();

      // Owned and collaborator queries run in parallel. The collaborator
      // query returns (athlete_id, role) tuples; we hydrate the athlete
      // rows in a second round-trip below.
      const [ownedRes, collabRes] = await Promise.all([
        supabase
          .from('athletes')
          .select('*')
          .eq('owner_id', coachId)
          .order('is_active', { ascending: false })
          .order('name'),
        supabase
          .from('athlete_collaborators')
          .select('athlete_id, role')
          .eq('coach_id', coachId)
          .not('accepted_at', 'is', null)
          .is('revoked_at', null),
      ]);

      if (ownedRes.error) throw ownedRes.error;
      // Collaborator query is best-effort: if the table doesn't exist yet
      // (migration not applied) we just keep the owned set.
      const collabRows = collabRes.error ? [] : (collabRes.data ?? []);
      const sharedIds = collabRows.map(r => r.athlete_id as string);

      let sharedAthletes: Athlete[] = [];
      let hostNames: Record<string, string> = {};
      if (sharedIds.length > 0) {
        const sharedRes = await supabase
          .from('athletes')
          .select('*')
          .in('id', sharedIds)
          .order('is_active', { ascending: false })
          .order('name');
        if (!sharedRes.error) {
          sharedAthletes = (sharedRes.data ?? []) as Athlete[];

          // Resolve host display names so the UI can render "Shared by X".
          const hostIds = Array.from(new Set(sharedAthletes.map(a => a.owner_id)));
          const hostsRes = await supabase
            .from('coach_profiles')
            .select('id, name')
            .in('id', hostIds);
          if (!hostsRes.error && hostsRes.data) {
            const byId = new Map(hostsRes.data.map(r => [r.id as string, r.name as string]));
            hostNames = Object.fromEntries(
              sharedAthletes.map(a => [a.id, byId.get(a.owner_id) ?? 'another coach']),
            );
          }
        }
      }

      const owned = (ownedRes.data ?? []) as Athlete[];
      const access: Record<string, AthleteAccess> = {};
      for (const a of owned) access[a.id] = 'owned';
      for (const c of collabRows) access[c.athlete_id as string] = c.role as CollaboratorRole;

      // Deduplicate defensively — a self-collaboration row would be a bug
      // but should not produce two list entries for the same athlete.
      const seen = new Set<string>();
      const merged: Athlete[] = [];
      for (const a of [...owned, ...sharedAthletes]) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        merged.push(a);
      }

      set({
        athletes: merged,
        athleteAccess: access,
        athleteHostName: hostNames,
        athletesLoaded: true,
      });
    } finally {
      set({ athletesLoading: false });
    }
  },
}));
