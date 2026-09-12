// Analytics id resolution — framework-free and testable.
//
// WHY THIS EXISTS
// The old site hardcoded the Google Tag Manager container id in index.html. That
// is a PUBLIC analytics container id (not a secret), so a literal is acceptable,
// but keeping a single resolver — with an optional PUBLIC_GTM_ID env override and
// the known-good production fallback — matches the config module's philosophy
// (one place, env-driven, fail-safe) and lets a staging deploy point at a
// different container without editing source. The resolver is pure so it can be
// unit-tested with plain `node --test` (where import.meta.env is undefined).

// The production GTM container id (public, not a secret) ported from
// Public/frontend/index.html.
export const DEFAULT_GTM_ID = 'GTM-N6BF7NP7';

// Resolve the GTM id from an env-like object, falling back to the production
// default when PUBLIC_GTM_ID is missing or blank — so a missing env var can
// never break the analytics boot.
export function resolveGtmId(env) {
  const e = env || {};
  const v = e.PUBLIC_GTM_ID;
  return (v === undefined || v === null || String(v).trim() === '')
    ? DEFAULT_GTM_ID
    : String(v).trim();
}
