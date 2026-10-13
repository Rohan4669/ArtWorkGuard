import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from './api/client.js';

/** Loads data on mount / when deps change. Ignores results from superseded requests. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try { const data = await fn(); if (mine === seq.current) setState({ data, error: null, loading: false }); }
    catch (e) { if (mine === seq.current) setState((s) => ({ data: silent ? s.data : null, error: toApiError(e), loading: false })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}
