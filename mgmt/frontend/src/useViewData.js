import { useEffect, useState, useCallback, useRef } from 'react';
import { getCached, setCached } from './cache.js';

export function useViewData(key, fetcher, deps = []) {
  const [data, setData] = useState(() => getCached(key));
  const [loading, setLoading] = useState(() => getCached(key) === undefined);
  const [error, setError] = useState('');

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

  const list = Array.isArray(data) ? data : [];

  useEffect(() => { load(false); }, deps);

  return { data, list, loading, error, refresh: () => load(true) };
}
