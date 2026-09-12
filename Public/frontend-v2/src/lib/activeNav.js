// Active-nav-item computation — framework-free, pure, and SHARED.
//
// WHY THIS EXISTS
// The header is marked transition:persist, so under View Transitions the
// persisted <header> keeps whatever active class / aria-current="page" the
// ORIGINAL server render computed (from Astro.url.pathname on the first load).
// Those never update for the new URL after a client swap, so the highlighted
// tab gets "stuck" on the page you first landed on (the reported /loans bug:
// the page is right but the nav still lights up Home). A tiny client-side
// updater in Header.astro fixes this by recomputing the active item from
// location.pathname on every astro:page-load — and it reuses the exact same
// path-normalization + match rule that the SERVER uses, so the client can never
// disagree with the server render.
//
// This module holds that one rule as two pure functions so BOTH the server
// render (Header.astro frontmatter) and the Node test harness import identical,
// reviewed behaviour. The .astro inline updater duplicates the same tiny logic
// (it runs in a define:vars script that cannot import a bundle) and this lib
// copy is the unit-tested source of truth for it.

// Normalize a pathname the way the server does: strip a single trailing slash
// EXCEPT for the root '/', so '/loans' and '/loans/' collapse to the same
// value while '/' stays '/'. A falsy/empty input is treated as root.
export function normalizePath(p) {
  const path = p || '/';
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

// Is `href` the active nav item for the current pathname? Both sides are
// normalized first so trailing-slash variants match. This is exact-match
// (===) — the same predicate the server used as `isActive` — because each nav
// route is a distinct top-level page, not a prefix hierarchy.
export function isActivePath(current, href) {
  return normalizePath(current) === normalizePath(href);
}
