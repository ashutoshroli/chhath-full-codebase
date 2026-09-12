// Central runtime configuration for the v2 public portal.
//
// WHY THIS EXISTS
// The four service URLs below used to be hardcoded across the old plain-static
// site. That made staging/preview deploys painful (you had to edit source to
// point at a different Worker) and meant a URL change touched many files. Here
// they live in ONE place, sourced from build-time environment variables so the
// same source tree can target production, staging, or a local Worker just by
// changing Vercel project env — no code edit, no redeploy of source.
//
// Astro exposes variables prefixed with PUBLIC_ to client code via
// `import.meta.env`. We read those and fall back to the known-good production
// values, so a MISSING env var can never break the build or leave a control
// pointing at nothing — the site simply ships with the production defaults.
//
// THE FOUR VARS
//   PUBLIC_API_BASE        The public Cloudflare Worker that serves portal data
//                          (?action=dataVersion / portalData / activePopups /
//                          publicGetSeo). This is the ONLY data source; the site
//                          never talks to D1 directly.
//   PUBLIC_RENDER_CHAT_URL The Render-hosted chatbot endpoint (/public-chat) the
//                          floating assistant POSTs questions to.
//   PUBLIC_MGMT_LOGIN_URL  The management portal login the "Login" control links
//                          out to (committee members only; not part of v2).
//   PUBLIC_SITE_URL        The canonical public origin, used for <link canonical>,
//                          Open Graph og:url and the Astro `site` setting.
//
// FRAMEWORK-FREE ON PURPOSE
// This module imports nothing from Astro/Tailwind so the pure resolveConfig()
// helper can be unit-tested with plain `node --test`, where `import.meta.env`
// does not exist. The guard below returns an empty object in that case, which
// makes resolveConfig() fall back to the production defaults — exactly what the
// tests assert.

// Production defaults. Kept as named constants so the fallbacks are documented
// and testable in isolation.
export const DEFAULTS = Object.freeze({
  PUBLIC_API_BASE: 'https://chhath-public-worker.shaharpura.com',
  PUBLIC_RENDER_CHAT_URL: 'https://chhath-server-render.onrender.com/public-chat',
  PUBLIC_MGMT_LOGIN_URL: 'https://mgmt-chhath.shaharpura.com/',
  PUBLIC_SITE_URL: 'https://chhath.shaharpura.com',
});

// Pure resolver: given an env-like object (any object with optional PUBLIC_*
// string keys), return the resolved config, applying the production fallback
// whenever a value is missing or blank. No I/O, no globals — trivially testable.
export function resolveConfig(env) {
  const e = env || {};
  const pick = (key) => {
    const v = e[key];
    // Treat undefined/null/empty-string as "not set" so a blank env var can't
    // wipe out a working default.
    return (v === undefined || v === null || String(v).trim() === '')
      ? DEFAULTS[key]
      : String(v);
  };
  return {
    apiBase: pick('PUBLIC_API_BASE'),
    renderChatUrl: pick('PUBLIC_RENDER_CHAT_URL'),
    mgmtLoginUrl: pick('PUBLIC_MGMT_LOGIN_URL'),
    siteUrl: pick('PUBLIC_SITE_URL'),
  };
}

// Read Astro's build-time env when available, otherwise an empty object so this
// module ALSO loads under plain `node --test` (where import.meta.env is
// undefined) and yields the production defaults.
const runtimeEnv =
  (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

const resolved = resolveConfig(runtimeEnv);

export const apiBase = resolved.apiBase;
export const renderChatUrl = resolved.renderChatUrl;
export const mgmtLoginUrl = resolved.mgmtLoginUrl;
export const siteUrl = resolved.siteUrl;

export default resolved;
