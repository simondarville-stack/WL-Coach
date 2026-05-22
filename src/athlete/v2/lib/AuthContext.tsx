/**
 * AuthContext — localStorage-backed athlete/group picker.
 *
 * Real auth is deferred to a later phase. For now the app stores either
 * the selected athlete id OR the selected group id in localStorage and
 * reads the row from Supabase.
 *
 * Mode model:
 *   - 'athlete' = full app (Today / Week / Profile, logging enabled)
 *   - 'group'   = read-only group plan viewer (no logging)
 *   - null      = no profile chosen yet → ProfilePicker shows
 */
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Athlete, TrainingGroup } from '../../../lib/database.types';

interface AuthState {
  athlete: Athlete | null;
  group: TrainingGroup | null;
  mode: 'athlete' | 'group' | null;
  athletes: Athlete[];
  groups: TrainingGroup[];
  loading: boolean;
  selectAthlete: (a: Athlete) => void;
  selectGroup: (g: TrainingGroup) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = 'emos_athlete_id';
const GROUP_STORAGE_KEY = 'emos_group_id';
const LEGACY_STORAGE_KEY = 'winwota_athlete_id';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [group, setGroup] = useState<TrainingGroup | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<TrainingGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [athletesResult, groupsResult] = await Promise.all([
        supabase
          .from('athletes')
          .select('*')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('training_groups')
          .select('*')
          .order('name'),
      ]);
      if (cancelled) return;
      const athletesList = (athletesResult.data ?? []) as Athlete[];
      const groupsList = (groupsResult.data ?? []) as TrainingGroup[];
      setAthletes(athletesList);
      setGroups(groupsList);

      const savedAthleteId =
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      const savedGroupId = localStorage.getItem(GROUP_STORAGE_KEY);
      // Athlete selection wins if both happen to be persisted; the picker
      // only ever sets one at a time so this is defensive.
      if (savedAthleteId) {
        const saved = athletesList.find(a => a.id === savedAthleteId);
        if (saved) setAthlete(saved);
      } else if (savedGroupId) {
        const saved = groupsList.find(g => g.id === savedGroupId);
        if (saved) setGroup(saved);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const selectAthlete = useCallback((a: Athlete) => {
    localStorage.setItem(STORAGE_KEY, a.id);
    localStorage.removeItem(GROUP_STORAGE_KEY);
    setAthlete(a);
    setGroup(null);
  }, []);

  const selectGroup = useCallback((g: TrainingGroup) => {
    localStorage.setItem(GROUP_STORAGE_KEY, g.id);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    setGroup(g);
    setAthlete(null);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(GROUP_STORAGE_KEY);
    setAthlete(null);
    setGroup(null);
  }, []);

  const mode: AuthState['mode'] = athlete ? 'athlete' : group ? 'group' : null;

  return (
    <AuthContext.Provider value={{ athlete, group, mode, athletes, groups, loading, selectAthlete, selectGroup, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
