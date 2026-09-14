/**
 * Public runtime configuration.
 *
 * The four PUBLIC_* URLs are read from SvelteKit's static `$env` at build time,
 * each with a production FALLBACK so the app works even if no env is set (same
 * defaults the other Public frontends hardcode). Nothing here is a secret — the
 * backend is a read-only public API — but keeping URLs in one place means a
 * staging/preview deploy only needs env overrides, no code change.
 *
 * `resolveConfig` is a pure helper so it can be unit-tested without importing
 * `$env` (which only resolves inside a SvelteKit build).
 */

export const DEFAULTS = Object.freeze({
  PUBLIC_API_BASE: 'https://chhath-public-worker.shaharpura.com',
  PUBLIC_RENDER_CHAT_URL: 'https://chhath-server-render.onrender.com/public-chat',
  PUBLIC_MGMT_LOGIN_URL: 'https://mgmt-chhath.shaharpura.com/',
  PUBLIC_SITE_URL: 'https://chhath.shaharpura.com',
  // VAPID application server key (base64url, RAW P-256 public key) used to
  // subscribe to push. Deliberately EMPTY by default: with no key configured the
  // portal simply does not offer notifications. It is a PUBLIC key — the private
  // half lives only as a mgmt Worker secret.
  PUBLIC_VAPID_KEY: ''
});

export type ConfigKey = keyof typeof DEFAULTS;

export interface ResolvedConfig {
  /** Base of the read-only Cloudflare Worker API. Trailing slash stripped. */
  apiBase: string;
  renderChatUrl: string;
  mgmtLoginUrl: string;
  siteUrl: string;
  /** '' when push notifications are not configured for this deployment. */
  vapidKey: string;
}

const stripTrailingSlash = (v: string) => v.replace(/\/+$/, '');

export function resolveConfig(env: Partial<Record<ConfigKey, string | undefined>>): ResolvedConfig {
  const pick = (key: ConfigKey): string => {
    const v = env[key];
    return v === undefined || v === null || String(v).trim() === '' ? DEFAULTS[key] : String(v).trim();
  };
  return {
    apiBase: stripTrailingSlash(pick('PUBLIC_API_BASE')),
    renderChatUrl: pick('PUBLIC_RENDER_CHAT_URL'),
    mgmtLoginUrl: pick('PUBLIC_MGMT_LOGIN_URL'),
    siteUrl: stripTrailingSlash(pick('PUBLIC_SITE_URL')),
    vapidKey: pick('PUBLIC_VAPID_KEY')
  };
}

// Read the static public env lazily/defensively: in a plain node:test context
// (`vitest environment: node`) importing `$env/static/public` would fail, so we
// guard it and fall back to DEFAULTS. In a real SvelteKit build the import is
// replaced with literals at compile time.
function readEnv(): Partial<Record<ConfigKey, string | undefined>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return {
      PUBLIC_API_BASE: import.meta.env?.PUBLIC_API_BASE,
      PUBLIC_RENDER_CHAT_URL: import.meta.env?.PUBLIC_RENDER_CHAT_URL,
      PUBLIC_MGMT_LOGIN_URL: import.meta.env?.PUBLIC_MGMT_LOGIN_URL,
      PUBLIC_SITE_URL: import.meta.env?.PUBLIC_SITE_URL,
      PUBLIC_VAPID_KEY: import.meta.env?.PUBLIC_VAPID_KEY
    };
  } catch {
    return {};
  }
}

export const config: ResolvedConfig = resolveConfig(readEnv());

// Convenience: fully-formed action URLs against the API base.
export const apiUrl = (action: string, extra = ''): string =>
  `${config.apiBase}/?action=${encodeURIComponent(action)}${extra}`;

export default config;
