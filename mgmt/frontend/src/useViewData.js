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

  useEffect(() => { load(false); }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refresh: () => load(true) };
}
