import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { Athlete } from '../../lib/database.types';

interface AuthState {
  athlete: Athlete | null;
  athletes: Athlete[];
  loading: boolean;
  selectAthlete: (a: Athlete) => void;
  signOut: () => Promise<void>;
  session: null;
  user: null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = 'winwota_athlete_id';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAthletes();
  }, []);

  async function loadAthletes() {
    const { data } = await supabase
      .from('athletes')
      .select('*')
      .eq('is_active', true)
      .order('name');

    const list = data || [];
    setAthletes(list);

    const savedId = localStorage.getItem(STORAGE_KEY);
    if (savedId) {
      const saved = list.find(a => a.id === savedId);
      if (saved) {
        setAthlete(saved);
      }
    }

    setLoading(false);
  }

  const selectAthlete = useCallback((a: Athlete) => {
    localStorage.setItem(STORAGE_KEY, a.id);
    setAthlete(a);
  }, []);

  async function signOut() {
    localStorage.removeItem(STORAGE_KEY);
    setAthlete(null);
  }

  const noop = async () => ({ error: null });

  return (
    <AuthContext.Provider value={{
      athlete,
      athletes,
      loading,
      selectAthlete,
      signOut,
      session: null,
      user: null,
      signIn: noop,
      signUp: noop,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
