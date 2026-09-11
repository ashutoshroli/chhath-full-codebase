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

const SUMMARY_MAX_CHARS = 6000; // hard cap so the prompt can never blow the model's input

export function summarizePortalData(data, question) {
  const d = data || {};
  const collections = Array.isArray(d.collections) ? d.collections : [];
  const expenses = Array.isArray(d.expenses) ? d.expenses : [];
  const loans = Array.isArray(d.loans) ? d.loans : [];
  const committee = Array.isArray(d.committee) ? d.committee : (Array.isArray(d.committeeMembers) ? d.committeeMembers : []);
  const users = Array.isArray(d.users) ? d.users : [];

  // A contribution row's `Name` is the person's ID code (e.g. USER0001), NOT the
  // display name — the real name lives in `users` keyed by `ID` (same as the
  // public frontend's getUser()). Build ID -> real name so we can match and show
  // human names. Fall back to the raw value if it isn't an ID.
  const nameOf = buildNameResolver(users);

  // Years present, newest first.
  const years = [...new Set(collections.map(c => parseInt(c.Year)).filter(Boolean))].sort((a, b) => b - a);
  const latestYear = years[0];

  const lines = [];
  lines.push('You are the friendly assistant of the Navyuvak Chhath Puja Samiti (Shaharpura & Gardih). Below is the committee\'s public data.');
  lines.push('Answer the user\'s question using this data. You MAY add up amounts, count entries, and summarise across years to answer. Amounts are in Indian Rupees (₹).');
  lines.push('If the specific PERSON DETAILS block for a named person is present below, use it to answer about that person — their yearly amounts, total, and any download links for their receipts/certificates.');
  lines.push('Only say you do not have the information if the answer genuinely is not in the data below. Reply briefly and clearly.');
  lines.push(`Years with records: ${years.join(', ') || 'none'}.`);

  // Per-year totals (cap to the most recent ~6 years to bound tokens).
  for (const y of years.slice(0, 6)) {
    const cols = collections.filter(c => parseInt(c.Year) === y);
    const exps = expenses.filter(e => parseInt(e.Year) === y);
    const totalCol = cols.reduce((s, c) => s + num(c.Amount), 0);
    const totalExp = exps.reduce((s, e) => s + num(e.Amount), 0);
    lines.push(`Year ${y}: collections ${inr(totalCol)} from ${cols.length} entries; expenses ${inr(totalExp)}; net ${inr(totalCol - totalExp)}.`);
  }

  // Top contributors PER YEAR — aggregated per PERSON (so someone with several
  // entries appears ONCE with their combined total, never duplicated), real names,
  // for each of the most recent ~6 years. Public info (shown on the portal).
  for (const y of years.slice(0, 6)) {
    const totals = new Map(); // realName -> summed amount for the year
    for (const c of collections) {
      if (parseInt(c.Year) !== y) continue;
      if (c['Is Resell'] === 'TRUE' || c['Is Resell'] === true) continue;
      const nm = nameOf(c.Name);
      if (!nm) continue;
      totals.set(nm, (totals.get(nm) || 0) + num(c.Amount));
    }
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([nm, amt]) => `${nm} (${inr(amt)})`);
    if (top.length) lines.push(`Top contributors ${y}: ${top.join(', ')}.`);
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

  // PER-PERSON lookup: if the question names contributor(s) present in the data,
  // add ONLY their specific rows so a question like "how much did X give?" is
  // answerable without dumping every record. Bounded to keep the prompt small.
  const generatedFiles = Array.isArray(d.generatedFiles) ? d.generatedFiles : [];
  const personBlock = personContributionsFor(question, collections, nameOf, generatedFiles);
  if (personBlock) lines.push(personBlock);

  let out = lines.join('\n');
  // Hard cap: never send an oversized prompt (a huge dataset was producing
  // Model HTTP 500). Trim from the end (per-year + person detail survive; the
  // long committee-name list is what gets cut first if anything).
  if (out.length > SUMMARY_MAX_CHARS) out = out.slice(0, SUMMARY_MAX_CHARS) + '\n…(data truncated)';
  return out;
}

// Build a resolver: a collection row's `Name` is a person ID (e.g. USER0001); the
// real display name lives in `users` keyed by `ID` (mirrors the frontend's
// getUser()). Also prefer the Hindi name only if the English is blank. Returns a
// function id -> real name (falls back to the raw value if it's not a known ID).
function buildNameResolver(users) {
  const byId = new Map();
  for (const u of (users || [])) {
    const id = (u.ID || u.id || '').toString().trim();
    if (!id) continue;
    const name = (u.Name || u.name || u['Name (Hindi)'] || '').toString().trim();
    if (name) byId.set(id, name);
  }
  return (val) => {
    const v = (val || '').toString().trim();
    return byId.get(v) || v;
  };
}

// A generated file's record_id is `<docType>-<year>-<rowIndex>`. Return the public
// download link for a collection row (year + __rowIndex) if one exists, else ''.
// We match on the trailing `-<year>-<row>` so we don't need to reproduce the
// docType-selection logic — the year+row pair is unique per collection entry.
function downloadLinkFor(genFiles, year, rowIndex) {
  if (!genFiles.length || !year || rowIndex == null || rowIndex === '') return '';
  const suffix = `-${year}-${rowIndex}`;
  const hit = genFiles.find(g => (g.record_id || '').toString().trim().endsWith(suffix) && (g.public_link || '').toString().trim());
  return hit ? hit.public_link.toString().trim() : '';
}

// Find contributor(s) named in the question and list their contributions across
// years, plus any public download links (receipts/certificates). Matches on the
// RESOLVED real name (not the ID stored on the row). Returns '' when no match.
function personContributionsFor(question, collections, nameOf, generatedFiles) {
  const q = (question || '').toString().toLowerCase();
  if (!q || !collections.length) return '';
  const genFiles = Array.isArray(generatedFiles) ? generatedFiles : [];
  // Unique contributor IDs -> { id, realName }.
  const ids = [...new Set(collections.map(c => (c.Name || '').toString().trim()).filter(Boolean))];
  const people = ids.map(id => ({ id, name: (nameOf ? nameOf(id) : id) }));

  // A person "matches" if their real name (full) is in the question, OR all of its
  // words (>=3 chars) are, OR a distinctive (>=4-char) word is — so "amit ka total"
  // and "amit kumar ne kitna diya" both match "Amit Kumar".
  const matched = people.filter(({ name }) => {
    const ln = (name || '').toLowerCase();
    if (!ln) return false;
    if (q.includes(ln)) return true;
    const words = ln.split(/\s+/).filter(w => w.length >= 3);
    if (!words.length) return false;
    if (words.every(w => q.includes(w))) return true;
    return words.some(w => w.length >= 4 && q.includes(w));
  }).slice(0, 8); // at most 8 people
  if (!matched.length) return '';

  const blocks = matched.map(({ id, name }) => {
    const rows = collections.filter(c => (c.Name || '').toString().trim() === id).slice(0, 40);
    const total = rows.reduce((s, c) => s + num(c.Amount), 0);
    const items = rows.map(c => {
      const yr = parseInt(c.Year) || '';
      const isResell = c['Is Resell'] === 'TRUE' || c['Is Resell'] === true;
      const what = isResell ? `resold: ${(c.Detail || '').toString()}` : inr(c.Amount);
      const link = downloadLinkFor(genFiles, yr, c.__rowIndex);
      return `${yr}: ${what}${link ? ` [download: ${link}]` : ''}`;
    }).join('; ');
    const links = rows.map(c => downloadLinkFor(genFiles, parseInt(c.Year) || '', c.__rowIndex)).filter(Boolean);
    const linkNote = links.length ? ` Download links: ${links.join(', ')}.` : ' No downloadable files are available for this person.';
    return `Contributions by "${name}" (${rows.length} entries, total ${inr(total)}): ${items}.${linkNote}`;
  });
  return 'PERSON DETAILS (use these for questions about a specific person, including download links):\n' + blocks.join('\n');
}
