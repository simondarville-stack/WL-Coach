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
  /**
   * True when the current group session was entered via a share link
   * (/athlete/g/<token>). In locked mode the kiosk hides the "Switch" path
   * back to the picker, so a group member can't browse into other athletes'
   * data. Sticky across reloads (persisted) until `signOut`/`?reset`.
   */
  locked: boolean;
  /** Set when a share link's token doesn't resolve to a group. */
  tokenError: string | null;
  selectAthlete: (a: Athlete) => void;
  selectGroup: (g: TrainingGroup) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = 'emos_athlete_id';
const GROUP_STORAGE_KEY = 'emos_group_id';
const LOCK_STORAGE_KEY = 'emos_group_locked';
const LEGACY_STORAGE_KEY = 'winwota_athlete_id';

/** Match a share link of the form /athlete/g/<token>; captures the token. */
const SHARE_LINK_RE = /\/athlete\/g\/([^/?#]+)/;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [group, setGroup] = useState<TrainingGroup | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<TrainingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

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

      const url = new URL(window.location.href);

      // Dev escape hatch: /athlete?reset clears any saved selection + lock so
      // the picker shows again. Athletes never use this; it keeps local
      // testing friction-free after following a share link.
      if (url.searchParams.has('reset')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        localStorage.removeItem(GROUP_STORAGE_KEY);
        localStorage.removeItem(LOCK_STORAGE_KEY);
        setLoading(false);
        return;
      }

      // Share link: /athlete/g/<token>. The token is the group id (an
      // unguessable UUID) — a soft capability link, not real auth. It drops
      // the viewer straight into the group's read-only plan and locks the
      // kiosk so there's no path back to the picker / other profiles.
      const shareMatch = url.pathname.match(SHARE_LINK_RE);
      if (shareMatch) {
        const token = decodeURIComponent(shareMatch[1]);
        const shared = groupsList.find(g => g.id === token);
        if (shared) {
          localStorage.setItem(GROUP_STORAGE_KEY, shared.id);
          localStorage.setItem(LOCK_STORAGE_KEY, '1');
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(LEGACY_STORAGE_KEY);
          setGroup(shared);
          setLocked(true);
        } else {
          setTokenError('This group link is invalid or no longer available.');
        }
        setLoading(false);
        return;
      }

      const savedAthleteId =
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      const savedGroupId = localStorage.getItem(GROUP_STORAGE_KEY);
      const savedLock = localStorage.getItem(LOCK_STORAGE_KEY) === '1';

      // A locked group session (entered earlier via a share link) sticks
      // across reloads of bare /athlete, so a kiosk user who reopens the app
      // or strips the token from the URL still can't reach the picker.
      if (savedLock && savedGroupId) {
        const saved = groupsList.find(g => g.id === savedGroupId);
        if (saved) {
          setGroup(saved);
          setLocked(true);
          setLoading(false);
          return;
        }
      }

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
    localStorage.removeItem(LOCK_STORAGE_KEY);
    setAthlete(a);
    setGroup(null);
    setLocked(false);
  }, []);

  const selectGroup = useCallback((g: TrainingGroup) => {
    // Picker-driven group selection is never locked — it's only reachable
    // from an unlocked session anyway. Share links lock via the init effect.
    localStorage.setItem(GROUP_STORAGE_KEY, g.id);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(LOCK_STORAGE_KEY);
    setGroup(g);
    setAthlete(null);
    setLocked(false);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(GROUP_STORAGE_KEY);
    localStorage.removeItem(LOCK_STORAGE_KEY);
    setAthlete(null);
    setGroup(null);
    setLocked(false);
  }, []);

  const mode: AuthState['mode'] = athlete ? 'athlete' : group ? 'group' : null;

  return (
    <AuthContext.Provider value={{ athlete, group, mode, athletes, groups, loading, locked, tokenError, selectAthlete, selectGroup, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
