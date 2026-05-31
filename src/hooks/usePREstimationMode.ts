/**
 * usePREstimationMode — coach-local preference for how PR cells without
 * a real entry are estimated. Persists in localStorage so the choice
 * survives reloads but isn't synced across coaches (deliberate: this is
 * a personal analytical preference, not data).
 *
 * If you want to promote this to a per-coach Supabase setting later, the
 * surface is small: add a column to general_settings, read/write it
 * alongside the localStorage value, and the consumers don't change.
 */
import { useEffect, useState } from 'react';
import type { PREstimationMode } from '../lib/prTable';

const STORAGE_KEY = 'emos:pr_estimation_mode';

function read(): PREstimationMode {
  if (typeof localStorage === 'undefined') return 'weighted';
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'one_rm_only' ? 'one_rm_only' : 'weighted';
}

export function usePREstimationMode(): [PREstimationMode, (m: PREstimationMode) => void] {
  const [mode, setMode] = useState<PREstimationMode>(read);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return [mode, setMode];
}
