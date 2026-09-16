/**
 * Pure derivations over the validated PortalData.
 *
 * Financial formulas are ported EXACTLY from Public/frontend-v3/script.js so the
 * headline numbers match the existing portals to the rupee:
 *
 *   Current Year Collection = Σ parseAmt(collection.Amount)         [year-filtered]
 *   Past Loan Returned      = Σ (principal + principal*(rate/100)*tenure)
 *       where principal = parseAmt(Amount), rate = parseAmt('Intrest Rate'||'Interest Rate')
 *       (per-month simple interest), tenure = parseAmt(Tenure).
 *       Per-year: loans of (year-1). Lifetime/All: all loans.
 *   Total Budget            = Collection + Past Loan Returned
 *   Total Expense           = Σ parseAmt(expense.Amount)            [year-filtered]
 *   Net Surplus             = Total Budget - Total Expense
 *
 * NEW (reference design, DERIVED from the above — not invented values):
 *   % Utilized      = Total Budget > 0 ? (Total Expense / Total Budget) * 100 : 0
 *   Still Available = Total Budget - Total Expense   (== Net Surplus)
 *
 * Contributor aggregation + competition ranking are new (no ranking existed
 * before) but computed entirely from real collection amounts.
 */
import { parseAmt } from '$lib/utils/format';
import { rowField } from './rowField';
import { competitionRank, type Ranked } from '$lib/utils/ranking';
import type {
  PortalData,
  CollectionRow,
  ExpenseRow,
  LoanRow,
  UserRow,
  CommitteeRow
} from './schema';

export const ALL_YEARS = 'All' as const;
export type YearSel = number | typeof ALL_YEARS;

const yint = (v: unknown): number | null => {
  const n = parseInt((v ?? '').toString(), 10);
  return Number.isFinite(n) ? n : null;
};

/** Distinct years (desc) from collections, loans and committee (matches source). */
export function availableYears(data: PortalData): number[] {
  const years = new Set<number>();
  const add = (rows: Array<{ Year?: unknown }> | undefined) => {
    for (const r of rows || []) {
      const y = yint(r.Year);
      if (y !== null) years.add(y);
    }
  };
  add(data.collections);
  add(data.loans);
  add(data.committee);
  const arr = [...years].sort((a, b) => b - a);
  return arr.length ? arr : [new Date().getFullYear()];
}

const isAll = (sel: YearSel): sel is typeof ALL_YEARS => sel === ALL_YEARS;

export function collectionsForYear(data: PortalData, sel: YearSel): CollectionRow[] {
  const rows = data.collections || [];
  if (isAll(sel)) return rows;
  return rows.filter((c) => yint(c.Year) === sel);
}

export function expensesForYear(data: PortalData, sel: YearSel): ExpenseRow[] {
  const rows = data.expenses || [];
  if (isAll(sel)) return rows;
  return rows.filter((e) => yint(e.Year) === sel);
}

export function loansForYear(data: PortalData, sel: YearSel): LoanRow[] {
  const rows = data.loans || [];
  if (isAll(sel)) return rows;
  return rows.filter((l) => yint(l.Year) === sel);
}

/** Simple per-month interest for one loan row (matches source formula). */
export function loanTotalWithInterest(l: LoanRow): {
  principal: number;
  interest: number;
  total: number;
} {
  const principal = parseAmt(l.Amount);
  const ratePerMonth = parseAmt(l['Intrest Rate'] ?? l['Interest Rate']);
  const tenureMonths = parseAmt(l.Tenure);
  const interest = principal * (ratePerMonth / 100) * tenureMonths;
  return { principal, interest, total: principal + interest };
}

export interface Financials {
  sel: YearSel;
  collection: number;
  pastLoanReturned: number;
  totalBudget: number;
  totalExpense: number;
  netSurplus: number;
  /** derived: 0..100, clamped */
  utilizedPct: number;
  /** derived: budget - expense (same as netSurplus, exposed for the UI label) */
  available: number;
}

export function computeFinancials(data: PortalData, sel: YearSel): Financials {
  const collection = collectionsForYear(data, sel).reduce((s, c) => s + parseAmt(c.Amount), 0);

  // Past Loan Returned: per-year uses the PREVIOUS year's loans; All uses all.
  const prevLoans = isAll(sel)
    ? data.loans || []
    : (data.loans || []).filter((l) => yint(l.Year) === sel - 1);
  const pastLoanReturned = prevLoans.reduce((s, l) => s + loanTotalWithInterest(l).total, 0);

  const totalBudget = collection + pastLoanReturned;
  const totalExpense = expensesForYear(data, sel).reduce((s, e) => s + parseAmt(e.Amount), 0);
  const netSurplus = totalBudget - totalExpense;
  const utilizedPct = totalBudget > 0 ? Math.min(100, Math.max(0, (totalExpense / totalBudget) * 100)) : 0;

  return {
    sel,
    collection,
    pastLoanReturned,
    totalBudget,
    totalExpense,
    netSurplus,
    utilizedPct,
    available: netSurplus
  };
}

// ---- Contributors ----

export interface Contributor {
  /** stable id: user ID when known, else the display name */
  key: string;
  name: string;
  nameHindi: string;
  amount: number;
  village: string;
  villageHindi: string;
  designation: string;
  designationHindi: string;
  fatherName: string;
  fatherNameHindi: string;
  /** number of individual contribution rows folded into this person */
  count: number;
  /** entry order: index at which this person FIRST appears in the data
   *  (so "jo pehle diya wo pehle" is preserved for non-top-5 display). */
  order: number;
  /** true if this person has ANY monetary ('1') contribution (drives ranking). */
  hasMoney: boolean;
  /** contribution kinds this person made: 'money' | 'material' | 'service'. */
  kinds: Set<'money' | 'material' | 'service'>;
  /** most-recent Detail text (for material/service display). */
  detail: string;
  /** representative year (for the [Year] tag in All mode). */
  year: string;
  /** public R2 URL of the member's profile photo, or '' for the initials avatar. */
  photo: string;
}

const truthyResell = (v: unknown): boolean => {
  if (v === true) return true;
  const s = (v ?? '').toString().trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
};

/** The kinds of contribution a person made, in a stable display order:
 *  money first (if any), then material, then service. Drives multi-tag display
 *  so someone who gave e.g. money + material shows BOTH, not just the amount. */
export type ContributionKind = 'money' | 'material' | 'service';
export function contributorTags(c: Pick<Contributor, 'kinds'>): ContributionKind[] {
  const out: ContributionKind[] = [];
  if (c.kinds.has('money')) out.push('money');
  if (c.kinds.has('material')) out.push('material');
  if (c.kinds.has('service')) out.push('service');
  return out;
}

/** A resold-item row (Is Resell = TRUE). These are NOT contributors — they are
 *  club assets sold on, shown in their own list/tab. `name` is the item name
 *  (from Detail, falling back to Name), `amount` the sale price. */
export interface ResoldItem {
  key: string;
  name: string;
  amount: number;
  year: string;
}

/** Resold items for a year (or all), in entry order. Mirrors the resell filter
 *  used everywhere else — these rows are excluded from the contributor list,
 *  ranking and count, and surfaced here instead. */
export function resoldItemsForYear(data: PortalData, sel: YearSel): ResoldItem[] {
  const out: ResoldItem[] = [];
  let seq = 0;
  for (const c of collectionsForYear(data, sel)) {
    if (!truthyResell(c['Is Resell'])) continue;
    const name = (c.Detail ?? c.Name ?? '').toString().trim();
    out.push({
      key: `resold-${c.__rowIndex ?? seq}`,
      name,
      amount: parseAmt(c.Amount),
      year: (c.Year ?? '').toString()
    });
    seq++;
  }
  return out;
}

/**
 * Build a userMap keyed by trimmed ID (matches source app.userMap).
 */
export function buildUserMap(data: PortalData): Map<string, UserRow> {
  const map = new Map<string, UserRow>();
  for (const u of data.users || []) {
    const id = (u.ID ?? '').toString().trim();
    if (id) map.set(id, u);
  }
  return map;
}

/**
 * Aggregate MONEY contributions per person for a year, summing amounts, then
 * sort by amount desc (ties broken by name for stable display). Resell rows and
 * non-money contribution types are excluded from the ranking amount (they have
 * no monetary Amount to a person), matching how the home list treats money rows.
 */
export function contributorsForYear(
  data: PortalData,
  sel: YearSel,
  userMap = buildUserMap(data)
): Contributor[] {
  const byKey = new Map<string, Contributor>();
  let seq = 0;
  for (const c of collectionsForYear(data, sel)) {
    // Resold items NEVER count as a contributor (excluded from list + ranking).
    if (truthyResell(c['Is Resell'])) continue;
    const cType = (c['Contribution Type'] ?? '1').toString();
    const isMoney = cType === '1' || cType === '';
    // Only monetary contributions carry a ranked amount; material/service = 0.
    const amount = isMoney ? parseAmt(c.Amount) : 0;
    const kind: 'money' | 'material' | 'service' = isMoney
      ? 'money'
      : cType === '2'
        ? 'material'
        : 'service';
    const id = (c.ID ?? c.Name ?? '').toString().trim();
    if (!id) continue;
    const user = userMap.get(id);
    const detail = (c.Detail ?? '').toString();

    const existing = byKey.get(id);
    if (existing) {
      existing.amount += amount;
      existing.count += 1;
      existing.hasMoney = existing.hasMoney || isMoney;
      existing.kinds.add(kind);
      if (detail) existing.detail = detail;
    } else {
      byKey.set(id, {
        key: id,
        name: (rowField(user, 'Name') || c.Name || id).toString(),
        nameHindi: rowField(user, 'Name (Hindi)'),
        amount,
        village: (rowField(user, 'Village') || c.Village || '').toString(),
        villageHindi: rowField(user, 'Village (Hindi)'),
        designation: rowField(user, 'Designation'),
        designationHindi: rowField(user, 'Designation (Hindi)'),
        fatherName: rowField(user, "Father's Name"),
        fatherNameHindi: rowField(user, "Father's Name (Hindi)"),
        count: 1,
        order: seq++,
        hasMoney: isMoney,
        kinds: new Set([kind]),
        detail,
        year: (c.Year ?? '').toString(),
        photo: (user?.Photo ?? '').toString()
      });
    }
  }

  // Amount-descending (ties -> name) so competition ranking is computed correctly.
  return [...byKey.values()].sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Contributors with competition ranking (1,1,3,4,4…; top-5 flagged), returned in
 * the requested DISPLAY order:
 *   EVERYONE — including the Top-5 — stays in ENTRY (SL No. / first-given) order.
 *   The Top-5 are NOT moved to the front; they simply carry the badge/crown/gold
 *   in place. Ranks/flags are still computed from the true amount order, so a
 *   person's rank (and whether they're Top-5) never changes with position.
 */
export function rankedContributors(
  data: PortalData,
  sel: YearSel,
  userMap = buildUserMap(data)
): Ranked<Contributor>[] {
  const all = contributorsForYear(data, sel, userMap);
  // Only MONEY contributors are eligible for a rank / Top-5 badge. Material and
  // service givers appear in the list but carry no rank and are never Top-5.
  const moneyOnly = all.filter((c) => c.hasMoney);
  const rankedMoney = competitionRank(moneyOnly, (c) => c.amount);
  const rankByKey = new Map(rankedMoney.map((r) => [r.item.key, r]));

  const combined: Ranked<Contributor>[] = all.map((item) => {
    const r = rankByKey.get(item.key);
    return r ? r : { item, rank: 0, isTop: false };
  });
  // Display in entry order; rank/isTop stay attached per person.
  return combined.sort((a, b) => a.item.order - b.item.order);
}

// ---- Summary statistics ----

export interface SummaryStats {
  contributors: number;
  totalCollected: number;
  average: number;
  /** % of contributors that map to a known/verified user record */
  recordedPct: number;
}

export function computeSummary(
  data: PortalData,
  sel: YearSel,
  userMap = buildUserMap(data)
): SummaryStats {
  const list = contributorsForYear(data, sel, userMap);
  const contributors = list.length; // everyone who contributed (money/material/service)
  const totalCollected = list.reduce((s, c) => s + c.amount, 0); // money only
  // Average is over people who actually gave money, so material/service givers
  // (amount 0) don't deflate the figure.
  const moneyGivers = list.filter((c) => c.hasMoney).length;
  const average = moneyGivers > 0 ? Math.round(totalCollected / moneyGivers) : 0;
  const recorded = list.filter((c) => userMap.has(c.key)).length;
  const recordedPct = contributors > 0 ? Math.round((recorded / contributors) * 100) : 0;
  return { contributors, totalCollected, average, recordedPct };
}

// ---- Decade / "Our Journey" (live figures) ----

/** The founding year of the samiti's records. Fixed; the range end is live. */
export const DECADE_START_YEAR = 2017;

export interface DecadeYearStat {
  year: number;
  /** Live total collected (₹) for the year. */
  total: number;
  /** Live recorded contributor entries for the year (resold excluded). */
  contributors: number;
  /** True when this is the current calendar year (records not final yet). */
  isCurrent: boolean;
}

export interface DecadeStats {
  startYear: number;
  /** Latest year present in the data (>= startYear, and always >= currentYear
   *  when the current calendar year has data). Drives the "2017 → {end}" range. */
  endYear: number;
  /** Current calendar year — the one whose figures are still being collected. */
  currentYear: number;
  /** Per-year live rows from startYear..endYear (ascending). */
  years: DecadeYearStat[];
  /** Σ of every year's total (₹), including the current live year. */
  grandTotal: number;
  /** Σ of every year's contributor entries, including the current live year. */
  grandContributors: number;
}

/**
 * Live decade figures for the "Our Journey" page. Every number is derived from
 * the real portal data (no hardcoded historical values): per-year total and
 * contributor entries come straight from computeSummary for that year, and the
 * grand totals sum all of them — including the current, still-open year.
 *
 * The year range starts at DECADE_START_YEAR and ends at the latest year that
 * has data (or the current calendar year, whichever is later), so next year it
 * extends itself automatically.
 */
export function decadeStats(data: PortalData): DecadeStats {
  const currentYear = new Date().getFullYear();
  const present = availableYears(data); // desc, from collections/loans/committee
  const dataMax = present.length ? Math.max(...present) : currentYear;
  const endYear = Math.max(DECADE_START_YEAR, dataMax, currentYear);
  const userMap = buildUserMap(data);

  const years: DecadeYearStat[] = [];
  let grandTotal = 0;
  let grandContributors = 0;
  for (let y = DECADE_START_YEAR; y <= endYear; y++) {
    const s = computeSummary(data, y, userMap);
    years.push({ year: y, total: s.totalCollected, contributors: s.contributors, isCurrent: y === currentYear });
    grandTotal += s.totalCollected;
    grandContributors += s.contributors;
  }

  return { startYear: DECADE_START_YEAR, endYear, currentYear, years, grandTotal, grandContributors };
}

// ---- "Our Journey" story content (DB-driven) ----

export interface JourneyEntry {
  year: number | null;
  titleEn: string;
  titleHi: string;
  contentEn: string;
  contentHi: string;
}

/** The year-by-year story rows from the backend, ordered as delivered. Empty
 *  when the backend hasn't shipped them (older deploy) — callers then fall back
 *  to their built-in text. */
export function journeyEntries(data: PortalData): JourneyEntry[] {
  const rows = (data as { journeyEntries?: unknown }).journeyEntries;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    const y = parseInt((row.year ?? '').toString(), 10);
    return {
      year: Number.isFinite(y) ? y : null,
      titleEn: (row.title_en ?? '').toString(),
      titleHi: (row.title_hi ?? '').toString(),
      contentEn: (row.content_en ?? '').toString(),
      contentHi: (row.content_hi ?? '').toString()
    };
  });
}

/** The bilingual journey tagline from the backend, or empty strings when unset
 *  (the caller then uses its i18n default). */
export function journeyTagline(data: PortalData): { en: string; hi: string } {
  const t = (data as { journeyTagline?: { en?: unknown; hi?: unknown } }).journeyTagline;
  return {
    en: (t?.en ?? '').toString(),
    hi: (t?.hi ?? '').toString()
  };
}

/** The "Donate Now" page fields from the backend (portal_settings donation_*).
 *  Every field is a string; missing/unset fields are '' so the page hides them.
 *  Optional on the payload — an older backend omits it and all fields read ''. */
export interface Donation {
  upiId: string;
  qrUrl: string;
  bankAccountName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  whatsapp: string;
}

export function donationSettings(data: PortalData): Donation {
  const d = (data as { donation?: Record<string, unknown> }).donation;
  const s = (v: unknown) => (v ?? '').toString().trim();
  return {
    upiId: s(d?.upiId),
    qrUrl: s(d?.qrUrl),
    bankAccountName: s(d?.bankAccountName),
    bankName: s(d?.bankName),
    accountNumber: s(d?.accountNumber),
    ifsc: s(d?.ifsc),
    whatsapp: s(d?.whatsapp)
  };
}

/** The CURRENT/live committee, independent of any user-selected year. Uses the
 *  current calendar year when the data has committee rows for it, otherwise the
 *  newest year present (availableYears is desc). The Donate page uses this so the
 *  member list never changes when the visitor picks an older year in the header. */
export function currentCommittee(
  data: PortalData,
  userMap = buildUserMap(data)
): CommitteeMember[] {
  const years = availableYears(data);
  if (years.length === 0) return [];
  const nowYear = new Date().getFullYear();
  const live = years.includes(nowYear) ? nowYear : years[0];
  return committeeForYear(data, live, userMap);
}

/** The Decade page's static text blocks for the given language, as a flat
 *  field->string map. Empty/missing fields are simply absent, so the caller does
 *  `journeyText(data, lang).intro ?? $tr('decade_intro')` to fall back to i18n.
 *  Values may contain {placeholders} ({start}/{end}/{amount}/{count}/{year}) —
 *  the caller interpolates them the same way $tr does. */
/** Replace {placeholder} tokens in a string (same rule as the i18n `t()`), for
 *  DB-sourced journey text that carries {start}/{end}/{amount}/{count}/{year}. */
export function interp(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  let s = str;
  for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  return s;
}

export function journeyText(data: PortalData, lang: 'en' | 'hi'): Record<string, string> {
  const t = (data as { journeyPageText?: { en?: unknown; hi?: unknown } }).journeyPageText;
  const block = (lang === 'hi' ? t?.hi : t?.en) as Record<string, unknown> | undefined;
  const out: Record<string, string> = {};
  if (block && typeof block === 'object') {
    for (const [k, v] of Object.entries(block)) {
      const s = (v ?? '').toString();
      if (s) out[k] = s;
    }
  }
  return out;
}

// ---- Committee ----

export interface CommitteeMember {
  name: string;
  nameHindi: string;
  role: string;
  roleHindi: string;
  designation: string;
  designationHindi: string;
  village: string;
  villageHindi: string;
  mobile: string;
  year: string;
  seed: string;
}

export function committeeForYear(
  data: PortalData,
  sel: YearSel,
  userMap = buildUserMap(data)
): CommitteeMember[] {
  const rows = (data.committee || []).filter((r) => (isAll(sel) ? true : yint(r.Year) === sel));
  return rows.map((r) => {
    const id = (r.ID ?? r.Name ?? '').toString().trim();
    const u = userMap.get(id);
    return {
      name: (u?.Name ?? r.Name ?? id).toString(),
      nameHindi: (u?.['Name (Hindi)'] ?? '').toString(),
      role: (r['View Role'] ?? '').toString(),
      roleHindi: (r['View Role (Hindi)'] ?? '').toString(),
      designation: (u?.Designation ?? '').toString(),
      designationHindi: (u?.['Designation (Hindi)'] ?? '').toString(),
      village: (u?.Village ?? '').toString(),
      villageHindi: (u?.['Village (Hindi)'] ?? '').toString(),
      mobile: (u?.Mobile ?? '').toString(),
      year: (r.Year ?? '').toString(),
      seed: id || (r.Name ?? '').toString()
    };
  });
}

// ---- Expenses (display) ----

export interface ExpenseItem {
  description: string;
  descriptionHindi: string;
  category: string;
  amount: number;
  year: string;
}

export function expenseItems(data: PortalData, sel: YearSel): ExpenseItem[] {
  return expensesForYear(data, sel).map((e) => ({
    description: (e.Discription ?? e.Description ?? '').toString(),
    descriptionHindi: (e['Discription (Hindi)'] ?? '').toString(),
    category: (e.Category ?? '').toString(),
    amount: parseAmt(e.Amount),
    year: (e.Year ?? '').toString()
  }));
}

// ---- Loans (display) ----

export interface GuarantorItem {
  name: string;
  nameHindi: string;
  village: string;
  villageHindi: string;
  isContributor: boolean;
  isCommittee: boolean;
  /** true when the guarantor is a committee member for the loan's year
   *  (base version flags this as a "Rule Violation"). */
  ruleViolation: boolean;
  seed: string;
}

export interface LoanItem {
  receiverId: string;
  name: string;
  nameHindi: string;
  loanId: string;
  principal: number;
  interest: number;
  total: number;
  ratePerMonth: number;
  tenure: number;
  year: string;
  seed: string;
  guarantors: GuarantorItem[];
}

/**
 * Resolve the guarantors for one loan, matching the base version exactly:
 *  - if the loan has a Loan ID -> match guarantor rows by that Loan ID;
 *  - else -> match by year AND (Loaner | ID | Name === receiverId).
 * Each guarantor is flagged Contributor / Committee for the loan's year, and
 * ruleViolation === isCommittee (committee members may not stand guarantor).
 */
function guarantorsForLoan(
  data: PortalData,
  loanId: string,
  loanYear: number | null,
  receiverId: string,
  userMap: Map<string, UserRow>
): GuarantorItem[] {
  const rows = (data.guarantors || []).filter((g) => {
    if (loanId) return (g['Loan ID'] ?? '').toString().trim() === loanId;
    const gy = yint(g.Year);
    const loanerMatch =
      (g.Loaner ?? '').toString() === receiverId ||
      (g.ID ?? '').toString() === receiverId ||
      (g.Name ?? '').toString() === receiverId;
    return gy === loanYear && loanerMatch;
  });

  return rows.map((g) => {
    const gid = (g.Guarantor ?? g['Guarantor ID'] ?? g['Guarantor 1'] ?? '').toString().trim();
    const u = userMap.get(gid);
    const isContributor = (data.collections || []).some(
      (c) => yint(c.Year) === loanYear && ((c.ID ?? '').toString() === gid || (c.Name ?? '').toString() === gid)
    );
    const isCommittee = (data.committee || []).some(
      (c) => yint(c.Year) === loanYear && ((c.ID ?? '').toString() === gid || (c.Name ?? '').toString() === gid)
    );
    return {
      name: (u?.Name ?? gid).toString(),
      nameHindi: (u?.['Name (Hindi)'] ?? '').toString(),
      village: (u?.Village ?? '').toString(),
      villageHindi: (u?.['Village (Hindi)'] ?? '').toString(),
      isContributor,
      isCommittee,
      ruleViolation: isCommittee,
      seed: gid
    };
  });
}

export function loanItems(
  data: PortalData,
  sel: YearSel,
  userMap = buildUserMap(data)
): LoanItem[] {
  return loansForYear(data, sel).map((l) => {
    const receiverId = (l.ID ?? l.Name ?? l.Receiver ?? '').toString().trim();
    const u = userMap.get(receiverId);
    const calc = loanTotalWithInterest(l);
    const loanId = (l['Loan ID'] ?? '').toString().trim();
    const loanYear = yint(l.Year);
    return {
      receiverId,
      name: (u?.Name ?? l.Name ?? receiverId).toString(),
      nameHindi: (u?.['Name (Hindi)'] ?? '').toString(),
      loanId,
      principal: calc.principal,
      interest: calc.interest,
      total: calc.total,
      ratePerMonth: parseAmt(l['Intrest Rate'] ?? l['Interest Rate']),
      tenure: parseAmt(l.Tenure),
      year: (l.Year ?? '').toString(),
      seed: receiverId || (l.Name ?? '').toString(),
      guarantors: guarantorsForLoan(data, loanId, loanYear, receiverId, userMap)
    };
  });
}

export type { CommitteeRow };


// ---- Downloads (document center) ----
//
// Matches the generatedFiles/loanConsents wiring from Public/frontend-v3:
//  - Collections docs: per non-resell collection row for a person, decide doc
//    type (samaan/certificate/receipt_work/receipt), build record id
//    `${docType}-${year}-${__rowIndex}`, and link if a matching generated file
//    exists (doc_type + year + record_id).
//  - Loaner consents: loanConsents role='loaner', status='accepted' for the
//    person's loans; id `consent_loaner-${year}-${consent_id}`.
//  - Guarantor consents: loanConsents role='guarantor', status='accepted',
//    person_id === id; id `consent_guarantor-${year}-${consent_id}`.

export interface DownloadDoc {
  labelKey: string;
  year: string;
  recordId: string;
  publicLink: string;
}

export interface DownloadGroup {
  titleKey: string;
  docs: DownloadDoc[];
}

const ystr = (v: unknown) => (v ?? '').toString();

function generatedLink(
  data: PortalData,
  docType: string,
  year: number,
  recordId: string
): string {
  const hit = (data.generatedFiles || []).find(
    (r) =>
      (r.doc_type ?? '').toString() === docType &&
      parseInt((r.year ?? '').toString(), 10) === year &&
      (r.record_id ?? '').toString() === recordId
  );
  return hit ? (hit.public_link ?? '').toString() : '';
}

// ---- Record verification (?record=<docType>-<year>-<ref>) ----
//
// The QR printed on every receipt / certificate opens the public portal with
// `?record=<recordId>`. A record is VERIFIED when a generated_files row carries
// exactly that record_id — i.e. the committee really did issue that document.
// For the collection-backed documents we additionally resolve the underlying
// collections row (matched on __rowIndex + Year, the same key the record id is
// built from) so the visitor sees the name / village / amount / detail to check
// against the paper in their hand. Ported from Public/frontend/script.js
// checkRecordVerification() so both portals verify identically.

/** Document types whose record id is deterministic (docType-year-__rowIndex). */
const COLLECTION_DOC_TYPES = ['receipt', 'receipt_work', 'certificate', 'samaan'];

export interface VerifyResult {
  /** the raw id from the URL */
  recordId: string;
  /** true when a generated_files row has this exact record_id */
  verified: boolean;
  /** i18n key for the document label, e.g. 'doc_receipt' (falls back to raw) */
  docLabelKey: string;
  /** raw docType when there is no i18n label */
  docType: string;
  year: string;
  /** true when the id is not in the `docType-year-ref` shape at all */
  malformed: boolean;
  /** resolved record details (only for collection-backed, verified ids) */
  details: {
    name: string;
    nameHindi: string;
    village: string;
    villageHindi: string;
    amount: number;
    detail: string;
    isResell: boolean;
  } | null;
}

const DOC_LABEL_KEYS: Record<string, string> = {
  receipt: 'doc_receipt',
  receipt_work: 'doc_receipt_work',
  certificate: 'doc_certificate',
  samaan: 'doc_samaan',
  consent_loaner: 'doc_consent_loaner',
  consent_guarantor: 'doc_consent_guarantor'
};

/**
 * Verify a `?record=` id against the public payload. Never throws — an unknown
 * or malformed id simply comes back `verified: false` so the UI can show the
 * "record not found" state.
 */
export function verifyRecord(data: PortalData, recordId: string): VerifyResult {
  const id = (recordId ?? '').toString().trim();
  const parts = id.split('-');
  const base: VerifyResult = {
    recordId: id,
    verified: false,
    docLabelKey: '',
    docType: '',
    year: '',
    malformed: parts.length < 3,
    details: null
  };
  if (parts.length < 3) return base;

  const docType = parts[0];
  const year = parts[1];
  const ref = parts.slice(2).join('-');

  base.docType = docType;
  base.year = year;
  base.docLabelKey = DOC_LABEL_KEYS[docType] || '';

  // A record is verified iff a generated file carries exactly this record_id.
  base.verified = (data.generatedFiles || []).some(
    (g) => (g.record_id ?? '').toString().trim() === id
  );

  if (!base.verified || !COLLECTION_DOC_TYPES.includes(docType)) return base;

  // Resolve the collections row the id was built from, to show the details.
  const wantYear = parseInt(year, 10);
  const entry = (data.collections || []).find(
    (c) => (c.__rowIndex ?? '').toString() === ref && yint(c.Year) === wantYear
  );
  if (!entry) return base;

  const isResell = truthyResell(entry['Is Resell']);
  if (isResell) {
    base.details = {
      name: (entry.Detail ?? entry.Name ?? '').toString().trim(),
      nameHindi: '',
      village: '',
      villageHindi: '',
      amount: parseAmt(entry.Amount),
      detail: '',
      isResell: true
    };
    return base;
  }

  // Join to the user for the display name + village (by ID, falling back to Name).
  const map = buildUserMap(data);
  const key = (entry.ID ?? entry.Name ?? '').toString().trim();
  const u = map.get(key);
  base.details = {
    name: (u?.Name ?? entry.Name ?? '').toString(),
    nameHindi: (u?.['Name (Hindi)'] ?? '').toString(),
    village: (u?.Village ?? '').toString(),
    villageHindi: (u?.['Village (Hindi)'] ?? '').toString(),
    amount: parseAmt(entry.Amount),
    detail: (entry.Detail ?? '').toString(),
    isResell: false
  };
  return base;
}

/** Distinct, sorted village names from users. */
export function villages(data: PortalData, lang: 'en' | 'hi' = 'en'): string[] {
  const set = new Set<string>();
  for (const u of data.users || []) {
    const v = ((lang === 'hi' ? u['Village (Hindi)'] : u.Village) ?? u.Village ?? '').toString().trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Users in a village (optionally name-filtered), capped for a fast picker. */
export function peopleInVillage(
  data: PortalData,
  village: string,
  query = '',
  limit = 50
): UserRow[] {
  const q = query.trim().toLowerCase();
  return (data.users || [])
    .filter((u) => (u.Village ?? '').toString().trim() === village)
    .filter((u) => {
      if (!q) return true;
      return (
        (u.Name ?? '').toString().toLowerCase().includes(q) ||
        (u['Name (Hindi)'] ?? '').toString().toLowerCase().includes(q)
      );
    })
    .slice(0, limit);
}

export function downloadsForPerson(data: PortalData, personId: string): DownloadGroup[] {
  const id = (personId ?? '').toString().trim();
  if (!id) return [];

  // 1) Collections
  const collectionDocs: DownloadDoc[] = [];
  for (const c of data.collections || []) {
    const cid = (c.ID ?? c.Name ?? '').toString().trim();
    if (cid !== id) continue;
    if (truthyResell(c['Is Resell'])) continue;
    const year = parseInt(ystr(c.Year), 10);
    if (!Number.isFinite(year)) continue;
    const cType = ystr(c['Contribution Type']);
    let docType: string;
    let labelKey: string;
    if (cType === '2') {
      docType = 'samaan';
      labelKey = 'doc_samaan';
    } else if (ystr(c['Certificate Or Receipt']) === 'Certificate') {
      docType = 'certificate';
      labelKey = 'doc_certificate';
    } else if (cType === '3') {
      docType = 'receipt_work';
      labelKey = 'doc_receipt_work';
    } else {
      docType = 'receipt';
      labelKey = 'doc_receipt';
    }
    const recordId = `${docType}-${year}-${c.__rowIndex ?? ''}`;
    collectionDocs.push({ labelKey, year: String(year), recordId, publicLink: generatedLink(data, docType, year, recordId) });
  }
  collectionDocs.sort((a, b) => Number(b.year) - Number(a.year));

  // 2) Loaner consents
  const loanerDocs: DownloadDoc[] = [];
  for (const l of data.loans || []) {
    const lid = (l.ID ?? l.Name ?? '').toString().trim();
    if (lid !== id) continue;
    const loanId = ystr(l['Loan ID']);
    const year = parseInt(ystr(l.Year), 10);
    const consent = (data.loanConsents || []).find(
      (x) =>
        ystr(x.loan_id) === loanId &&
        ystr(x.role) === 'loaner' &&
        ystr(x.status) === 'accepted'
    );
    if (consent && loanId) {
      const recordId = `consent_loaner-${year}-${ystr(consent.consent_id)}`;
      loanerDocs.push({
        labelKey: 'doc_consent_loaner',
        year: String(year),
        recordId,
        publicLink: generatedLink(data, 'consent_loaner', year, recordId)
      });
    }
  }

  // 3) Guarantor consents
  const guarantorDocs: DownloadDoc[] = [];
  for (const c of data.loanConsents || []) {
    if (ystr(c.role) !== 'guarantor' || ystr(c.status) !== 'accepted') continue;
    if (ystr(c.person_id).trim() !== id) continue;
    const loan = (data.loans || []).find((l) => ystr(l['Loan ID']) === ystr(c.loan_id));
    const year = loan ? parseInt(ystr(loan.Year), 10) : NaN;
    const recordId = `consent_guarantor-${year}-${ystr(c.consent_id)}`;
    guarantorDocs.push({
      labelKey: 'doc_consent_guarantor',
      year: String(year),
      recordId,
      publicLink: Number.isFinite(year) ? generatedLink(data, 'consent_guarantor', year, recordId) : ''
    });
  }

  const groups: DownloadGroup[] = [];
  if (collectionDocs.length) groups.push({ titleKey: 'dc_collections', docs: collectionDocs });
  if (loanerDocs.length) groups.push({ titleKey: 'dc_as_loaner', docs: loanerDocs });
  if (guarantorDocs.length) groups.push({ titleKey: 'dc_as_guarantor', docs: guarantorDocs });
  return groups;
}
