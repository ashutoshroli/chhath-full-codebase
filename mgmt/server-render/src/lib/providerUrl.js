// ============ WHERE A PROVIDER KEY IS ALLOWED TO BE SENT (Render side) ============
//
// audit Render/offload #6. See `mgmt/backend/src/providerUrl.js` for the full reasoning:
// an `openai-compatible` provider's base URL was validated with `/^https?:\/\//`, and the
// provider's API key is sent to whatever host that names, as a Bearer token, from inside
// this service's own network position.
//
// This copy carries the same SHAPE policy plus the half the Worker cannot do: workerd has
// no DNS resolver, and Node does. Shape rules cannot catch `evil.example` with an A record
// of `127.0.0.1` — only resolving the name can, so that is done here, before every
// provider call, on the addresses the name actually points to.
//
// KEEP IN SYNC with `mgmt/backend/src/providerUrl.js`; the Worker's
// `test/provider-url-policy.test.mjs` reads both files and fails on drift.
import dns from 'node:dns';

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
 * The half the Worker cannot do. Resolves the hostname and refuses if ANY address it
 * points to is one we must not connect to.
 *
 * Every address, not just the first: a name with both a public and a private A record
 * would otherwise pass whenever the resolver happened to order them favourably, which is
 * the same bug as trusting the first `X-Forwarded-For` entry.
 *
 * A resolution failure is a refusal, not a pass. If we cannot tell where a request is
 * going, we do not send a credential there.
 */
export async function assertResolvesPublicly(hostname) {
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (e) {
    throw new Error(`provider host ${hostname} could not be resolved: ${(e && e.code) || 'lookup failed'}`);
  }
  if (!addresses || !addresses.length) {
    throw new Error(`provider host ${hostname} resolved to no addresses`);
  }
  for (const a of addresses) {
    if (isBlockedAddress(a.address)) {
      // The address is deliberately NOT echoed: it is the answer to a DNS query the caller
      // controls, and this message reaches a log the caller can often read.
      throw new Error(`provider host ${hostname} resolves to a private or loopback address`);
    }
  }
}

/**
 * The full check, at use time, for a provider about to be called. Returns the normalised
 * base URL with any trailing slash removed.
 */
export async function assertProviderUrlAtUse(raw, { allowHosts = [] } = {}) {
  const verdict = checkProviderUrlShape(raw, { allowHosts });
  if (!verdict.ok) throw new Error(`provider base URL refused: ${verdict.error}`);
  await assertResolvesPublicly(verdict.url.hostname.toLowerCase());
  return verdict.url.toString().replace(/\/+$/, '');
}

/** The operator allow-list, from this service's environment. */
export function allowHostsFromEnv() {
  return parseHostAllowlist(process.env.AI_PROVIDER_HOST_ALLOWLIST);
}

/**
 * Fetch options every provider call must carry.
 *
 * `redirect: 'error'` is the point: without it an allowed public host can answer
 * `302 Location: http://169.254.169.254/...` and undici follows it with the Authorization
 * header still attached. Every check above would have passed. A model API has no reason to
 * redirect.
 */
export const PROVIDER_FETCH_OPTS = { redirect: 'error' };
