// ============ WHERE A PROVIDER KEY IS ALLOWED TO BE SENT (Worker side) ============
//
// audit Render/offload #6. An `openai-compatible` AI provider is configured by a
// Superadmin with a base URL, and that URL was validated by exactly this:
//
//     if (type === 'openai-compatible' && !/^https?:\/\//.test(baseUrl)) reject
//
// which accepts `http://169.254.169.254`, `http://localhost:8787`, `http://10.0.0.1`,
// and `https://user:pw@anything`. Two things then happen to that URL:
//
//   1. The provider's **API key is sent to it as a Bearer token.** So the field is not
//      just a request target, it is "which host would you like the credential handed to".
//      A typo is a leak; a malicious or coerced entry is exfiltration with a 200 response.
//   2. Both the Worker (`aiFix.js`) and the Render service fetch it server-side, from
//      inside the deployment's own network position. `http://169.254.169.254/...` is the
//      cloud metadata service; `http://10.x` and `http://127.0.0.1` are whatever else is
//      reachable from there. That is server-side request forgery with the response body
//      returned to the caller as "the model's answer".
//
// `http` was the sharpest edge: it is unencrypted, so the key is also on the wire in
// clear. There is no legitimate reason for a model endpoint to be plain HTTP.
//
// Two layers, because they catch different things:
//   * SHAPE (this file, both deployments) — protocol, credentials, IP literals, names
//     that cannot be public, and an optional operator allow-list. Cheap, synchronous,
//     and the only check a Cloudflare Worker CAN do: workerd has no DNS resolver.
//   * RESOLUTION (`mgmt/server-render/src/lib/providerUrl.js`) — the hostname's actual
//     addresses, which is what catches `evil.example` with an A record of 127.0.0.1.
//     Node has `dns`, so the Render service does this before every provider call.
//
// Both are applied at USE time as well as at save time, on purpose: rows saved before
// this existed may already hold an unsafe URL, and a save-time-only check would trust
// them forever.
//
// KEEP IN SYNC with `mgmt/server-render/src/lib/providerUrl.js` — the two deployments
// share no code by design, and `test/provider-url-policy.test.mjs` fails on drift.
import { ValidationError } from './auth.js';

// ---- 8< ---- POLICY (kept byte-identical in both copies) ---- 8< ----
// A model endpoint is a public HTTPS service. Everything below is a host that either
// cannot be one, or is one we refuse to hand a credential to.

// Hostnames that never resolve publicly, or that name an internal service by convention.
const BLOCKED_HOST_EXACT = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',       // GCP metadata
  'instance-data',                  // AWS
  'metadata.goog',
]);
const BLOCKED_HOST_SUFFIXES = [
  '.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa',
];

// An IPv4 literal, or a bracketed IPv6 literal, as a URL host.
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Is this IPv4 string one we must never connect to? */
function isBlockedIpv4(ip) {
  const m = IPV4_RE.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => !Number.isInteger(n) || n > 255)) return true;
  if (a === 0) return true;                        // 0.0.0.0/8 "this host"
  if (a === 10) return true;                       // private
  if (a === 127) return true;                      // loopback
  if (a === 169 && b === 254) return true;         // link-local — INCLUDES 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true;         // private
  if (a === 192 && b === 0) return true;           // 192.0.0/24 protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 carrier NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true;                       // multicast, reserved, broadcast
  return false;
}

/** Is this IPv6 string one we must never connect to? */
function isBlockedIpv6(raw) {
  const ip = (raw || '').toString().toLowerCase().replace(/^\[|\]$/g, '');
  if (!ip) return true;
  if (ip === '::1' || ip === '::') return true;    // loopback, unspecified
  // An IPv4-mapped address (::ffff:127.0.0.1) is an IPv4 destination wearing a v6 name.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
  if (mapped) return isBlockedIpv4(mapped[1]);
  const head = ip.split(':')[0];
  if (/^f[cd]/.test(head)) return true;            // fc00::/7 unique-local
  if (/^fe[89ab]/.test(head)) return true;         // fe80::/10 link-local
  return false;
}

/** True when this literal address must never be connected to. */
export function isBlockedAddress(ip) {
  const s = (ip || '').toString().trim();
  if (!s) return true;
  if (IPV4_RE.test(s)) return isBlockedIpv4(s);
  if (s.includes(':')) return isBlockedIpv6(s);
  return false; // not a literal address
}

/** Parses the operator allow-list. Empty means "no allow-list configured". */
export function parseHostAllowlist(raw) {
  return (raw || '').toString().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function allowlistPermits(hostname, allowHosts) {
  if (!allowHosts.length) return true;              // not configured — shape rules still apply
  return allowHosts.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
}

/**
 * The synchronous half of the policy. Returns `{ ok: true, url }` with the parsed URL, or
 * `{ ok: false, error }` with a reason safe to show a Superadmin.
 */
export function checkProviderUrlShape(raw, { allowHosts = [] } = {}) {
  const s = (raw === undefined || raw === null ? '' : raw.toString()).trim();
  if (!s) return { ok: false, error: 'A base URL is required.' };

  let url;
  try {
    url = new URL(s);
  } catch (e) {
    return { ok: false, error: 'The base URL is not a valid URL.' };
  }

  // HTTPS only. The API key travels to this host as a Bearer token, so plain HTTP puts
  // the credential on the wire in clear — and `http://` is what made every internal
  // address below reachable in the first place.
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'The base URL must use https:// — the API key is sent to this host.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'The base URL must not contain a username or password.' };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) return { ok: false, error: 'The base URL has no host.' };

  if (isBlockedAddress(hostname)) {
    return { ok: false, error: 'The base URL points at a private or loopback address.' };
  }
  if (hostname.startsWith('[')) {
    return { ok: false, error: 'The base URL points at a private or loopback address.' };
  }
  if (BLOCKED_HOST_EXACT.has(hostname) || BLOCKED_HOST_SUFFIXES.some((sfx) => hostname.endsWith(sfx))) {
    return { ok: false, error: 'The base URL points at an internal host.' };
  }
  // A single-label host ("api", "gateway") can only be internal — a public model endpoint
  // always has a registrable domain.
  if (!hostname.includes('.')) {
    return { ok: false, error: 'The base URL must use a public domain name.' };
  }
  if (!allowlistPermits(hostname, allowHosts)) {
    return { ok: false, error: `${hostname} is not on the configured AI provider allow-list.` };
  }
  return { ok: true, url };
}
// ---- 8< ---- END POLICY ---- 8< ----

/**
 * Worker-side entry point. Throws a ValidationError (400, shown to the Superadmin, not
 * logged as a server fault) so a bad entry reads as a form error.
 *
 * `env.AI_PROVIDER_HOST_ALLOWLIST` is optional: unset means the shape rules alone decide.
 */
export function assertProviderUrl(raw, env) {
  const allowHosts = parseHostAllowlist(env && env.AI_PROVIDER_HOST_ALLOWLIST);
  const verdict = checkProviderUrlShape(raw, { allowHosts });
  if (!verdict.ok) throw ValidationError(verdict.error);
  return verdict.url.toString().replace(/\/+$/, '');
}

/**
 * Fetch options every provider call must carry.
 *
 * `redirect: 'error'` is the point: without it an allowed public host can answer `302
 * Location: http://169.254.169.254/…` and the runtime follows it, with the Authorization
 * header still attached. Every check above would have passed, and the internal response
 * comes back as the model's answer. A model API has no reason to redirect.
 */
export const PROVIDER_FETCH_OPTS = { redirect: 'error' };
