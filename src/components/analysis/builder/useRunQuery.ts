// Runs an AnalysisQuery through the service boundary with debounce + stale-
// response guarding. The component never aggregates — it consumes the
// AnalysisResult this hook returns (invariant #6).

import { useEffect, useRef, useState } from 'react';
import { runAnalysisQuery } from '../../../lib/analysis';
import type { AnalysisQuery, AnalysisResult } from '../../../lib/analysis';

interface RunState {
  result: AnalysisResult | null;
  loading: boolean;
  error: string | null;
}

export function useRunQuery(query: AnalysisQuery, enabled: boolean, debounceMs = 250): RunState {
  const [state, setState] = useState<RunState>({ result: null, loading: false, error: null });
  const reqId = useRef(0);
  const key = JSON.stringify(query);

  useEffect(() => {
    if (!enabled) {
      setState({ result: null, loading: false, error: null });
      return;
    }
    const id = ++reqId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(() => {
      runAnalysisQuery(query)
        .then((result) => {
          if (id === reqId.current) setState({ result, loading: false, error: null });
        })
        .catch((e) => {
          if (id === reqId.current) {
            setState({ result: null, loading: false, error: e instanceof Error ? e.message : String(e) });
          }
        });
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, debounceMs]);

  return state;
}
