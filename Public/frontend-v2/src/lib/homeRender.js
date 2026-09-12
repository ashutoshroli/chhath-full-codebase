// Pure HTML builders for the Home page's budget hero + contributors list.
//
// WHY THIS IS A SEPARATE MODULE
// Astro pages are static; anything interactive runs in a client <script> island.
// Rather than bury the porting-sensitive rendering logic inside index.astro
// (which cannot be `node --check`ed because it is not plain JS), the string
// builders live here as framework-free functions. index.astro's island imports
// them, and they can be syntax-checked and (in principle) unit-tested with plain
// `node --test`. All interpolated data is escaped with escapeHtml.
//
// Behaviour is ported from Public/frontend/script.js renderHomeList(): resell
// rows, money rows (Contribution Type '1'), and material('2')/service(else) rows.
import { escapeHtml } from './dom-escape.js';
import { fmt, isResellRow } from './finance.js';
import { localize, t } from '../i18n.js';

// Build the { ID -> user } lookup from the payload's users array (mirrors
// applyPortalData's userMap). Keys are trimmed string IDs.
export function buildUserMap(users) {
  const map = {};
  (users || []).forEach((u) => {
    if (u && u.ID) map[u.ID.toString().trim()] = u;
  });
  return map;
}

// Look up a contributor by ID (or Name fallback). A missing user resolves to a
// generic Unknown User with '-' fields — never undefined, so localize/escape are
// always safe. Mirrors app.getUser.
export function getUser(userMap, id) {
  const uid = (id === undefined || id === null ? '' : id).toString().trim();
  return (userMap && userMap[uid]) || { Name: 'Unknown User', Village: '-', Designation: '-', Mobile: '-' };
}

// The unique years present across collections + loans + committee, newest first.
// Falls back to the current year when the payload carries none. Mirrors the year
// set built in applyPortalData.
export function collectYears(data) {
  const d = data || {};
  const years = new Set();
  const add = (rows) => (rows || []).forEach((r) => { if (r && r.Year) years.add(parseInt(r.Year)); });
  add(d.collections);
  add(d.loans);
  add(d.committee);
  let arr = Array.from(years).filter((y) => !Number.isNaN(y)).sort((a, b) => b - a);
  if (arr.length === 0) arr = [new Date().getFullYear()];
  return arr;
}

// Build the contributors-list HTML for one row. Escapes every interpolated value.
// `lang` selects the localized (Hindi/English) name/village/designation columns.
// `isAll` adds a [Year] tag (lifetime view). Tailwind utility classes match the
// Phase 1 visual language (cards, brand accent, dark: variants).
function rowHtml(r, userMap, lang, isAll) {
  const yrTag = isAll
    ? `<span class="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">[${escapeHtml(r.Year)}]</span>`
    : '';

  // ---- Resell row: an item that was resold, not a person's contribution ----
  if (isResellRow(r)) {
    return `<div class="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800">
      <div>
        <strong class="block text-slate-800 dark:text-slate-100">♻️ ${escapeHtml(t(lang, 'resell'))}: ${escapeHtml(r.Detail || '-')} ${yrTag}</strong>
        <span class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(t(lang, 'resold_item'))}</span>
      </div>
      <strong class="whitespace-nowrap text-emerald-600 dark:text-emerald-400">+${escapeHtml(fmt(r.Amount))}</strong>
    </div>`;
  }

  const cType = (r['Contribution Type'] || 1).toString();
  const isMoney = cType === '1';
  const u = getUser(userMap, r.ID || r.Name);

  // Material/Service contributions carry no cash, so instead of an amount we show
  // a badge plus what was given / what work was done (Detail).
  const rightSide = isMoney
    ? `<strong class="whitespace-nowrap text-emerald-600 dark:text-emerald-400">+${escapeHtml(fmt(r.Amount))}</strong>`
    : `<div class="text-right">
        <span class="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">${escapeHtml(cType === '2' ? t(lang, 'material') : t(lang, 'service'))}</span>
        ${r.Detail ? `<div class="mt-1 max-w-[150px] text-xs text-slate-500 dark:text-slate-400">${escapeHtml(r.Detail)}</div>` : ''}
      </div>`;

  // Name / Designation / Village / Father's Name come from the Hindi DB columns
  // when Hindi is active (localize falls back to English if the Hindi cell blank).
  return `<div class="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800">
    <div>
      <strong class="block text-slate-800 dark:text-slate-100">${escapeHtml(localize(u, 'Name', lang))} (${escapeHtml(localize(u, 'Designation', lang) || '-')}) ${yrTag}</strong>
      <span class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(localize(u, 'Village', lang) || r.Village || '-')} | ${escapeHtml(localize(u, "Father's Name", lang) || '-')}</span>
    </div>
    ${rightSide}
  </div>`;
}

// Build the full contributors list, filtered by the lowercase search term `s`.
// Resell rows match by their item name (Detail); people by English OR Hindi name
// in either display language. Returns the "no records" message when empty.
export function renderContributorsList(rows, userMap, lang, isAll, search) {
  const s = (search || '').toLowerCase();
  const html = (rows || [])
    .filter((r) => {
      if (isResellRow(r)) return (r.Detail || '').toLowerCase().includes(s);
      const u = getUser(userMap, r.ID || r.Name);
      return (u.Name || '').toLowerCase().includes(s)
        || (u['Name (Hindi)'] || '').toString().toLowerCase().includes(s);
    })
    .map((r) => rowHtml(r, userMap, lang, isAll))
    .join('');
  return html || `<div class="py-6 text-center text-slate-500 dark:text-slate-400">${escapeHtml(t(lang, 'no_records_found'))}</div>`;
}

// The stale-data notice copy (bilingual). Reproduced VERBATIM from
// Public/frontend/script.js renderStaleNotice — this is ported user-facing UI
// copy that already contains an em dash, not prose authored here, so the dash is
// kept exactly. `savedAt` is a timestamp (ms) or falsy.
export function staleNoticeText(lang, savedAt) {
  let when = '';
  if (savedAt) {
    try { when = new Date(savedAt).toLocaleString(); } catch (e) { when = ''; }
  }
  const en = 'You are viewing saved data — live figures could not be loaded right now.' + (when ? ' (saved: ' + when + ')' : '');
  const hi = 'आप सहेजा हुआ डेटा देख रहे हैं — अभी ताज़ा आँकड़े लोड नहीं हो सके।' + (when ? ' (सहेजा: ' + when + ')' : '');
  return lang === 'hi' ? hi : en;
}

// The cold-failure retry card (bilingual). Reproduced VERBATIM from
// renderColdFailureFallback — friendly card that still names the committee and
// offers a reload, so the page is never a dead end. Escapes the interpolated copy.
export function coldFailureHtml(lang) {
  const isHi = lang === 'hi';
  const title = isHi ? 'नवयुवक छठ पूजा समिति, शहरपुरा एवं गरडीह' : 'Navyuvak Chhath Puja Samiti, Shaharpura & Gardih';
  const msg = isHi
    ? 'अभी डेटा लोड नहीं हो पा रहा। कृपया थोड़ी देर बाद पुनः प्रयास करें।'
    : 'Data could not be loaded right now. Please try again in a little while.';
  const retry = isHi ? 'पुनः प्रयास करें' : 'Retry';
  return `<div class="mx-auto max-w-md py-10 text-center">
    <img src="/logo.svg" alt="" width="72" height="72" class="mx-auto mb-3 h-16 w-16" />
    <h2 class="mb-1.5 text-lg font-bold text-slate-900 dark:text-white">${escapeHtml(title)}</h2>
    <p class="mb-4 text-sm text-slate-500 dark:text-slate-400">${escapeHtml(msg)}</p>
    <button type="button" data-cold-retry class="rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600">${escapeHtml(retry)}</button>
  </div>`;
}
