/**
 * Svelte equivalent of the React `useViewData` hook (mgmt/frontend/src/useViewData.js).
 *
 * Returns a readable store of { data, list, loading, error } plus a `refresh()`
 * and `reload(force)` — same cache-first semantics: serve a fresh cached value
 * immediately, otherwise fetch, cache the result, and expose loading/error.
 */
import { writable, type Readable } from 'svelte/store';
import { getCached, setCached } from './cache';

export interface ViewState<T> {
  data: T | undefined;
  list: T extends unknown[] ? T : unknown[];
  loading: boolean;
  error: string;
}

export interface ViewData<T> extends Readable<ViewState<T>> {
  refresh: () => void;
  reload: (force?: boolean) => void;
}

export function createViewData<T = unknown>(key: string, fetcher: () => Promise<T>): ViewData<T> {
  const initial = getCached<T>(key);
  const toList = (d: unknown) => (Array.isArray(d) ? d : []) as ViewState<T>['list'];

  const { subscribe, set } = writable<ViewState<T>>({
    data: initial,
    list: toList(initial),
    loading: initial === undefined,
    error: ''
  });

  let current: ViewState<T> = {
    data: initial,
    list: toList(initial),
    loading: initial === undefined,
    error: ''
  };
  const update = (patch: Partial<ViewState<T>>) => {
    current = { ...current, ...patch };
    current.list = toList(current.data);
    set(current);
  };

  function load(force?: boolean) {
    if (!force) {
      const cached = getCached<T>(key);
      if (cached !== undefined) {
        update({ data: cached, loading: false, error: '' });
        return;
      }
    }
    update({ loading: true, error: '' });
    fetcher()
      .then((res) => {
        setCached(key, res);
        update({ data: res });
      })
      .catch((err: Error) => update({ error: err.message || 'Failed to load' }))
      .finally(() => update({ loading: false }));
  }

  // initial fetch (cache-first)
  load(false);

  return {
    subscribe,
    refresh: () => load(true),
    reload: (force?: boolean) => load(force)
  };
}
