// Public portal data for the chatbot — fetched from the SAME cached, versioned
// endpoints the public frontend uses, so D1 is never touched directly.
//
// STRATEGY (mirrors the frontend):
//   1. GET ?action=dataVersion   (tiny; edge-cache-friendly)
//   2. if the version matches what we already cached in memory -> reuse it (no
//      portalData fetch at all).
//   3. else GET ?action=portalData&v=<version>  (immutable edge-cached) and cache
//      it in memory keyed by version.
// So repeated chats read the in-memory cache; a real data change (version bump)
// triggers exactly one fresh fetch, then caches again. On a cold start the cache
// is empty and the first chat re-fetches — fine.

import { config } from '../config.js';

let _cache = null; // { version, data, fetchedAt }
const FETCH_TIMEOUT_MS = 12000;

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function currentVersion(base) {
  try {
    const v = await getJson(`${base}/?action=dataVersion`);
    // The endpoint returns something like { version: "..." } (or a bare value).
    return (v && (v.version || v.dataVersion || v.v)) ? String(v.version || v.dataVersion || v.v) : '';
  } catch (e) {
    return '';
  }
}

// Returns { version, data } where data is the raw portalData payload. Uses the
// in-memory cache when the version is unchanged.
export async function getPortalData() {
  const base = (config.publicApiBase || '').replace(/\/+$/, '');
  const version = await currentVersion(base);

  if (_cache && version && _cache.version === version) {
    return { version, data: _cache.data };
  }

  // Fetch fresh. Prefer the versioned (cached) URL; fall back to un-versioned.
  const url = version
    ? `${base}/?action=portalData&v=${encodeURIComponent(version)}`
    : `${base}/?action=portalData`;
  const data = await getJson(url);
  _cache = { version: version || 'unversioned', data, fetchedAt: Date.now() };
  return { version: _cache.version, data };
}

// For tests: reset the module cache.
export function _resetCache() { _cache = null; }

// ---- Trim the (large) portalData into a compact, public-safe summary ----------
// The model gets THIS, not the raw payload — keeps tokens small and guarantees no
// PII/OTP/token can leak (we only read known public fields). Shapes here are
// defensive: any missing field just yields '' / 0, never throws.

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const inr = (n) => `₹${Math.round(num(n)).toLocaleString('en-IN')}`;

export function summarizePortalData(data) {
  const d = data || {};
  const collections = Array.isArray(d.collections) ? d.collections : [];
  const expenses = Array.isArray(d.expenses) ? d.expenses : [];
  const loans = Array.isArray(d.loans) ? d.loans : [];
  const committee = Array.isArray(d.committee) ? d.committee : (Array.isArray(d.committeeMembers) ? d.committeeMembers : []);

  // Years present, newest first.
  const years = [...new Set(collections.map(c => parseInt(c.Year)).filter(Boolean))].sort((a, b) => b - a);
  const latestYear = years[0];

  const lines = [];
  lines.push('You are a helpful assistant for the Navyuvak Chhath Puja Samiti (Shaharpura & Gardih) public transparency portal.');
  lines.push('Answer ONLY from the data below. If a detail is not present, say you do not have that information. Amounts are in Indian Rupees.');
  lines.push(`Years with records: ${years.join(', ') || 'none'}.`);

  // Per-year totals (cap to the most recent ~6 years to bound tokens).
  for (const y of years.slice(0, 6)) {
    const cols = collections.filter(c => parseInt(c.Year) === y);
    const exps = expenses.filter(e => parseInt(e.Year) === y);
    const totalCol = cols.reduce((s, c) => s + num(c.Amount), 0);
    const totalExp = exps.reduce((s, e) => s + num(e.Amount), 0);
    lines.push(`Year ${y}: collections ${inr(totalCol)} from ${cols.length} entries; expenses ${inr(totalExp)}; net ${inr(totalCol - totalExp)}.`);
  }

  // Top contributors of the latest year (names are public on the portal already).
  if (latestYear) {
    const cur = collections.filter(c => parseInt(c.Year) === latestYear && !(c['Is Resell'] === 'TRUE' || c['Is Resell'] === true));
    const top = [...cur].sort((a, b) => num(b.Amount) - num(a.Amount)).slice(0, 10)
      .map(c => `${(c.Name || '').toString()} (${inr(c.Amount)})`);
    if (top.length) lines.push(`Top contributors ${latestYear}: ${top.join(', ')}.`);
  }

  // Committee (public list).
  if (committee.length) {
    const names = committee.slice(0, 40).map(m => (m.Name || m.name || '').toString()).filter(Boolean);
    lines.push(`Committee members (${committee.length}): ${names.join(', ')}.`);
  }

  // Loans summary (counts + totals only — no borrower PII beyond public name).
  if (loans.length) {
    const totalLoan = loans.reduce((s, l) => s + num(l.Amount), 0);
    lines.push(`Loans on record: ${loans.length}, total principal ${inr(totalLoan)}.`);
  }

  return lines.join('\n');
}
