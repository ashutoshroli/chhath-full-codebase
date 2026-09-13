/**
 * Number / currency helpers — behaviour matches Public/frontend-v3/script.js
 * exactly so displayed values are identical to the existing portals.
 */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

/** Format as Indian Rupees, no decimals (matches `fmt`). */
export function fmt(n: number | null | undefined): string {
  return inr.format(n || 0);
}

const inrPlain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
/** Format a plain number with Indian grouping (no currency symbol). */
export function fmtNum(n: number | null | undefined): string {
  return inrPlain.format(n || 0);
}

/**
 * Strip everything except digits/dot/minus, then parseFloat (matches `parseAmt`).
 * The single amount-parsing helper used in every financial sum.
 */
export function parseAmt(v: unknown): number {
  return parseFloat((v ?? '').toString().replace(/[^0-9.-]+/g, '')) || 0;
}

/** Only allow http(s) URLs (matches `safeUrl`). */
export function safeUrl(v: unknown): string {
  const raw = (v ?? '').toString().trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}

/** First character of a name, uppercased — used for avatar fallbacks. */
export function initials(name: unknown): string {
  const s = (name ?? '').toString().trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

/** Deterministic gradient pair for an avatar, seeded by a string. */
const AVATAR_COLORS: [string, string][] = [
  ['#F97316', '#C2410C'],
  ['#8B5CF6', '#6D28D9'],
  ['#EC4899', '#BE185D'],
  ['#10B981', '#047857'],
  ['#0EA5E9', '#0369A1'],
  ['#F43F5E', '#9F1239'],
  ['#3B82F6', '#1D4ED8'],
  ['#EAB308', '#A16207']
];
export function avatarGradient(seed: unknown): [string, string] {
  const s = (seed ?? '').toString();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
