# `vercel.json` security headers — reference

> This documentation used to live in a `$comment` key inside `vercel.json`, but
> Vercel's config schema **rejects any unknown top-level property** (`should NOT
> have additional property '$comment'`), which failed every deploy. The reasoning
> is kept here instead.

Applies to both `mgmt/frontend/vercel.json` and `Public/frontend/vercel.json`
(audit **H-14**). Before this, neither frontend shipped any security headers.

## Why `Referrer-Policy: no-referrer` is the important one

The loan-consent link puts the consent **token** in the URL path
(`/consent/<token>`), and that token is the credential for a legally binding
document. Without a referrer policy, every cross-origin subresource the consent
page loads — the Google Fonts stylesheet, the Material Icons font, a Drive/R2
image, an outbound link a member taps — receives the full URL, token included, in
the `Referer` header. `no-referrer` stops that leak outright. It is set for the
whole origin because the SPA rewrite means any path can render the consent route.

The public portal is reached from QR codes carrying
`?record=<docType>-<year>-<ref>`; same reasoning — no reason to hand that
reference to Google's font CDN or any outbound link.

## Why the CSP ships as `Content-Security-Policy-Report-Only`

An enforcing CSP that is even slightly wrong takes a screen down silently, and the
portal launches on 25 October. Report-Only gives identical telemetry with zero
risk, so the allowlist can be confirmed against real traffic first.

**To enforce:** rename `Content-Security-Policy-Report-Only` to
`Content-Security-Policy` — the value needs no other change. Recommended: leave it
in Report-Only for ~a week, check the browser console on every screen (especially
Consent, Popups, Download Center and PDF Export), then flip it.

## Allowlisted origins (derived from source, not guessed)

| Origin | Why |
|---|---|
| `googletagmanager.com` | `index.html` GTM bootstrap |
| `fonts.googleapis.com` | `index.html` stylesheet (`style-src`) |
| `fonts.gstatic.com` | the font files themselves (`font-src`) |
| `lh3.googleusercontent.com`, `drive.google.com`, `drive.usercontent.google.com` | `driveUrl.js` — Drive-hosted popup images, consent photos and signatures |
| `files-chhath.shaharpura.com` | the R2 public bucket (`R2_PUBLIC_BASE`) |
| `inputtools.google.com` | `transliterate.js` — the Hindi transliteration API (mgmt only) |
| `mgmt-chhath.shaharpura.com` | the mgmt API Worker (`connect-src`, mgmt only) |
| `chhath-public-worker.shaharpura.com` | the public read-only API (`connect-src`, public only) |
| `accounts.google.com` | **Sign in with Google** (Google Identity Services): the GSI client script (`script-src`), its iframe (`frame-src`) and its token exchange (`connect-src`). mgmt only. |
| `blob:` / `data:` | jsPDF, html2canvas, QR data-URLs, camera capture |

## Why `Cross-Origin-Opener-Policy` is `same-origin-allow-popups` (not `same-origin`)

Sign in with Google opens a Google popup that must `postMessage` its result back
to the login page. A strict `same-origin` COOP severs that link, so after the user
picks an account the flow **hangs on `accounts.google.com/gsi/transform` and never
returns a token**. `same-origin-allow-popups` keeps the cross-origin isolation
protection for everything else while letting the user-opened Google popup talk
back. This is Google's documented requirement for GSI.

`'unsafe-inline'` is required for `script-src` by the GTM bootstrap and for
`style-src` by the inline `style={{...}}` props used throughout the views.
Removing either is a separate, larger piece of work.

`api.ipify.org` is deliberately **absent**: that third-party IP lookup was removed
(audit H-13).

The public site has no `rewrites` block — it is genuinely static (`index.html` +
`script.js` + `style.css` + `robots.txt` + `sitemap.xml`), unlike the mgmt SPA.
