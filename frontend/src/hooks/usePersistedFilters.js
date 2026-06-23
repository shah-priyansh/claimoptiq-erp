import { useEffect, useRef, useState } from 'react';

// useState-like hook that mirrors its value into sessionStorage under `key`
// so the user's filter selections survive navigating away to a detail page
// and back. Scoped to sessionStorage (not localStorage) so different tabs
// keep their own state and a fresh app launch starts clean.
//
// usage:
//   const [filters, setFilters] = usePersistedFilters('claims:filters', {
//     hospital: '', status: '', dateFrom: '', dateTo: '',
//   });
export default function usePersistedFilters(key, defaults) {
  const [state, setState] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === null) return defaults;
      const parsed = JSON.parse(raw);
      // Merge with defaults for objects so a newly-added field doesn't trip
      // the UI when an older session payload is still around. Primitives /
      // arrays are returned as-is.
      const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
      if (isPlainObj(defaults) && isPlainObj(parsed)) return { ...defaults, ...parsed };
      return parsed;
    } catch {
      return defaults;
    }
  });

  // Avoid the redundant write that fires on the first render. Without this
  // guard React StrictMode (which double-invokes effects) and our defaults
  // can clobber filters that were just rehydrated.
  const skipFirst = useRef(true);
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return; }
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);

  return [state, setState];
}

// Helper to clear a persisted filter bucket — handy when an action like
// "Clear filters" should also wipe what we previously remembered.
export function clearPersistedFilters(key) {
  try { sessionStorage.removeItem(key); } catch {}
}
