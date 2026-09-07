// ============ COOKIE SESSION + CSRF HELPERS (audit H-12 / M-10) ============
//
// H-12: the session token historically travels in the request BODY and lives in
// the browser's localStorage. That is structurally CSRF-immune (a cross-site page
// can't read your localStorage to include it) but exposed to XSS and long-lived.
// The end state is an HttpOnly, Secure, SameSite session cookie — which is safer
// against XSS but RE-INTRODUCES CSRF, so it must ship together with a CSRF token
// (M-10 / the "double-submit cookie" pattern) and Origin checks.
//
// MIGRATION SAFETY (why nothing breaks):
//   * These helpers are ADDITIVE. On login we now ALSO set the cookies, but the
//     token is STILL returned in the JSON body, and the router still reads
//     req.token from the body. So an old tab / a client that ignores cookies keeps
//     working exactly as before.
//   * withAuth() uses req.token (body) first and only FALLS BACK to the cookie
//     session — so both paths authenticate.
//   * CSRF is enforced ONLY when the caller authenticated via the COOKIE and has
//     no body token (the case that actually needs CSRF). A body-token caller is
//     already CSRF-immune, so it is never blocked — this is what lets the two
//     schemes coexist during the transition with zero breakage.
//
// Cookie names:
//   cpm_session  — HttpOnly session token (never readable by JS; sent automatically)
//   cpm_csrf     — readable CSRF token; the frontend echoes it in the X-CSRF-Token
//                  header. The double-submit match proves the request came from our
//                  own page, not a cross-site form.

import { randomToken } from './random.js';

export const SESSION_COOKIE = 'cpm_session';
export const CSRF_COOKIE = 'cpm_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// Parse a Cookie: header into a plain object. Never throws.
export function parseCookies(request) {
  const out = {};
  try {
    const raw = request.headers.get('Cookie') || request.headers.get('cookie') || '';
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i === -1) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  } catch (e) { /* malformed header -> no cookies */ }
  return out;
}

// A fresh CSRF token to pair with a new session.
export function newCsrfToken() {
  return randomToken();
}

// Build the two Set-Cookie header values for a freshly issued session.
//   session: HttpOnly (JS can't read it -> XSS can't steal it), Secure, SameSite.
//   csrf:    NOT HttpOnly (the SPA must read it to echo in the header), Secure, SameSite.
// SameSite=Strict is defence-in-depth; the double-submit header check is the real
// guard. maxAgeSeconds mirrors the session TTL so both expire together.
export function buildSessionCookies(sessionToken, csrfToken, maxAgeSeconds) {
  const attrs = `Path=/; Secure; SameSite=Strict; Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`;
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; HttpOnly; ${attrs}`,
    `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; ${attrs}`,
  ];
}

// Set-Cookie values that clear both cookies (used on logout).
export function buildClearCookies() {
  const gone = 'Path=/; Secure; SameSite=Strict; Max-Age=0';
  return [
    `${SESSION_COOKIE}=; HttpOnly; ${gone}`,
    `${CSRF_COOKIE}=; ${gone}`,
  ];
}
