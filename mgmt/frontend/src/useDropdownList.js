import { useState, useEffect } from 'react';
import { api } from './api.js';
import { isTruthyFlag } from './flags.js';

let cache = null; // { Category: [...], 'Payment Mode': [...], 'Loan Status': [...], Village: [...] }
let inflight = null;

async function loadAll(force) {
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;
  inflight = api.getAllDropdownLists().then(data => { cache = data; inflight = null; return data; });
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
