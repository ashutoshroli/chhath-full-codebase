import { useEffect, useState, useCallback, useRef } from 'react';
import { getCached, setCached } from './cache.js';

// Fetches `fetcher()` lazily, only for the active view, cached by `key`.
// call refresh() after a save/edit/delete to bust this view's cache and refetch.
export function useViewData(key, fetcher, deps = []) {
  const [data, setData] = useState(() => getCached(key));
  // audit M-30/M-24: `useState(!getCached(key))` looked like an initialiser but the
  // ARGUMENT form is evaluated on every render, so this walked the cache map on each
  // one. The function form runs once, on mount, which is all that was ever intended.
  const [loading, setLoading] = useState(() => getCached(key) === undefined);
  const [error, setError] = useState('');

  // audit M-24 — two problems in the old body:
  //
  //   1. `load` was memoised on [key] but closes over `fetcher`. A fetcher that
  //      captures a changing prop (a year, a filter) stayed STALE until `key`
  //      changed. It happens to work today only because every call site puts the
  //      varying value into `key` as well — an invariant nothing enforces, and the
  //      failure mode is silently showing the previous year's data. `fetcherRef`
  //      keeps `load` stable (so `deps` still controls when it runs) while always
  //      calling the CURRENT fetcher.
  //
  //   2. `getCached(key)` was called three times per render, and the guard read
  //      `cached !== false` — a mystery condition, because `false` is not a
  //      sentinel this cache ever stores. `getCached` returns `undefined` for
  //      "absent"; that is the only check needed, and it means a legitimately
  //      cached `false`/`0`/`''` is no longer refetched every single time.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback((force) => {
    if (!force) {
      const cached = getCached(key);
      if (cached !== undefined) {
        setData(cached);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setError('');
    fetcherRef.current()
      .then(res => { setCached(key, res); setData(res); })
      .catch(err => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [key]);

  // Views do `(view.data || []).map(...)`, which blows up with
  // "(x.data || []).map is not a function" the moment the response is a truthy
  // NON-array (an error object, `{}`, or a bare value). The production log has
  // three of these (lockedYearsView, committeeAllView). `list` is always safe to
  // iterate; `data` is left untouched for the views that expect an object.
  const list = Array.isArray(data) ? data : [];

  useEffect(() => { load(false); }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, list, loading, error, refresh: () => load(true) };
}
