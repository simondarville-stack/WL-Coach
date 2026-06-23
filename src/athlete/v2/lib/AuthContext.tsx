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
 *
 * Programme codes: a coach can put an `access_code` on an athlete or a group.
 * When set, selecting that programme (from the picker OR via a share/personal
 * link) parks it in `pending` and the app shows the ProgrammeGate until the
 * viewer types the code. See lib/programmeGate.ts. Open programmes (no code)
 * behave exactly as before. Deterrence only — still anon key, no RLS.
 */
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Athlete, TrainingGroup } from '../../../lib/database.types';
import {
  isProgrammeLocked,
  isUnlocked,
  markUnlocked,
  codeMatches,
  clearAllUnlocks,
} from './programmeGate';

/**
 * A programme selection waiting on its access code. `locked` mirrors the
 * group-session lock: true when reached via a share/personal link (no path
 * back to the picker), false when chosen from the picker.
 */
type PendingGate =
  | { kind: 'athlete'; athlete: Athlete; locked: boolean }
  | { kind: 'group'; group: TrainingGroup; locked: boolean };

interface AuthState {
  athlete: Athlete | null;
  group: TrainingGroup | null;
  mode: 'athlete' | 'group' | null;
  athletes: Athlete[];
  groups: TrainingGroup[];
  loading: boolean;
  /**
   * True when the current group session was entered via a share link
   * (/athlete/g/<token>) or an athlete via a personal link (/athlete/a/<id>).
   * In locked mode the kiosk hides the "Switch" path back to the picker, so a
   * viewer can't browse into other athletes' data. Sticky across reloads
   * (persisted) until `signOut`/`?reset`.
   */
  locked: boolean;
  /** Set when a share/personal link's token doesn't resolve. */
  tokenError: string | null;
  /** A code-protected programme awaiting its access code, else null. */
  pending: PendingGate | null;
  selectAthlete: (a: Athlete) => void;
  selectGroup: (g: TrainingGroup) => void;
  /** Verify a code against the pending programme; commits + unlocks on match. */
  submitGateCode: (code: string) => boolean;
  /** Abandon the pending gate and return to the picker (picker-origin only). */
  cancelGate: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = 'emos_athlete_id';
const GROUP_STORAGE_KEY = 'emos_group_id';
const LOCK_STORAGE_KEY = 'emos_group_locked';
const LEGACY_STORAGE_KEY = 'winwota_athlete_id';

/** Match a group share link /athlete/g/<token>; captures the token (group id). */
const SHARE_LINK_RE = /\/athlete\/g\/([^/?#]+)/;
/** Match a personal athlete link /athlete/a/<id>; captures the athlete id. */
const ATHLETE_LINK_RE = /\/athlete\/a\/([^/?#]+)/;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [group, setGroup] = useState<TrainingGroup | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<TrainingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingGate | null>(null);

  // --- commit helpers: the single place that persists a selection ---

  const commitAthlete = useCallback((a: Athlete, lock: boolean) => {
    localStorage.setItem(STORAGE_KEY, a.id);
    localStorage.removeItem(GROUP_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (lock) localStorage.setItem(LOCK_STORAGE_KEY, '1');
    else localStorage.removeItem(LOCK_STORAGE_KEY);
    setAthlete(a);
    setGroup(null);
    setLocked(lock);
    setPending(null);
  }, []);

  const commitGroup = useCallback((g: TrainingGroup, lock: boolean) => {
    localStorage.setItem(GROUP_STORAGE_KEY, g.id);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (lock) localStorage.setItem(LOCK_STORAGE_KEY, '1');
    else localStorage.removeItem(LOCK_STORAGE_KEY);
    setGroup(g);
    setAthlete(null);
    setLocked(lock);
    setPending(null);
  }, []);

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

      // Dev escape hatch: /athlete?reset clears any saved selection, lock, and
      // remembered code unlocks so the picker shows again. Athletes never use
      // this; it keeps local testing friction-free after following a link.
      if (url.searchParams.has('reset')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        localStorage.removeItem(GROUP_STORAGE_KEY);
        localStorage.removeItem(LOCK_STORAGE_KEY);
        clearAllUnlocks();
        setLoading(false);
        return;
      }

      // Personal athlete link: /athlete/a/<id>. The token is the athlete id (an
      // unguessable UUID) — a soft capability link. It drops the viewer onto
      // that athlete and locks the kiosk. If the athlete carries an access
      // code that this browser hasn't cleared, park it on the gate first.
      const athleteMatch = url.pathname.match(ATHLETE_LINK_RE);
      if (athleteMatch) {
        const id = decodeURIComponent(athleteMatch[1]);
        const found = athletesList.find(a => a.id === id);
        if (found) {
          if (isProgrammeLocked(found) && !isUnlocked('athlete', found)) {
            setPending({ kind: 'athlete', athlete: found, locked: true });
          } else {
            commitAthlete(found, true);
          }
        } else {
          setTokenError('This athlete link is invalid or no longer available.');
        }
        setLoading(false);
        return;
      }

      // Group share link: /athlete/g/<token>. The token is the group id (an
      // unguessable UUID). Drops the viewer into the group's read-only plan and
      // locks the kiosk. A code-protected group parks on the gate first.
      const shareMatch = url.pathname.match(SHARE_LINK_RE);
      if (shareMatch) {
        const token = decodeURIComponent(shareMatch[1]);
        const shared = groupsList.find(g => g.id === token);
        if (shared) {
          if (isProgrammeLocked(shared) && !isUnlocked('group', shared)) {
            setPending({ kind: 'group', group: shared, locked: true });
          } else {
            commitGroup(shared, true);
          }
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
      // or strips the token from the URL still can't reach the picker. If the
      // coach rotated the code since, re-gate it.
      if (savedLock && savedGroupId) {
        const saved = groupsList.find(g => g.id === savedGroupId);
        if (saved) {
          if (isProgrammeLocked(saved) && !isUnlocked('group', saved)) {
            setPending({ kind: 'group', group: saved, locked: true });
          } else {
            setGroup(saved);
            setLocked(true);
          }
          setLoading(false);
          return;
        }
      }

      // Athlete selection wins if both happen to be persisted; the picker
      // only ever sets one at a time so this is defensive. Re-gate if the
      // code was rotated (or the unlock was cleared) since this browser last
      // entered — but keep it picker-origin (unlocked) so cancel works.
      if (savedAthleteId) {
        const saved = athletesList.find(a => a.id === savedAthleteId);
        if (saved) {
          if (isProgrammeLocked(saved) && !isUnlocked('athlete', saved)) {
            setPending({ kind: 'athlete', athlete: saved, locked: savedLock });
          } else {
            setAthlete(saved);
            setLocked(savedLock);
          }
        }
      } else if (savedGroupId) {
        const saved = groupsList.find(g => g.id === savedGroupId);
        if (saved) {
          if (isProgrammeLocked(saved) && !isUnlocked('group', saved)) {
            setPending({ kind: 'group', group: saved, locked: savedLock });
          } else {
            setGroup(saved);
            setLocked(savedLock);
          }
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [commitAthlete, commitGroup]);

  const selectAthlete = useCallback((a: Athlete) => {
    // Picker-origin selection: never locked. Code-protected athletes park on
    // the gate; open athletes commit straight through.
    if (isProgrammeLocked(a) && !isUnlocked('athlete', a)) {
      setPending({ kind: 'athlete', athlete: a, locked: false });
      return;
    }
    commitAthlete(a, false);
  }, [commitAthlete]);

  const selectGroup = useCallback((g: TrainingGroup) => {
    // Picker-driven group selection is never locked — it's only reachable
    // from an unlocked session anyway. Share links lock via the init effect.
    if (isProgrammeLocked(g) && !isUnlocked('group', g)) {
      setPending({ kind: 'group', group: g, locked: false });
      return;
    }
    commitGroup(g, false);
  }, [commitGroup]);

  const submitGateCode = useCallback((code: string): boolean => {
    if (!pending) return false;
    const entity = pending.kind === 'athlete' ? pending.athlete : pending.group;
    if (!codeMatches(entity, code)) return false;
    markUnlocked(pending.kind, entity);
    if (pending.kind === 'athlete') commitAthlete(pending.athlete, pending.locked);
    else commitGroup(pending.group, pending.locked);
    return true;
  }, [pending, commitAthlete, commitGroup]);

  const cancelGate = useCallback(() => {
    // Only offered for picker-origin gates; clears the parked selection so the
    // picker shows again. Does not touch any saved selection.
    setPending(null);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(GROUP_STORAGE_KEY);
    localStorage.removeItem(LOCK_STORAGE_KEY);
    setAthlete(null);
    setGroup(null);
    setLocked(false);
    setPending(null);
  }, []);

  const mode: AuthState['mode'] = athlete ? 'athlete' : group ? 'group' : null;

  return (
    <AuthContext.Provider value={{ athlete, group, mode, athletes, groups, loading, locked, tokenError, pending, selectAthlete, selectGroup, submitGateCode, cancelGate, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
