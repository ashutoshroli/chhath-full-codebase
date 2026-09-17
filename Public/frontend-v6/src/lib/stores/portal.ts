/**
 * Central portal data store. One fetch, shared by every page. The selected
 * `year` store drives all year-scoped derivations. Loading state is exposed so
 * components can show skeletons / error / stale banners.
 */
import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { loadPortalData, type PortalResult, type PortalSource } from '$lib/api/client';
import { EMPTY_PORTAL_DATA, type PortalData } from '$lib/api/schema';
import { availableYears, ALL_YEARS, type YearSel } from '$lib/api/derive';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PortalState {
  status: LoadStatus;
  data: PortalData;
  stale: boolean;
  /** epoch ms of the NETWORK fetch this data came from (0 = never fetched). */
  savedAt: number;
  version: string;
  /** true only on a cold failure with no snapshot at all */
  failed: boolean;
  /** provenance — 'network' | 'snapshot' | 'empty' (audit PUB-FE-01). */
  source: PortalSource;
}

const initialState: PortalState = {
  // audit PR-42: 'loading', not 'idle'. Every consumer derives `loading = status === 'loading'`,
  // so with 'idle' the first render — and the PRERENDERED HTML that a crawler indexes — took the
  // ready branch with empty data and displayed a transparency portal reporting zero
  // contributions and no records. 'idle' stays in the union: verifyVerdict treats it as
  // "checking" and that defensive branch is still correct.
  status: 'loading',
  data: EMPTY_PORTAL_DATA,
  stale: false,
  savedAt: 0,
  version: '',
  failed: false,
  source: 'empty'
};

export const portalState = writable<PortalState>(initialState);

/** Selected year. Initialised lazily after first data load. */
export const year = writable<YearSel>(new Date().getFullYear());

export const years = derived(portalState, ($s) => availableYears($s.data));

let started = false;

/** Kick off (or force-refresh) the data load. Safe to call repeatedly. */
export async function initPortal(force = false): Promise<void> {
  if (!browser) return;
  if (started && !force) return;
  started = true;

  portalState.update((s) => ({ ...s, status: 'loading' }));

  const result: PortalResult = await loadPortalData({ force });
  const yrs = availableYears(result.data);
  // A cold failure: no snapshot, no rows — we have nothing to show and nothing to
  // check a record against. (A dead `const failed = … ? false : false` used to sit
  // here; it was always false and never used.)
  const cold = result.savedAt === 0 && (result.data.collections?.length ?? 0) === 0;

  portalState.set({
    status: cold ? 'error' : 'ready',
    data: result.data,
    // A saved copy is stale by definition, and the Worker can also flag its own
    // last-known-good payload as stale — either way the UI must be told.
    stale: result.stale || result.source === 'snapshot',
    savedAt: result.savedAt,
    version: result.version,
    failed: cold,
    source: result.source
  });

  // Choose a sensible default year on first successful load: newest available,
  // preferring the current calendar year if it exists in the data.
  const current = get(year);
  if (!yrs.includes(current as number) && current !== ALL_YEARS) {
    const nowYear = new Date().getFullYear();
    year.set(yrs.includes(nowYear) ? nowYear : yrs[0]);
  }
}

export async function refreshPortal(): Promise<void> {
  await initPortal(true);
}
