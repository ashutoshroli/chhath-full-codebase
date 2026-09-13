import { Home, ReceiptText, Landmark, Users, Download } from '@lucide/svelte';

export interface NavItem {
  href: string;
  key: string; // i18n key
  icon: typeof Home;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', key: 'nav_home', icon: Home },
  { href: '/expenses', key: 'nav_expenses', icon: ReceiptText },
  { href: '/loans', key: 'nav_loans', icon: Landmark },
  { href: '/committee', key: 'nav_committee', icon: Users },
  { href: '/downloads', key: 'nav_downloads', icon: Download }
];
