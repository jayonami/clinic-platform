import { useCallback, useEffect, useRef, useState } from 'react';
import { tokens } from './api.js';

/* One shared EventSource tells every open screen when something changed. */
const listeners = new Set();
let source = null;
function ensureSource() {
  if (source || !tokens.get('staff') || typeof EventSource === 'undefined') return;
  source = new EventSource(`/api/events?token=${encodeURIComponent(tokens.get('staff'))}`);
  source.addEventListener('changed', () => listeners.forEach((fn) => fn()));
  source.onerror = () => {
    // let the browser retry; drop the handle if the session ended
    if (!tokens.get('staff')) closeLive();
  };
}
export function closeLive() {
  source?.close();
  source = null;
}
export function useLiveRefresh(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ensureSource();
    let t;
    const cb = () => { clearTimeout(t); t = setTimeout(() => ref.current(), 150); };
    listeners.add(cb);
    const onVis = () => document.visibilityState === 'visible' && cb();
    document.addEventListener('visibilitychange', onVis);
    return () => { listeners.delete(cb); clearTimeout(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
}

/** Load data, reload on demand and (optionally) whenever the server announces a change. */
export function useLoad(fetcher, deps = [], { live = false } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const load = useCallback(async (silent = true) => {
    const id = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetcherRef.current();
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(false); }, deps);
  useLiveRefresh(() => { if (live) load(true); });
  return { ...state, reload: () => load(true), setData: (data) => setState((s) => ({ ...s, data })) };
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Re-render every `ms` so "6m" waiting badges keep counting. */
export function useTick(ms = 30000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return Date.now();
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  }, []);
  return [busy, run];
}

export function useClickOutside(ref, fn) {
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && fn();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, fn]);
}
