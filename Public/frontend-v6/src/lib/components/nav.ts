import { Home, ReceiptText, Landmark, Users, Download, HeartHandshake, BookOpen, History } from '@lucide/svelte';

export interface NavItem {
  href: string;
  key: string;
  icon: typeof Home;
}

/** Primary navigation: the journey is a first-class destination in the new skin. */
export const NAV_PRIMARY: NavItem[] = [
  { href: '/', key: 'nav_home', icon: Home },
  { href: '/expenses', key: 'nav_expenses', icon: ReceiptText },
  { href: '/loans', key: 'nav_loans', icon: Landmark },
  { href: '/decade', key: 'journey_title', icon: History }
];

export const NAV_MORE: NavItem[] = [
  { href: '/downloads', key: 'nav_downloads', icon: Download },
  { href: '/committee', key: 'nav_committee', icon: Users },
  { href: '/donate', key: 'nav_donate', icon: HeartHandshake },
  { href: '/guide', key: 'guide_title', icon: BookOpen }
];

export const NAV_ITEMS: NavItem[] = [...NAV_PRIMARY, ...NAV_MORE];
export const NAV_MORE_PATHS = NAV_MORE.map((i) => i.href);
