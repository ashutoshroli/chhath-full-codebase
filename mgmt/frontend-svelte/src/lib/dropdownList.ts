// Ported from mgmt/frontend/src/useDropdownList.js — module-level cache of all
// dropdown lists + a Svelte-store accessor per list `type`. Same filtering
// (isTruthyFlag on Active) and hindiOf lookup.
import { writable, type Readable } from 'svelte/store';
import { api } from './api';
import { isTruthyFlag } from './flags';

type Row = Record<string, any>;
type AllLists = Record<string, Row[]>;

let cache: AllLists | null = null;
let inflight: Promise<AllLists> | null = null;

async function loadAll(force?: boolean): Promise<AllLists> {
  if (cache && !force) return cache;
  if (inflight) return inflight;
  inflight = (api.getAllDropdownLists() as Promise<AllLists>)
    .then((data) => {
      cache = data;
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateDropdownLists(): void {
  cache = null;
}

export interface DropdownList {
  subscribe: Readable<{ options: Row[]; loading: boolean }>['subscribe'];
  hindiOf: (englishValue: string) => string;
  refresh: () => Promise<void>;
  /** current active options (non-reactive snapshot) */
  current: () => Row[];
}

export function createDropdownList(type: string): DropdownList {
  const { subscribe, set } = writable<{ options: Row[]; loading: boolean }>({
    options: activeRows(cache, type),
    loading: !cache
  });

  let rows: Row[] = activeRows(cache, type);

  function apply(data: AllLists | null) {
    rows = activeRows(data, type);
    set({ options: rows, loading: false });
  }

  loadAll().then(apply);

  return {
    subscribe,
    hindiOf: (englishValue: string) => {
      const row = rows.find((r) => r['English Value'] === englishValue);
      return row ? row['Hindi Label'] : '';
    },
    refresh: () => loadAll(true).then(apply),
    current: () => rows
  };
}

function activeRows(data: AllLists | null, type: string): Row[] {
  return ((data && data[type]) || []).filter((r) => isTruthyFlag(r.Active));
}
