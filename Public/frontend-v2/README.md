# Chhath Puja Transparency Portal — Frontend v2

This is the **redesigned v2 public portal**: a modern, responsive, dark/light,
bilingual (English/Hindi) rebuild of the public transparency site, built with
[Astro](https://astro.build/) (static output) + [Tailwind CSS](https://tailwindcss.com/).

It **coexists with the original site** in `Public/frontend/`, which is untouched
and still deployable. v2 lives entirely in `Public/frontend-v2/` and is intended
to be deployed as a **separate Vercel project** first (on a preview URL), then
promoted by moving the custom domain over once verified. See
[Deploying to Vercel](#deploying-to-vercel) below.

## What v2 delivers

- Full Tailwind redesign, fully responsive, modern look.
- Dark / light theme switch **and** the language toggle **and** the year dropdown
  are grouped side by side in the header (per the product request).
- No-flash theme (the saved theme is applied before first paint).
- Static-first output with small interactive "islands" only where needed
  (theme toggle, language toggle, year select, Home data fetch, chatbot). This
  keeps page loads fast.
- All service URLs are **env-driven** (no hardcoded servers / mgmt login URL in
  source) — see [Environment variables](#environment-variables).

## Project layout

```
Public/frontend-v2/
  astro.config.mjs      # output: 'static', site = PUBLIC_SITE_URL, tailwind integration
  tailwind.config.mjs   # brand palette + dark mode ('class')
  vercel.json           # cache + security headers, CSP (report-only)
  public/               # static assets served verbatim (favicon, logo, robots, sitemap)
  src/
    layouts/Layout.astro       # HTML shell: no-flash theme, fonts, SEO, header, chatbot, skip link
    components/                # Header, Chatbot, Seo, Analytics
    pages/                     # index, expenses, loans, committee, downloads, privacy, terms
    lib/                       # framework-free, unit-tested logic modules
    styles/global.css          # Tailwind entry + brand token + focus-visible + bilingual show/hide
    config.js                  # central env-driven config (the four service URLs)
    i18n.js                    # bilingual dictionary + storage key
  test/                 # node --test suites for the pure lib modules
```

> **Note:** `src/lib/drive.js` is present and unit-tested but currently **unused**
> by any page/component. It is intentionally retained for **future Drive-hosted
> image support**. Do not wire it in unless that feature lands.

## Local development

Requires Node 18+ (Node 22 recommended).

```bash
cd Public/frontend-v2
npm install        # install Astro + Tailwind (dev/build deps)
npm run dev        # astro dev — local dev server with HMR
npm run build      # astro build — produces the static site in dist/
npm run preview    # astro preview — serve the built dist/ locally
npm test           # node --test test/*.test.mjs — pure-logic unit tests
```

The unit tests (`npm test`) run under plain Node with no Astro/Tailwind install
needed, because the `src/lib/*` modules are framework-free on purpose.

## Environment variables

All are read at **build time** by `src/config.js` / `src/lib/analytics.js` via
Astro's `import.meta.env`. Every one is **optional**: `config.js` falls back to
the known-good production defaults, so a missing var can never break the build or
leave a control pointing at nothing. Even so, they **should be set explicitly**
in the Vercel project so a value change never requires a source edit.

| Variable | Purpose | Production value (fallback default) |
| --- | --- | --- |
| `PUBLIC_API_BASE` | Public Cloudflare Worker that serves all portal data (the only data source; the site never touches D1 directly). | `https://chhath-public-worker.shaharpura.com` |
| `PUBLIC_RENDER_CHAT_URL` | Render-hosted chatbot endpoint the floating assistant POSTs questions to. | `https://chhath-server-render.onrender.com/public-chat` |
| `PUBLIC_MGMT_LOGIN_URL` | Management portal login the header "Login" control links out to (committee members only; not part of v2). | `https://mgmt-chhath.shaharpura.com/` |
| `PUBLIC_SITE_URL` | Canonical public origin — used for `<link rel="canonical">`, Open Graph `og:url`, and the Astro `site` setting. | `https://chhath.shaharpura.com` |
| `PUBLIC_GTM_ID` | Google Tag Manager container id (public, not a secret). GA4 + Clarity are configured as tags inside GTM. | `GTM-N6BF7NP7` |

> `robots.txt` and `sitemap.xml` are **static files** in `public/` and therefore
> **hardcode the production origin** (`https://chhath.shaharpura.com`) — Astro does
> not template files under `public/`, so they cannot read `PUBLIC_SITE_URL` at
> request time. The hardcoded origin matches `PUBLIC_SITE_URL`'s production
> default. **If the custom domain changes, update both `public/robots.txt` and
> `public/sitemap.xml`.**

## Deploying to Vercel

Create a **new, separate Vercel project** (do not touch the old one yet):

| Setting | Value |
| --- | --- |
| Root directory | `Public/frontend-v2` |
| Framework preset | Astro |
| Build command | `astro build` |
| Output directory | `dist` |

Set the five `PUBLIC_*` env vars above in the project's Environment Variables
(Production + Preview). All are optional (production defaults exist) but setting
them explicitly is recommended.

### Preview-first, then domain-switch

1. Deploy the new project and let Vercel run the **authoritative first build**
   (`astro build`). Verify everything on the generated **preview URL**.
2. Only after the preview looks correct, **move the custom domain**
   `chhath.shaharpura.com` from the old Vercel project to this v2 project.
3. Retire / archive the old project once the domain has moved and DNS has
   propagated.

### What to sanity-check on the preview URL

The sandbox that authored this code runs in an **INTEGRATIONS_ONLY** network
mode where `npm install` and `astro build` are blocked, so **the Astro build was
never run locally** — **Vercel performs the authoritative build**. On the preview
deployment, confirm:

- All pages load: `/`, `/expenses`, `/loans`, `/committee`, `/downloads`,
  `/privacy`, `/terms`.
- The **theme toggle** switches dark/light (and persists across reloads).
- The **language toggle** switches EN/HI (labels, placeholders, and data).
- The **year dropdown** populates and re-renders the Home figures.
- The **chatbot** opens, answers, and its reply **links are clickable**.
- **Data loads** from the public Worker (Home hero + lists show real numbers).
- `robots.txt` and `sitemap.xml` resolve and point at the production origin.

## Accessibility & performance notes

- **Focus visibility:** a single global `:focus-visible` saffron ring
  (`global.css`) is clearly visible in both themes; focus outlines are never
  removed.
- **Skip link:** a "Skip to main content" link is the first focusable element
  and targets `#main-content` on `<main>`.
- Header controls carry `aria-label`s; the active nav item has `aria-current="page"`;
  the chatbot panel is `role="dialog"` `aria-labelledby="chat-title"` and the FAB
  reflects open state via `aria-expanded`. Decorative Material Icons are
  `aria-hidden`.
- **Chatbot XSS posture (do not weaken):** user/error bubbles use `textContent`
  only; only the bot bubble uses `innerHTML`, and only via `linkifyBotText`
  (escape-first-then-linkify) with `safeUrl` allowing http(s) only.
- **Performance:** static-first output, islands only where interactivity is
  needed, fonts loaded non-render-blocking (`media=print` + `onload` swap),
  analytics booted on `window load`, and reserved min-heights on data containers
  to avoid layout shift (CLS). Do not rearchitect these without measuring.
