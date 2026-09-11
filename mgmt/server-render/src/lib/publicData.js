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
  lines.push('You are the warm, helpful assistant of the Navyuvak Chhath Puja Samiti (Shaharpura & Gardih). Below is the committee\'s public data — use it to answer people\'s questions in a friendly, clear way.');
  lines.push('You MAY add up amounts, count entries, rank people, and summarise across years. Amounts are in Indian Rupees (₹).');
  lines.push('You can answer questions such as: totals collected or spent per year; how much a specific person gave (across years, with any receipt/certificate download links); the top contributors in a year; who was on the committee in a given year and their roles; what money was spent on (expenses by description); loans (borrower, amount, interest rate, tenure); who guaranteed whose loan; and resold items.');
  lines.push('If the specific PERSON DETAILS block for a named person is present below, use it to answer about that person — their yearly amounts, total, and any download links for their receipts/certificates.');
  lines.push('Be generous and helpful: draw on every section below before concluding anything is missing. Only say you do not have the information if the answer genuinely is not in the data below. Reply briefly and clearly.');
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

  // Committee — PER YEAR, with real names (a committee row's `Name` is the member's
  // ID code, like collections). Dedupe within a year. Public info.
  if (committee.length) {
    const cYears = [...new Set(committee.map(m => parseInt(m.Year || m.year)).filter(Boolean))].sort((a, b) => b - a);
    if (cYears.length) {
      for (const y of cYears.slice(0, 8)) {
        const names = [...new Set(
          committee.filter(m => parseInt(m.Year || m.year) === y)
            .map(m => nameOf((m.Name || m.name || '').toString().trim()))
            .filter(Boolean)
        )];
        if (names.length) lines.push(`Committee ${y} (${names.length} members): ${names.join(', ')}.`);
      }
    } else {
      // No year on the rows — fall back to a single de-duplicated list.
      const names = [...new Set(committee.map(m => nameOf((m.Name || m.name || '').toString().trim())).filter(Boolean))].slice(0, 60);
      lines.push(`Committee members (${names.length}): ${names.join(', ')}.`);
    }
  }

  // Loans summary (counts + totals only — no borrower PII beyond public name).
  if (loans.length) {
    const totalLoan = loans.reduce((s, l) => s + num(l.Amount), 0);
    lines.push(`Loans on record: ${loans.length}, total principal ${inr(totalLoan)}.`);
  }

  // EXPENSES per-year detail — for the recent ~6 years, list what the money was
  // spent on, grouped by the app's `Discription` field (NOTE its spelling; there
  // is NO public Category field) so repeated descriptions collapse into one summed
  // line. Capped to the top few items per year to keep the prompt small. Public.
  for (const y of years.slice(0, 6)) {
    const byDesc = new Map(); // description -> summed amount for the year
    for (const e of expenses) {
      if (parseInt(e.Year) !== y) continue;
      const desc = (e.Discription || e['Discription (Hindi)'] || '').toString().trim();
      if (!desc) continue;
      byDesc.set(desc, (byDesc.get(desc) || 0) + num(e.Amount));
    }
    const items = [...byDesc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([desc, amt]) => `${desc} (${inr(amt)})`);
    if (items.length) lines.push(`Expenses ${y}: ${items.join(', ')}.`);
  }

  // LOANS per-year detail — for the recent ~6 years, each loan as the borrower's
  // real name + amount + interest rate + tenure (+ 'Loan ID' when present). There
  // is NO public Status field, so none is invented. Bounded per year. Public.
  const loanYears = [...new Set(loans.map(l => parseInt(l.Year)).filter(Boolean))].sort((a, b) => b - a);
  for (const y of loanYears.slice(0, 6)) {
    const items = loans.filter(l => parseInt(l.Year) === y).slice(0, 10).map(l => {
      const who = nameOf((l.Name || '').toString().trim()) || 'unknown borrower';
      const rate = (l['Intrest Rate'] || '').toString().trim();
      const tenure = (l.Tenure || '').toString().trim();
      const id = (l['Loan ID'] || '').toString().trim();
      const parts = [`${who}: ${inr(l.Amount)}`];
      if (rate) parts.push(`interest ${rate}`);
      if (tenure) parts.push(`tenure ${tenure}`);
      if (id) parts.push(`Loan ${id}`);
      return parts.join(', ');
    });
    if (items.length) lines.push(`Loans ${y}: ${items.join('; ')}.`);
  }

  // GUARANTORS — resolve the Loaner (borrower) and Guarantor person IDs to real
  // names, e.g. "X guarantees Y (Loan <id>)". Emitted whenever guarantor rows
  // exist, independent of loans. Bounded to a small cap. Public.
  const guarantors = Array.isArray(d.guarantors) ? d.guarantors : [];
  if (guarantors.length) {
    const items = guarantors.slice(0, 15).map(g => {
      const guarantor = nameOf((g.Guarantor || '').toString().trim()) || 'unknown member';
      const borrower = nameOf((g.Loaner || '').toString().trim());
      const id = (g['Loan ID'] || '').toString().trim();
      return `${guarantor} guarantees ${borrower || 'unknown borrower'}${id ? ` (Loan ${id})` : ''}`;
    });
    lines.push(`Guarantors: ${items.join('; ')}.`);
  }

  // RESELL items — collections flagged 'Is Resell'. List the resold item (its
  // Detail), the person's real name, the year, and the amount. Bounded. Public.
  const resells = collections.filter(c => c['Is Resell'] === 'TRUE' || c['Is Resell'] === true).slice(0, 15);
  if (resells.length) {
    const items = resells.map(c => {
      const nm = nameOf((c.Name || '').toString().trim()) || 'unknown member';
      const detail = (c.Detail || '').toString().trim() || 'item';
      const yr = parseInt(c.Year) || '';
      return `${detail} by ${nm}${yr ? ` (${yr})` : ''} ${inr(c.Amount)}`;
    });
    lines.push(`Resold items: ${items.join('; ')}.`);
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

// ---- FULL portal dataset context (opt-in, per-provider dataMode='full') --------
// Unlike summarizePortalData (aggregates + only the queried person), this lays out
// the WHOLE public dataset row-by-row — every contribution, expense, committee
// membership and loan across all years — with all IDs resolved to real names so
// the model can answer any question without needing to re-query. It is CACHE-ONLY:
// it operates purely on the passed-in `data` object and NEVER calls fetch or D1.
//
// Because a large committee's full dataset can be big, it is bounded by a generous
// char cap (FULL_MAX_CHARS). If the assembled full context would exceed the cap we
// AUTOMATICALLY fall back to the compact summarizePortalData(data, question) — the
// caller does not need to check; 'full' degrades gracefully to 'summary'.
const FULL_MAX_CHARS = 80000;

export function buildFullContext(data, question) {
  const d = data || {};
  const collections = Array.isArray(d.collections) ? d.collections : [];
  const expenses = Array.isArray(d.expenses) ? d.expenses : [];
  const loans = Array.isArray(d.loans) ? d.loans : [];
  const guarantors = Array.isArray(d.guarantors) ? d.guarantors : [];
  const committee = Array.isArray(d.committee) ? d.committee : (Array.isArray(d.committeeMembers) ? d.committeeMembers : []);
  const users = Array.isArray(d.users) ? d.users : [];
  const generatedFiles = Array.isArray(d.generatedFiles) ? d.generatedFiles : [];

  // Same ID -> real-name resolver used by the summary (a collection/committee row's
  // `Name` is a person ID like USER0001; the display name lives in `users`).
  const resolve = buildNameResolver(users);
  // Full mode dumps EVERY row and promises the model "every person is shown by
  // their real name". buildNameResolver falls back to the raw value (e.g. the ID
  // code USER0001) when an ID is absent from `users`; to keep that promise and to
  // avoid handing an internal ID to a public user, degrade any unresolved code to
  // a neutral label instead of leaking it. (This decision lives here, not in
  // buildNameResolver, so the summary path's contract is untouched.)
  const looksLikeRawId = (raw, resolved) => raw && resolved === raw && /^USER\d+$/i.test(raw);
  const nameOf = (val) => {
    const raw = (val || '').toString().trim();
    const resolved = resolve(raw);
    return looksLikeRawId(raw, resolved) ? 'unknown member' : resolved;
  };

  const lines = [];
  lines.push('You are the friendly assistant of the Navyuvak Chhath Puja Samiti (Shaharpura & Gardih). Below is the committee\'s COMPLETE public dataset, laid out in full.');
  lines.push('Answer the user\'s question using this data. You MAY add up amounts, count entries, and summarise across years. Amounts are in Indian Rupees (₹).');
  lines.push('Every person is shown by their real name. Only say you do not have the information if it genuinely is not below. Reply briefly and clearly.');

  const years = [...new Set(collections.map(c => parseInt(c.Year)).filter(Boolean))].sort((a, b) => b - a);
  lines.push(`Years with contribution records: ${years.join(', ') || 'none'}.`);

  // Per-year totals (all years, not just the recent 6 — this is the full context).
  for (const y of years) {
    const cols = collections.filter(c => parseInt(c.Year) === y);
    const exps = expenses.filter(e => parseInt(e.Year) === y);
    const totalCol = cols.reduce((s, c) => s + num(c.Amount), 0);
    const totalExp = exps.reduce((s, e) => s + num(e.Amount), 0);
    lines.push(`Year ${y}: collections ${inr(totalCol)} from ${cols.length} entries; expenses ${inr(totalExp)}; net ${inr(totalCol - totalExp)}.`);
  }

  // EVERY contribution, resolved to a real name, with any public download link.
  if (collections.length) {
    lines.push('ALL CONTRIBUTIONS (person: year amount [type] [download link]):');
    for (const c of collections) {
      const nm = nameOf(c.Name);
      const yr = parseInt(c.Year) || '';
      const isResell = c['Is Resell'] === 'TRUE' || c['Is Resell'] === true;
      const type = (c['Contribution Type'] || '').toString().trim();
      const what = isResell ? `resold: ${(c.Detail || '').toString()}` : inr(c.Amount);
      const link = downloadLinkFor(generatedFiles, yr, c.__rowIndex);
      lines.push(`- ${nm}: ${yr} ${what}${type ? ` (${type})` : ''}${link ? ` [download: ${link}]` : ''}`);
    }
  }

  // EVERY expense (public info: what the money was spent on).
  if (expenses.length) {
    lines.push('ALL EXPENSES (year amount — detail):');
    for (const e of expenses) {
      const yr = parseInt(e.Year) || '';
      const detail = (e.Detail || e.Description || e.detail || '').toString().trim();
      lines.push(`- ${yr} ${inr(e.Amount)}${detail ? ` — ${detail}` : ''}`);
    }
  }

  // Committee membership per year, real names, deduped within a year.
  if (committee.length) {
    const cYears = [...new Set(committee.map(m => parseInt(m.Year || m.year)).filter(Boolean))].sort((a, b) => b - a);
    if (cYears.length) {
      lines.push('COMMITTEE MEMBERS BY YEAR:');
      for (const y of cYears) {
        const entries = [...new Set(
          committee.filter(m => parseInt(m.Year || m.year) === y).map(m => {
            const nm = nameOf((m.Name || m.name || '').toString().trim());
            const role = (m['View Role'] || m.role || '').toString().trim();
            return nm ? `${nm}${role ? ` (${role})` : ''}` : '';
          }).filter(Boolean)
        )];
        if (entries.length) lines.push(`- ${y} (${entries.length}): ${entries.join(', ')}.`);
      }
    } else {
      const names = [...new Set(committee.map(m => nameOf((m.Name || m.name || '').toString().trim())).filter(Boolean))];
      lines.push(`COMMITTEE MEMBERS (${names.length}): ${names.join(', ')}.`);
    }
  }

  // Loans, real names.
  if (loans.length) {
    const totalLoan = loans.reduce((s, l) => s + num(l.Amount), 0);
    lines.push(`ALL LOANS (${loans.length}, total principal ${inr(totalLoan)}):`);
    for (const l of loans) {
      const yr = parseInt(l.Year || l.year) || '';
      const who = nameOf((l.Name || l.name || '').toString().trim());
      const detail = (l.Detail || l.detail || '').toString().trim();
      lines.push(`- ${yr}${who ? ` ${who}` : ''}: ${inr(l.Amount)}${detail ? ` — ${detail}` : ''}`);
    }
  }

  // Guarantors, real names. Emitted whenever guarantor rows exist — INDEPENDENT of
  // loans (a portal can carry guarantors with the loan rows shaped separately, and
  // dropping them silently would hide public info the full context promises).
  if (guarantors.length) {
    lines.push(`GUARANTORS (${guarantors.length}):`);
    for (const g of guarantors) {
      const who = nameOf((g.Name || g.name || '').toString().trim());
      const forWhom = nameOf((g['Loan Taker'] || g.loanTaker || g.For || '').toString().trim());
      lines.push(`- ${who || '(unknown)'}${forWhom ? ` guarantees ${forWhom}` : ''}.`);
    }
  }

  // If the question names a specific person, still surface their focused block
  // (with download links) — cheap to include and helps a targeted question.
  const personBlock = personContributionsFor(question, collections, nameOf, generatedFiles);
  if (personBlock) lines.push(personBlock);

  const out = lines.join('\n');
  // Bounded by a generous cap. If the full layout would blow the model's input,
  // degrade gracefully to the compact summary rather than truncating mid-record.
  if (out.length > FULL_MAX_CHARS) return summarizePortalData(data, question);
  return out;
}

// ---- Per-provider context selection (full vs summary) --------------------------
// Build the system-prompt context for ONE provider, honouring its dataMode:
// 'full' => buildFullContext (whole dataset, IDs resolved to names, with its own
// internal fallback to the summary when it would exceed the cap); anything else
// (including a missing dataMode) => the compact summarizePortalData. Both read ONLY
// the passed-in cached `data` — neither touches D1. Appends the Hindi instruction
// when lang === 'hi'. Lives here (not in the express route) so it is a pure helper
// importable without pulling in express/pg.
export function buildContextForProvider(provider, data, question, lang) {
  const mode = (provider && provider.dataMode) || 'summary';
  let context = mode === 'full'
    ? buildFullContext(data, question)
    : summarizePortalData(data, question);
  if (lang === 'hi') context += '\nReply in simple Hindi (Devanagari) unless the user writes in English.';
  return context;
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
