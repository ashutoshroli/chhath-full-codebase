import { Home, ReceiptText, Landmark, Users, Download, HeartHandshake } from '@lucide/svelte';

export interface NavItem {
  href: string;
  key: string; // i18n key
  icon: typeof Home;
}

/** The three tabs that are always shown directly in the bottom bar. */
export const NAV_PRIMARY: NavItem[] = [
  { href: '/', key: 'nav_home', icon: Home },
  { href: '/expenses', key: 'nav_expenses', icon: ReceiptText },
  { href: '/loans', key: 'nav_loans', icon: Landmark }
];

/** Items grouped under the mobile "More" tab (a popover). On desktop these are
 *  shown inline alongside the primary items (see NAV_ITEMS). */
export const NAV_MORE: NavItem[] = [
  { href: '/downloads', key: 'nav_downloads', icon: Download },
  { href: '/committee', key: 'nav_committee', icon: Users },
  { href: '/donate', key: 'nav_donate', icon: HeartHandshake }
];

/** The full, flat nav list — used by the DESKTOP navs, which show every item
 *  inline (no "More" grouping on desktop). */
export const NAV_ITEMS: NavItem[] = [...NAV_PRIMARY, ...NAV_MORE];

/** Paths owned by the "More" popover — used to light up the More tab as active. */
export const NAV_MORE_PATHS = NAV_MORE.map((i) => i.href);
