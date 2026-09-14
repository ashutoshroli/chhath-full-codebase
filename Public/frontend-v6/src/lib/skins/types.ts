/**
 * Skin contract.
 *
 * v6 is a skin-based multi-portal: selecting a theme swaps the ENTIRE portal —
 * layout shell AND every page — not just colours. Each skin is a self-contained
 * set of Svelte components that all consume the SAME shared data layer
 * (lib/api + lib/stores), so business logic is never duplicated across skins.
 *
 * A route (`+page.svelte`) stays thin: it renders `activeSkin.pages.Home` etc.,
 * and the root layout renders `activeSkin.Shell` around the page slot.
 */
import type { Component, Snippet } from 'svelte';

/** The chrome around every page: background, header, nav, footer, floating UI. */
export type SkinShell = Component<{ children: Snippet }>;

export interface SkinPages {
  Home: Component;
  Expenses: Component;
  Loans: Component;
  Committee: Component;
  Downloads: Component;
  Decade: Component;
  Donate: Component;
  Verify: Component;
}

export interface Skin {
  /** stable skin id (distinct from theme id; many themes may share a skin) */
  id: string;
  Shell: SkinShell;
  pages: SkinPages;
}
