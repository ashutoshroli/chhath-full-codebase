# CORS preflight (M-10) + cookie session (H-12) — enablement runbook

**Status: NOT enabled. Do not flip any of this without doing Step 0 first.**

These two audit items are deliberately *not* shipped as an automatic change, because
both depend on production configuration that cannot be verified from CI, and getting
it wrong is a **site-wide outage**, not a degraded feature. This document is the
safe, ordered procedure to land them when someone with production access is ready.

## Why they are coupled and why they are risky

Today the mgmt frontend (`mgmt/frontend/src/api.js`) sends every request as a CORS
**simple request**: `fetch(url, { method: 'POST', body: JSON.stringify(body) })`
with **no `Content-Type` header**, so the browser defaults to `text/plain` and
issues **no preflight**. The session token travels **in the request body**
(`body.token`), read server-side as `req.token`.

Two consequences:

- **M-10:** because there is no `Content-Type`, `ALLOWED_ORIGINS` is never enforced
  for the request itself — only the response is hidden cross-origin. The finding is
  real but harmless while the token is body-borne.
- **H-12:** a body-borne token in `localStorage` is **structurally immune to CSRF**
  (an attacker's cross-site page cannot read your `localStorage` to include it). The
  cost is XSS exposure + a 30-day lifetime, mitigated already (hashed sessions in KV
  #75, revoke-on-password-change #83, per-device revoke).

Moving to an `HttpOnly; Secure; SameSite` **cookie** (H-12) is the right end state,
but it **re-introduces CSRF**, so it must ship *with* a CSRF token *and* the M-10
`Content-Type` change. And the moment you send `Content-Type: application/json`,
**every request becomes preflighted** — the `OPTIONS` needs a valid
`Access-Control-Allow-Origin`, and `allowedOrigin()` in `index.js` **fails closed**:
with `ALLOWED_ORIGINS` unset or wrong, no ACAO is sent and **every request from the
app fails**. That is a total outage, and today it is invisible because nothing is
preflighted.

## Step 0 — make the prerequisite visible (SHIPPED in this PR)

`checkConfig()` now emits a health-check warning when `ALLOWED_ORIGINS` is unset, so
`GET /?health=1` on the mgmt Worker tells you before you flip anything. This changes
no runtime behaviour — it is purely advisory.

**Do this first:**

1. `curl https://<mgmt-worker>/?health=1` and confirm `featureWarnings` does **not**
   list `ALLOWED_ORIGINS`. If it does, set it:
   ```
   # wrangler.toml [vars] — the EXACT frontend origin(s), comma-separated, no paths
   ALLOWED_ORIGINS = "https://mgmt.shaharpura.com"
   ```
   Redeploy, re-check health until the warning is gone.
2. Verify a normal login + a save still work (nothing has changed yet — this only
   sets the variable).

## Step 1 — M-10 (send Content-Type, enforce preflight)

Only after Step 0 shows a clean `ALLOWED_ORIGINS` in **production**:

- In `api.js` `call()`, add `headers: { 'Content-Type': 'application/json' }`.
- The `OPTIONS` handler in `index.js` already replies with the CORS headers and
  `Access-Control-Allow-Headers: Content-Type`, so preflight will succeed **iff**
  `ALLOWED_ORIGINS` matches the frontend origin.
- Roll out to a STAGING frontend origin first (add it to `ALLOWED_ORIGINS`), confirm
  requests still 200, then production.

## Step 2 — H-12 (cookie session + CSRF token), same deploy window as any further CORS change

- `issueSession()` (`auth.js`) additionally sets `Set-Cookie: cpm_session=<token>;
  HttpOnly; Secure; SameSite=Strict; Max-Age=...`.
- `withAuth()` reads the token from the cookie when present, falling back to
  `req.token` during the transition so old tabs keep working.
- Add a CSRF token: issue a non-HttpOnly `cpm_csrf` cookie + require a matching
  `X-CSRF-Token` header on every mutating action (the frontend reads the cookie and
  echoes it). `SameSite=Strict` is defence-in-depth; the header check is the real
  guard.
- `api.js`: add `credentials: 'include'` and stop putting the token in the body once
  every path reads the cookie.
- Keep the body-borne fallback for at least one release so sessions issued before the
  switch are not force-logged-out mid-session.

## Rollback

Each step is independently revertible by redeploying the previous Worker/frontend.
Step 1 and Step 2 must go out together with a verified `ALLOWED_ORIGINS`; if health
ever reports the warning again, revert Step 1 immediately (drop the `Content-Type`
header) to restore simple-request behaviour.
