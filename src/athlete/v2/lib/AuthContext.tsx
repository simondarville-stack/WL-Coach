/**
 * AuthContext — localStorage-backed athlete picker.
 *
 * Real auth is deferred to a later phase. For now the athlete app stores
 * the selected athlete id in localStorage and reads the row from Supabase.
 */
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Athlete } from '../../../lib/database.types';

interface AuthState {
  athlete: Athlete | null;
  athletes: Athlete[];
  loading: boolean;
  selectAthlete: (a: Athlete) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = 'emos_athlete_id';
const LEGACY_STORAGE_KEY = 'winwota_athlete_id';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('athletes')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (cancelled) return;
      const list = (data ?? []) as Athlete[];
      setAthletes(list);

      const savedId =
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (savedId) {
        const saved = list.find(a => a.id === savedId);
        if (saved) setAthlete(saved);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const selectAthlete = useCallback((a: Athlete) => {
    localStorage.setItem(STORAGE_KEY, a.id);
    setAthlete(a);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    setAthlete(null);
  }, []);

  return (
    <AuthContext.Provider value={{ athlete, athletes, loading, selectAthlete, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
