import { escapeHtml } from './dom-escape.js';
import { fmt, isResellRow } from './finance.js';
import { localize, t } from '../i18n.js';

export function buildUserMap(users) {
  const map = {};
  (users || []).forEach((u) => {
    if (u && u.ID) map[u.ID.toString().trim()] = u;
  });
  return map;
}

export function getUser(userMap, id) {
  const uid = (id === undefined || id === null ? '' : id).toString().trim();
  return (userMap && userMap[uid]) || { Name: 'Unknown User', Village: '-', Designation: '-', Mobile: '-' };
}

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

function rowHtml(r, userMap, lang, isAll) {
  const yrTag = isAll
    ? `<span class="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">[${escapeHtml(r.Year)}]</span>`
    : '';

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

  const rightSide = isMoney
    ? `<strong class="whitespace-nowrap text-emerald-600 dark:text-emerald-400">+${escapeHtml(fmt(r.Amount))}</strong>`
    : `<div class="text-right">
        <span class="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">${escapeHtml(cType === '2' ? t(lang, 'material') : t(lang, 'service'))}</span>
        ${r.Detail ? `<div class="mt-1 max-w-[150px] text-xs text-slate-500 dark:text-slate-400">${escapeHtml(r.Detail)}</div>` : ''}
      </div>`;

  return `<div class="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800">
    <div>
      <strong class="block text-slate-800 dark:text-slate-100">${escapeHtml(localize(u, 'Name', lang))} (${escapeHtml(localize(u, 'Designation', lang) || '-')}) ${yrTag}</strong>
      <span class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(localize(u, 'Village', lang) || r.Village || '-')} | ${escapeHtml(localize(u, "Father's Name", lang) || '-')}</span>
    </div>
    ${rightSide}
  </div>`;
}

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

export function staleNoticeText(lang, savedAt) {
  let when = '';
  if (savedAt) {
    try { when = new Date(savedAt).toLocaleString(); } catch (e) { when = ''; }
  }
  const en = 'You are viewing saved data — live figures could not be loaded right now.' + (when ? ' (saved: ' + when + ')' : '');
  const hi = 'आप सहेजा हुआ डेटा देख रहे हैं — अभी ताज़ा आँकड़े लोड नहीं हो सके।' + (when ? ' (सहेजा: ' + when + ')' : '');
  return lang === 'hi' ? hi : en;
}

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
