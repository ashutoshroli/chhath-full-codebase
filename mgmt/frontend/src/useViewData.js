import { useEffect, useState, useCallback } from 'react';
import { getCached, setCached } from './cache.js';

// Fetches `fetcher()` lazily, only for the active view, cached by `key`.
// call refresh() after a save/edit/delete to bust this view's cache and refetch.
export function useViewData(key, fetcher, deps = []) {
  const [data, setData] = useState(() => getCached(key));
  const [loading, setLoading] = useState(!getCached(key));
  const [error, setError] = useState('');

  const load = useCallback((force) => {
    const cached = !force && getCached(key);
    if (cached !== undefined && cached !== false) {
      setData(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    fetcher()
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
