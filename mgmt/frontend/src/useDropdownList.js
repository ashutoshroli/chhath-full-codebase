import { useState, useEffect } from 'react';
import { api } from './api.js';
import { isTruthyFlag } from './flags.js';

let cache = null; // { Category: [...], 'Payment Mode': [...], 'Loan Status': [...], Village: [...] }
let inflight = null;

// audit M-29 — `inflight` was never cleared on failure, and a forced reload
// overwrote it while the previous request was still running.
//
//   * On a REJECTED request the old code left the failed promise in `inflight`
//     for ever, so every later caller re-awaited the same rejection. One network
//     blip and every dropdown in the portal stayed empty until a full page reload,
//     with retries doing nothing.
//   * `force` overwrote `inflight` without settling the previous one, so two
//     concurrent loads raced to assign `cache` and the loser's result won if it
//     landed second — the classic last-writer-wins staleness.
//
// Now: `inflight` is cleared in both outcomes, and a forced load reuses an
// already-running request rather than starting a second one.
async function loadAll(force) {
  if (cache && !force) return cache;
  if (inflight) return inflight; // a request is already running — join it, don't add another
  inflight = api.getAllDropdownLists()
    .then(data => { cache = data; return data; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function invalidateDropdownLists() { cache = null; }

// type: 'Category' | 'Payment Mode' | 'Loan Status' | 'Village'
// Returns { options, hindiOf, loading } — options = active rows [{'English Value','Hindi Label',...}]
export function useDropdownList(type) {
  const [data, setData] = useState(cache);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let alive = true;
    loadAll().then(d => { if (alive) { setData(d); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const rows = ((data && data[type]) || []).filter(r => isTruthyFlag(r.Active));
  const hindiOf = (englishValue) => {
    const row = rows.find(r => r['English Value'] === englishValue);
    return row ? row['Hindi Label'] : '';
  };
  const refresh = () => loadAll(true).then(d => setData(d));

  return { options: rows, hindiOf, loading, refresh };
}
