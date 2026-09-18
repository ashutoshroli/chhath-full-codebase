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

// Shared guardrail line pushed into EVERY context builder's friendly-assistant
// preamble so the wording cannot drift between modes. The live bot has replied
// to ordinary end users with developer/integration advice (e.g. "developer ko
// kaho ki <a href> HTML format me rakhe", "react-linkify library use karo",
// "Markdown renderer use karo", "[download: URL] parse karo"). An end user must
// never see that — just hand back the link plainly and friendly.
const NO_DEV_INSTRUCTIONS_LINE = 'You are talking to an ordinary visitor, not a developer. NEVER give technical, developer, or integration instructions — do not mention HTML, Markdown, rendering, libraries (e.g. linkify), APIs, parsing, or how links should be displayed. When you reference a document, just present the link plainly and in a friendly, user-facing way in the user\'s language (e.g. "Yahan hai aapki 2024 ki receipt: <link>").';

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

// The founding year of the samiti's records — mirrors the frontend constant
// DECADE_START_YEAR in Public/frontend-v6/src/lib/api/derive.ts so the chatbot's
// "10-year story" span lines up exactly with the public "Our Journey" page.
const DECADE_START_YEAR = 2017;

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

  // buildNameResolver returns the raw input (e.g. the internal code USER0001)
  // when an ID is absent from `users`. The NEW loan/guarantor/resell sections
  // below reference borrower/guarantor/reseller IDs that are more likely to be
  // missing from a partial `users` slice than a contributor's, so an orphan ID
  // would leak a raw USER#### code into the prompt. `safeName` mirrors the same
  // neutral-label degradation buildFullContext uses: any value that resolves to
  // itself AND looks like a raw ID becomes the neutral 'unknown member' label.
  // (The decision lives at the call site, exactly like buildFullContext, so the
  // shared `nameOf` and buildNameResolver's contract stay untouched — the
  // pre-existing top-contributors/committee sections keep using plain `nameOf`.)
  const looksLikeRawId = (raw, resolved) => raw && resolved === raw && /^USER\d+$/i.test(raw);
  const safeName = (val) => {
    const raw = (val || '').toString().trim();
    const resolved = nameOf(raw);
    return looksLikeRawId(raw, resolved) ? 'unknown member' : resolved;
  };

  // Years present, newest first.
  const years = [...new Set(collections.map(c => parseInt(c.Year)).filter(Boolean))].sort((a, b) => b - a);
  const latestYear = years[0];

  // PHASE 1 — year-scoped retrieval. If the question names one (or more) of the
  // years actually present in the data, answer from ONLY those year(s)' rows so
  // the context stays bounded no matter how many years accumulate (no RAG, no
  // datastore — just a slice of the already-cached `data`). A no-year question
  // falls through to the GENERAL aggregated path below, unchanged.
  const scopedYears = detectYears(question, years);
  if (scopedYears.length) {
    return buildYearScopedContext(data, question, scopedYears);
  }

  const lines = [];
  lines.push('You are the warm, helpful assistant of the Navyuvak Chhath Puja Samiti (Shaharpura & Gardih). Below is the committee\'s public data — use it to answer people\'s questions in a friendly, clear way.');
  lines.push('You MAY add up amounts, count entries, rank people, and summarise across years. Amounts are in Indian Rupees (₹).');
  lines.push('You can answer questions such as: totals collected or spent per year; how much a specific person gave (across years, with any receipt/certificate download links); the top contributors in a year; who was on the committee in a given year and their roles; what money was spent on (expenses by description); loans (borrower, amount, interest rate, tenure); who guaranteed whose loan; and resold items.');
  lines.push('If the specific PERSON DETAILS block for a named person is present below, use it to answer about that person — their yearly amounts, total, and any download links for their receipts/certificates.');
  lines.push('Be generous and helpful: draw on every section below before concluding anything is missing. Only say you do not have the information if the answer genuinely is not in the data below. Reply briefly and clearly.');
  lines.push(NO_DEV_INSTRUCTIONS_LINE);
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
      const who = safeName((l.Name || '').toString().trim()) || 'unknown borrower';
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
      const guarantor = safeName((g.Guarantor || '').toString().trim()) || 'unknown member';
      const borrower = safeName((g.Loaner || '').toString().trim());
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
      const nm = safeName((c.Name || '').toString().trim()) || 'unknown member';
      const detail = (c.Detail || '').toString().trim() || 'item';
      const yr = parseInt(c.Year) || '';
      return `${detail} by ${nm}${yr ? ` (${yr})` : ''} ${inr(c.Amount)}`;
    });
    // NOTE for the model: these resold-item amounts are already included in each
    // year's collections total above — list them, but do NOT add them on top of a
    // year total when answering (avoids double-counting).
    lines.push(`Resold items (already counted in the year's collections total above): ${items.join('; ')}.`);
  }

  // PER-PERSON lookup: if the question names contributor(s) present in the data,
  // add ONLY their specific rows so a question like "how much did X give?" is
  // answerable without dumping every record. Bounded to keep the prompt small.
  const generatedFiles = Array.isArray(d.generatedFiles) ? d.generatedFiles : [];
  const personBlock = personContributionsFor(question, collections, nameOf, generatedFiles);
  if (personBlock) lines.push(personBlock);

  // PHASE 2 — if the question is about a document (receipt/certificate/PDF), surface
  // the matching generatedFiles public_link(s) DIRECTLY so the model hands back the
  // link rather than describing/fetching PDF content. Links-only, cache-only. The
  // block resolves by named person and/or year, or a bounded list otherwise.
  const docBlock = documentLinksBlock(data, question, { collections, nameOf, safeName });
  if (docBlock) lines.push(docBlock);

  // JOURNEY / 10-YEAR STORY — the friendly extra, appended AFTER the core sections
  // so it is what gets trimmed first if the SUMMARY_MAX_CHARS cap is hit. Cache-only.
  const journeyBlock = buildJourneySection(data);
  if (journeyBlock) lines.push(journeyBlock);

  let out = lines.join('\n');
  // Hard cap: never send an oversized prompt (a huge dataset was producing
  // Model HTTP 500). Trim from the end (per-year + person detail survive; the
  // long committee-name list is what gets cut first if anything).
  if (out.length > SUMMARY_MAX_CHARS) out = out.slice(0, SUMMARY_MAX_CHARS) + '\n…(data truncated)';
  return out;
}

// ---- PHASE 1: year-scoped retrieval helpers ------------------------------------
// The scaling problem: as more years of structured data accumulate, a summary that
// touches every year keeps growing. When a user asks about a SPECIFIC year, we do
// not need any other year — so detect the year(s) named in the question and build
// context from ONLY those year(s)' rows. This is CACHE-ONLY (operates on the
// passed-in `data`; never fetches / touches D1) and stays within SUMMARY_MAX_CHARS.

// Extract 4-digit years from the question (regex /\b(19|20)\d{2}\b/g) and intersect
// them with the set of years actually present in the data (`knownYears`). Returns
// the matched years as numbers (in the order they appear in the question, deduped),
// or an empty array when the question names no year, or only year(s) not in the
// data. Kept deliberately simple/robust; relative phrases like 'last year' are NOT
// handled (they are ambiguous without a reliable "current year") — a bare year is
// the core case.
function detectYears(question, knownYears) {
  const q = (question || '').toString();
  if (!q) return [];
  const known = new Set((knownYears || []).map(y => parseInt(y)).filter(Boolean));
  if (!known.size) return [];
  const found = q.match(/\b(?:19|20)\d{2}\b/g) || [];
  const out = [];
  for (const m of found) {
    const y = parseInt(m);
    if (known.has(y) && !out.includes(y)) out.push(y);
  }
  return out;
}

// Build a compact context scoped to ONLY the matched year(s): per-year totals,
// top contributors (aggregated per person, resell excluded), committee (deduped,
// real names), loans (borrower + amount + interest + tenure + Loan ID), guarantors
// for the year, and resold items — reusing the same ID->real-name resolver and the
// neutral-label degradation the general path uses. Includes the per-person block
// when the question names someone. Honors SUMMARY_MAX_CHARS exactly like the
// general path.
function buildYearScopedContext(data, question, years) {
  const d = data || {};
  const collections = Array.isArray(d.collections) ? d.collections : [];
  const expenses = Array.isArray(d.expenses) ? d.expenses : [];
  const loans = Array.isArray(d.loans) ? d.loans : [];
  const committee = Array.isArray(d.committee) ? d.committee : (Array.isArray(d.committeeMembers) ? d.committeeMembers : []);
  const guarantors = Array.isArray(d.guarantors) ? d.guarantors : [];
  const users = Array.isArray(d.users) ? d.users : [];
  const generatedFiles = Array.isArray(d.generatedFiles) ? d.generatedFiles : [];

  const nameOf = buildNameResolver(users);
  // Same neutral-label degradation the general path uses at each person-ID call
  // site: any value that resolves to itself AND looks like a raw ID (USER####)
  // becomes 'unknown member' so no internal code ever leaks into the prompt.
  const looksLikeRawId = (raw, resolved) => raw && resolved === raw && /^USER\d+$/i.test(raw);
  const safeName = (val) => {
    const raw = (val || '').toString().trim();
    const resolved = nameOf(raw);
    return looksLikeRawId(raw, resolved) ? 'unknown member' : resolved;
  };

  // Newest-first, only the matched years present in the data.
  const scoped = [...new Set(years.map(y => parseInt(y)).filter(Boolean))].sort((a, b) => b - a);
  const inScope = (v) => scoped.includes(parseInt(v));

  const lines = [];
  // Same friendly preamble/guardrail lines the general summary uses.
  lines.push('You are the warm, helpful assistant of the Navyuvak Chhath Puja Samiti (Shaharpura & Gardih). Below is the committee\'s public data — use it to answer people\'s questions in a friendly, clear way.');
  lines.push('You MAY add up amounts, count entries, rank people, and summarise across years. Amounts are in Indian Rupees (₹).');
  lines.push('You can answer questions such as: totals collected or spent per year; how much a specific person gave (across years, with any receipt/certificate download links); the top contributors in a year; who was on the committee in a given year and their roles; what money was spent on (expenses by description); loans (borrower, amount, interest rate, tenure); who guaranteed whose loan; and resold items.');
  lines.push('If the specific PERSON DETAILS block for a named person is present below, use it to answer about that person — their yearly amounts, total, and any download links for their receipts/certificates.');
  lines.push('Be generous and helpful: draw on every section below before concluding anything is missing. Only say you do not have the information if the answer genuinely is not in the data below. Reply briefly and clearly.');
  lines.push(NO_DEV_INSTRUCTIONS_LINE);
  lines.push(`The question is about ${scoped.join(', ')}, so only that year's data is shown below.`);

  for (const y of scoped) {
    const cols = collections.filter(c => parseInt(c.Year) === y);
    const exps = expenses.filter(e => parseInt(e.Year) === y);
    const totalCol = cols.reduce((s, c) => s + num(c.Amount), 0);
    const totalExp = exps.reduce((s, e) => s + num(e.Amount), 0);
    lines.push(`Year ${y}: collections ${inr(totalCol)} from ${cols.length} entries; expenses ${inr(totalExp)}; net ${inr(totalCol - totalExp)}.`);

    // Top contributors for the year — aggregated per PERSON (resell excluded so
    // amounts are not double-counted), real names.
    const totals = new Map();
    for (const c of cols) {
      if (c['Is Resell'] === 'TRUE' || c['Is Resell'] === true) continue;
      // safeName (not bare nameOf) so an orphan non-resell contributor ID absent
      // from `users` degrades to the neutral 'unknown member' label instead of
      // leaking a raw USER#### code into the prompt. Aggregation stays keyed by
      // the resolved display name, exactly as before.
      const nm = safeName(c.Name);
      if (!nm) continue;
      totals.set(nm, (totals.get(nm) || 0) + num(c.Amount));
    }
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([nm, amt]) => `${nm} (${inr(amt)})`);
    if (top.length) lines.push(`Top contributors ${y}: ${top.join(', ')}.`);

    // Committee for the year — deduped, real names.
    const cNames = [...new Set(
      committee.filter(m => parseInt(m.Year || m.year) === y)
        // safeName (not bare nameOf) so an orphan committee ID degrades to the
        // neutral 'unknown member' label rather than leaking a raw USER#### code.
        .map(m => safeName((m.Name || m.name || '').toString().trim()))
        .filter(Boolean)
    )];
    if (cNames.length) lines.push(`Committee ${y} (${cNames.length} members): ${cNames.join(', ')}.`);

    // Expenses for the year, grouped by description (NOTE the app's 'Discription'
    // spelling; there is NO public Category), summed, bounded.
    const byDesc = new Map();
    for (const e of exps) {
      const desc = (e.Discription || e['Discription (Hindi)'] || '').toString().trim();
      if (!desc) continue;
      byDesc.set(desc, (byDesc.get(desc) || 0) + num(e.Amount));
    }
    const expItems = [...byDesc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([desc, amt]) => `${desc} (${inr(amt)})`);
    if (expItems.length) lines.push(`Expenses ${y}: ${expItems.join(', ')}.`);

    // Loans for the year — borrower real name + amount + interest + tenure + Loan
    // ID (no public Status field, so none invented). Bounded.
    const loanItems = loans.filter(l => parseInt(l.Year) === y).slice(0, 20).map(l => {
      const who = safeName((l.Name || '').toString().trim()) || 'unknown borrower';
      const rate = (l['Intrest Rate'] || '').toString().trim();
      const tenure = (l.Tenure || '').toString().trim();
      const id = (l['Loan ID'] || '').toString().trim();
      const parts = [`${who}: ${inr(l.Amount)}`];
      if (rate) parts.push(`interest ${rate}`);
      if (tenure) parts.push(`tenure ${tenure}`);
      if (id) parts.push(`Loan ${id}`);
      return parts.join(', ');
    });
    if (loanItems.length) lines.push(`Loans ${y}: ${loanItems.join('; ')}.`);

    // Guarantors tied to this year (via g.Year when present), resolved to names.
    const gItems = guarantors.filter(g => parseInt(g.Year) === y).slice(0, 20).map(g => {
      const guarantor = safeName((g.Guarantor || '').toString().trim()) || 'unknown member';
      const borrower = safeName((g.Loaner || '').toString().trim());
      const id = (g['Loan ID'] || '').toString().trim();
      return `${guarantor} guarantees ${borrower || 'unknown borrower'}${id ? ` (Loan ${id})` : ''}`;
    });
    if (gItems.length) lines.push(`Guarantors ${y}: ${gItems.join('; ')}.`);

    // Resold items for the year — Detail, person real name, amount. Already part of
    // the collections total above (so the model must not double-count them).
    const resells = cols.filter(c => c['Is Resell'] === 'TRUE' || c['Is Resell'] === true).slice(0, 20);
    if (resells.length) {
      const rItems = resells.map(c => {
        const nm = safeName((c.Name || '').toString().trim()) || 'unknown member';
        const detail = (c.Detail || '').toString().trim() || 'item';
        return `${detail} by ${nm} ${inr(c.Amount)}`;
      });
      lines.push(`Resold items ${y} (already counted in the year's collections total above): ${rItems.join('; ')}.`);
    }
  }

  // PER-PERSON lookup: if the question names contributor(s), add their focused
  // block. It is intentionally scoped to the matched year(s)' collections so the
  // block stays consistent with the year-scoped context.
  const scopedCollections = collections.filter(c => inScope(c.Year));
  const personBlock = personContributionsFor(question, scopedCollections, nameOf, generatedFiles);
  if (personBlock) lines.push(personBlock);

  // PHASE 2 — document-intent link surfacing, scoped to the matched year(s)'
  // collections so it stays consistent with the year-scoped context. Links-only,
  // cache-only: only public_link strings already in the payload are emitted.
  const docBlock = documentLinksBlock(data, question, { collections: scopedCollections, nameOf, safeName });
  if (docBlock) lines.push(docBlock);

  // A SMALL decade-context line so a year question still situates itself in the
  // committee's journey — span + grand total + best year, no per-year list, to
  // respect the 6000-char cap on this path. Cache-only.
  const journeyLine = buildJourneyContextLine(data);
  if (journeyLine) lines.push(journeyLine);

  let out = lines.join('\n');
  // Same hard cap the general path applies.
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
  lines.push(NO_DEV_INSTRUCTIONS_LINE);

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

  // JOURNEY / 10-YEAR STORY — the friendly extra, appended AFTER the full sections
  // (a little wider per-year window in full mode). Cache-only.
  const journeyBlock = buildJourneySection(data, { full: true });
  if (journeyBlock) lines.push(journeyBlock);

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
// Anti-gibberish / single-language discipline directive appended to the system
// context. Defense-in-depth: the primary provider (gemini-3.1-flash-lite) is clean,
// but the provider chain in publicChat.js falls through to fallback models (NVIDIA
// NIM / Groq / Cerebras) on 429/5xx/timeout, and one of those (mistral-nemotron) was
// empirically producing garbled multilingual gibberish — Korean/Japanese/Spanish
// characters mixed into Hindi. This tells the model to answer in ONE language only,
// never mixing scripts. Parameterized by `lang` ('hi' => Hindi/Devanagari, else English).
export function languageDirective(lang) {
  if (lang === 'hi') {
    return '\nReply ONLY in simple Hindi using the Devanagari script (unless the user clearly wrote in English), in one single language. Do NOT mix in words or characters from any other language or script — no Korean, Japanese, Chinese, or Spanish characters. Keep the answer coherent, factual and plain; if you are unsure, simply present the facts plainly rather than guessing.';
  }
  return '\nReply in clear English, in one single language only. Do NOT insert words or characters from any other language or script. Keep the answer coherent, factual and plain; if you are unsure, simply present the facts plainly rather than guessing.';
}

export function buildContextForProvider(provider, data, question, lang) {
  const mode = (provider && provider.dataMode) || 'summary';
  let context = mode === 'full'
    ? buildFullContext(data, question)
    : summarizePortalData(data, question);
  context += languageDirective(lang);
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

// ---- JOURNEY / 10-YEAR STORY (the committee's decade, cache-only) --------------
// A visitor asking about "hamari yatra" / the 10-year / decade / "since 2017" story
// deserves a real, data-grounded answer instead of the model improvising from the
// per-year totals. This is the friendly EXTRA appended AFTER the core sections in
// each builder — it never replaces them and is what gets trimmed first under a cap.
//
// It is STRICTLY cache-only: it reads ONLY the passed-in `data` and NEVER fetches
// or touches D1. It draws on BOTH:
//   (a) real story content when the backend shipped it — data.journeyEntries
//       ([{year, title_en, title_hi, content_en, content_hi}]) and
//       data.journeyTagline ({en, hi}); a SHORT, bounded digest (tagline + up to a
//       few `year — title` lines, TITLES ONLY, never the full content bodies), and
//   (b) ALWAYS-available DERIVED decade figures computed from the cached
//       collections, mirroring Public/frontend-v6/src/lib/api/derive.ts decadeStats:
//       startYear = DECADE_START_YEAR (2017); endYear = max(2017, latest data year);
//       per-year total collected + contributor-entry count (resold rows EXCLUDED,
//       matching computeSummary/contributorsForYear); grandTotal, grandContributors,
//       and the best/peak year (highest total).
// Shapes are defensive throughout: any missing field yields '' / 0, never throws.
// `opts.full` widens the per-year growth list a little for the full context.
function buildJourneySection(data, opts) {
  const d = data || {};
  const o = opts || {};
  const collections = Array.isArray(d.collections) ? d.collections : [];

  const truthyResell = (v) => v === 'TRUE' || v === true;

  // Latest year actually present in the collections (0 when none).
  const dataYears = collections.map(c => parseInt(c.Year)).filter(Boolean);
  const latestDataYear = dataYears.length ? Math.max(...dataYears) : 0;

  const journeyEntries = Array.isArray(d.journeyEntries) ? d.journeyEntries : [];
  const hasEntries = journeyEntries.length > 0;

  // No data at all AND no story rows -> genuinely nothing to say.
  if (!latestDataYear && !hasEntries) return '';

  const startYear = DECADE_START_YEAR;
  const endYear = Math.max(DECADE_START_YEAR, latestDataYear);

  // Per-year DERIVED figures (mirror decadeStats): total collected (money) + a
  // contributor-entry count that EXCLUDES resold rows and counts each person ONCE
  // per year (keyed by the row's ID/Name), matching contributorsForYear.
  const perYear = []; // { year, total, contributors }
  let grandTotal = 0;
  let grandContributors = 0;
  let best = null; // { year, total }
  for (let y = startYear; y <= endYear; y++) {
    let total = 0;
    const people = new Set();
    for (const c of collections) {
      if (parseInt(c.Year) !== y) continue;
      if (truthyResell(c['Is Resell'])) continue;
      total += num(c.Amount);
      const id = (c.ID || c.Name || '').toString().trim();
      if (id) people.add(id);
    }
    const contributors = people.size;
    perYear.push({ year: y, total, contributors });
    grandTotal += total;
    grandContributors += contributors;
    if (best === null || total > best.total) best = { year: y, total };
  }

  const years = endYear - startYear + 1;
  const lines = [];
  lines.push(`JOURNEY / 10-YEAR STORY (the committee's decade of Chhath Puja, from ${startYear} to ${endYear} — use this to answer questions about hamari yatra / the journey / the decade / how far we have come):`);
  lines.push(`Span: ${startYear} to ${endYear} (${years} year${years === 1 ? '' : 's'}).`);
  lines.push(`Total collected across the whole journey: ${inr(grandTotal)} from ${grandContributors} contributor entries.`);
  if (best) lines.push(`Best/peak year so far: ${best.year} with ${inr(best.total)} collected.`);

  // A compact per-year growth line for the recent years — bounded to the same
  // ~6-year window the summary uses so tokens stay small (a little wider in full).
  const recent = perYear.slice(-(o.full ? 12 : 6));
  if (recent.length) {
    const growth = recent.map(r => `${r.year}: ${inr(r.total)} (${r.contributors} contributors)`).join('; ');
    lines.push(`Recent years: ${growth}.`);
  }

  // Real story digest when present — tagline + up to ~6 `year — title` lines,
  // TITLES ONLY (never the full content_en/content_hi bodies) so it stays bounded.
  if (hasEntries) {
    const tagline = d.journeyTagline && typeof d.journeyTagline === 'object'
      ? (d.journeyTagline.en || d.journeyTagline.hi || '').toString().trim()
      : '';
    if (tagline) lines.push(`Journey tagline: ${tagline}`);
    const titles = journeyEntries.slice(0, 6).map(e => {
      const r = e || {};
      const yr = parseInt(r.year);
      const title = (r.title_en || r.title_hi || '').toString().trim();
      if (!title) return '';
      return `${Number.isFinite(yr) ? `${yr} — ` : ''}${title}`;
    }).filter(Boolean);
    if (titles.length) lines.push(`Story highlights: ${titles.join('; ')}.`);
  }

  return lines.join('\n');
}

// A minimal one-line decade context for the year-scoped path (span + grand total +
// best year, WITHOUT the per-year growth list) so a year question still situates
// itself in the decade while respecting the 6000-char cap. Cache-only. '' when
// there is genuinely no data.
function buildJourneyContextLine(data) {
  const d = data || {};
  const collections = Array.isArray(d.collections) ? d.collections : [];
  const truthyResell = (v) => v === 'TRUE' || v === true;
  const dataYears = collections.map(c => parseInt(c.Year)).filter(Boolean);
  if (!dataYears.length) return '';
  const startYear = DECADE_START_YEAR;
  const endYear = Math.max(DECADE_START_YEAR, Math.max(...dataYears));
  let grandTotal = 0;
  let best = null;
  for (let y = startYear; y <= endYear; y++) {
    let total = 0;
    for (const c of collections) {
      if (parseInt(c.Year) !== y) continue;
      if (truthyResell(c['Is Resell'])) continue;
      total += num(c.Amount);
    }
    grandTotal += total;
    if (best === null || total > best.total) best = { year: y, total };
  }
  const parts = [`Decade context: the committee's journey runs ${startYear} to ${endYear}, ${inr(grandTotal)} collected in total`];
  if (best) parts.push(`best year ${best.year} (${inr(best.total)})`);
  return parts.join(', ') + '.';
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

// ---- PHASE 2: generated-PDF links handed back directly -------------------------
// When the question is ABOUT a document — a receipt / certificate / prashasti-patra
// / downloadable PDF — the model should hand back the matching public_link straight
// away (e.g. "Yahan hai 2024 ki receipt: <link>") rather than describe or fetch the
// PDF's contents. This is CACHE-ONLY and LINKS-ONLY: we only ever read public_link
// strings already present in the passed-in `data` (via generatedFiles) — we NEVER
// fetch or embed PDF content, and never touch D1.

// Detect a document-intent question. Keeps the vocabulary simple and robust,
// mirroring the app's doc language (there is a collections 'Certificate Or Receipt'
// field) plus the common English/Hindi/romanised terms a user would actually type:
// receipt, certificate, document, pdf, download, prashasti/prashansa patra, and the
// Devanagari रसीद / प्रमाण पत्र / प्रमाणपत्र / प्रमाण-पत्र. Returns true/false.
function isDocumentQuestion(question) {
  const q = (question || '').toString().toLowerCase();
  if (!q) return false;
  // Romanised / English keywords (word-ish substrings are fine for this intent).
  const en = ['receipt', 'certificate', 'certi', 'document', 'pdf', 'download', 'रसीद',
    'prashasti', 'prashansa', 'praman patra', 'praman-patra', 'pramanpatra', 'rasid', 'raseed'];
  if (en.some(k => q.includes(k))) return true;
  // Devanagari phrases (case does not apply, but keep the raw question for these).
  const raw = (question || '').toString();
  const hi = ['प्रमाण पत्र', 'प्रमाण-पत्र', 'प्रमाणपत्र', 'रसीद', 'प्रशस्ति'];
  return hi.some(k => raw.includes(k));
}

// Build the DOCUMENT LINKS block for a document-intent question. Resolution rules:
//   * If a PERSON is named (reuse personContributionsFor's resolved-real-name
//     matching) and/or a YEAR is detected (reuse detectYears), narrow to that
//     person's / year's specific document link(s) via downloadLinkFor and the
//     record_id trailing `-<year>-<rowIndex>` match.
//   * If nothing narrows it, surface a BOUNDED list of the most relevant links
//     (filtered by any matched year, capped) — never a dump of every file.
//   * If NO matching document exists, degrade gracefully with a neutral note and
//     NEVER invent a link, leak a raw record_id, or leak a USER#### code.
// Returns '' when the question is not about a document. `nameOf`/`safeName` are the
// resolver + neutral-label degrader from the calling context so no code leaks.
function documentLinksBlock(data, question, opts) {
  if (!isDocumentQuestion(question)) return '';
  const d = data || {};
  const o = opts || {};
  const collections = Array.isArray(o.collections) ? o.collections
    : (Array.isArray(d.collections) ? d.collections : []);
  const generatedFiles = Array.isArray(d.generatedFiles) ? d.generatedFiles : [];
  const nameOf = o.nameOf || ((v) => (v || '').toString().trim());
  const safeName = o.safeName || nameOf;

  const header = 'DOCUMENT LINKS (the user is asking about a receipt / certificate / downloadable document — hand back the matching public link DIRECTLY and plainly, e.g. "Yahan hai 2024 ki receipt: <link>". Do NOT describe or open the PDF; just give the link. Give NO developer, rendering, library, or parsing advice — the reader is an ordinary visitor, so never mention HTML, Markdown, linkify, or how to display the link):';
  const MAX_LINKS = 15; // bound so a big dataset cannot dump every file

  // Years present in generatedFiles, so we can honour a year named in the question.
  const fileYears = [...new Set(generatedFiles.map(g => parseInt(g.year)).filter(Boolean))];
  const scopedYears = detectYears(question, fileYears);

  // If a person is named, resolve THEIR rows and pull each row's link via the
  // record_id trailing `-<year>-<rowIndex>` match (reusing downloadLinkFor). We
  // reuse the same resolved-real-name matching personContributionsFor uses.
  const lines = [];
  const ids = [...new Set(collections.map(c => (c.Name || '').toString().trim()).filter(Boolean))];
  const q = (question || '').toString().toLowerCase();
  const matchedPeople = ids.map(id => ({ id, name: nameOf(id) })).filter(({ name }) => {
    const ln = (name || '').toString().toLowerCase();
    if (!ln) return false;
    if (q.includes(ln)) return true;
    const words = ln.split(/\s+/).filter(w => w.length >= 3);
    if (!words.length) return false;
    if (words.every(w => q.includes(w))) return true;
    return words.some(w => w.length >= 4 && q.includes(w));
  }).slice(0, 8);

  if (matchedPeople.length) {
    // Person-scoped: list each named person's document link(s), optionally further
    // narrowed to the year(s) named in the question.
    for (const { id, name } of matchedPeople) {
      const label = safeName(id) || 'unknown member';
      const rows = collections.filter(c => (c.Name || '').toString().trim() === id
        && (!scopedYears.length || scopedYears.includes(parseInt(c.Year))));
      const found = [];
      for (const c of rows) {
        const link = downloadLinkFor(generatedFiles, parseInt(c.Year) || '', c.__rowIndex);
        if (link) found.push(`${parseInt(c.Year) || ''}: ${link}`);
        if (found.length >= MAX_LINKS) break;
      }
      if (found.length) {
        lines.push(`Documents for "${label}"${scopedYears.length ? ` (${scopedYears.join(', ')})` : ''}: ${found.join('; ')}.`);
      } else {
        lines.push(`For "${label}"${scopedYears.length ? ` (${scopedYears.join(', ')})` : ''}, no downloadable document is available.`);
      }
    }
    return header + '\n' + lines.join('\n');
  }

  // No person named — surface a BOUNDED list of the most relevant links. Filter to
  // any year(s) named in the question; otherwise take the newest files first. Only
  // real public_link strings already in the payload are emitted (links-only).
  let files = generatedFiles.filter(g => (g.public_link || '').toString().trim());
  if (scopedYears.length) files = files.filter(g => scopedYears.includes(parseInt(g.year)));
  files = files
    .slice()
    .sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0))
    .slice(0, MAX_LINKS);

  if (!files.length) {
    // Graceful degradation — a neutral note, never a fabricated link.
    const scopeNote = scopedYears.length ? ` for ${scopedYears.join(', ')}` : '';
    return header + `\nNo downloadable document is available${scopeNote}.`;
  }

  // The doc_type is public app vocabulary (receipt/certificate). year + link only —
  // never the internal record_id.
  for (const g of files) {
    const type = (g.doc_type || 'document').toString().trim() || 'document';
    const yr = parseInt(g.year) || '';
    lines.push(`${type}${yr ? ` ${yr}` : ''}: ${g.public_link.toString().trim()}`);
  }
  return header + '\n' + lines.join('\n');
}
