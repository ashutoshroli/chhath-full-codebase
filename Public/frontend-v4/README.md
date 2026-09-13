# Chhath Puja Transparency Portal — frontend-v4

Production redesign of the public transparency portal for **Navyuvak Chhath Puja
Samiti** (Shaharpura, Gardih). One final, premium, mobile-first design in **light
and dark** themes, built on a fast static stack and consuming the **existing,
unchanged** Cloudflare Worker API.

> This is a **new, self-contained** frontend. `Public/frontend`,
> `Public/frontend-v2` and `Public/frontend-v3` are left completely untouched.
> The backend (`Public/backend`), database and Cloudflare Worker are **not
> modified** — v4 only reads the documented public API.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | **SvelteKit** + **TypeScript** |
| Rendering | `@sveltejs/adapter-static` (fully static, SPA fallback `200.html`) |
| UI | **Tailwind CSS** (`darkMode: 'class'`, brand palette) |
| Icons | **Lucide** (`@lucide/svelte`) |
| Animation | CSS + Svelte transitions (all reduced-motion aware) |
| Validation | **Zod** (soft validation of API responses) |
| Images | Optimized SVG (icons, ghat silhouette); WebP/AVIF ready |
| Data | Existing Cloudflare Worker API (read-only) |
| Caching | Client-side intelligent cache (memory TTL + localStorage snapshot + stale fallback) |
| PWA | Yes — manifest, maskable icons, offline app-shell service worker |

Backend / database / Worker: **UNCHANGED.**

## Getting started

```bash
npm install
npm run dev        # local dev server
npm run build      # static production build -> ./build
npm run preview    # preview the production build
npm run check      # svelte-check (type + a11y)
npm run test       # vitest unit tests (financials, ranking, schema, i18n)
```

Requires Node 18+ (developed on Node 22).

## Configuration

All runtime URLs come from `PUBLIC_*` env vars with production fallbacks in
`src/lib/config.ts` (so the app builds/runs with no `.env`). See `.env.example`:

| Var | Purpose |
| --- | --- |
| `PUBLIC_API_BASE` | Read-only Cloudflare Worker API base |
| `PUBLIC_RENDER_CHAT_URL` | Chat assistant endpoint |
| `PUBLIC_MGMT_LOGIN_URL` | Management portal login |
| `PUBLIC_SITE_URL` | Canonical site URL (SEO/manifest) |

Set these in **Vercel → Project Settings → Environment Variables** for
production, or a local `.env` for development.

## API contract (unchanged backend)

- `GET ?action=dataVersion` → `{ v }` — cheap cache-busting token.
- `GET ?action=portalData&v=<v>` → `{ users, committee, collections, expenses,
  loans, guarantors, generatedFiles, loanConsents }` (+ optional `stale`).
- `GET ?action=activePopups` → optional popups.
- `POST ?action=logError` → best-effort client error reporting.

Validation is **soft**: unknown columns pass through, malformed sections degrade
to empty arrays, and a failed fetch falls back to the last saved snapshot marked
`stale` — the portal never crashes a visitor over API shape drift.

## Financial calculations (match the existing portals exactly)

Ported verbatim from `Public/frontend-v3`:

```
Current Year Collection = Σ parseAmt(collection.Amount)          (year-filtered)
Past Loan Returned       = Σ (principal + principal·(rate/100)·tenure)
                           (per-month simple interest; per-year uses year-1 loans)
Total Budget             = Collection + Past Loan Returned
Total Expense            = Σ parseAmt(expense.Amount)             (year-filtered)
Net Surplus              = Total Budget − Total Expense
```

Derived for the dashboard (from the real figures above, not invented):

```
% Utilized      = Total Expense / Total Budget × 100   (clamped 0–100)
Still Available = Total Budget − Total Expense
```

## Contributor ranking (Top 5)

There is **one** contributor showcase: **Contributors {year} — Live Scroll** on
the home page. It shows the complete per-person contribution dataset for the
selected year, auto-scrolling left→right (swipe / prev-next / pause supported).

Ranking uses **competition ("standard") ranking** computed live from real
amounts — equal amounts share a rank and positions skip: `1, 1, 3, 4, 4, 6, …`.
Only ranks **1–5** get the crown / gold / “Top 5” treatment; everyone else has
no rank, medal or badge. Change the data and the ranking updates automatically.

## Year filter

The header year selector drives every year-scoped view: financial overview,
contributors + live scroll, summary stats, expenses, loans, committee and
downloads. An **All Years** (lifetime) option is included.

## Accessibility & performance

- Semantic HTML, keyboard navigation, visible focus rings, ARIA labels, large
  mobile touch targets, good contrast in both themes.
- `prefers-reduced-motion` disables the live background, count-ups and ticker.
- Zero heavy dependencies; route-level code splitting; lazy imagery; debounced
  search; PWA offline shell (network-first for API, cache-first for assets).
- The "live" Chhath background is layered CSS + a ~1 KB SVG silhouette (no video,
  no large photos) — a deliberate choice for excellent Android/low-bandwidth
  performance. To swap in a photographic background later, drop an optimized
  WebP/AVIF into `static/` and add it as a lazy layer in `LiveBackground.svelte`.

## Icons

PWA icons in `static/icons/` are generated from `static/logo.svg` by
`scripts/gen-icons.mjs` (uses `sharp` ad-hoc; not a committed dependency). Re-run
with `node scripts/gen-icons.mjs` if the logo changes.

## Project structure

```
src/
  lib/
    api/       schema.ts (Zod) · client.ts (fetch+cache) · derive.ts (pure calcs) · derive.test.ts
    components/ Header, BottomNav, LiveBackground, FinancialOverview, SummaryCards,
                LiveScroll, ContributorCard/Detail, DecadeBanner, Chatbot, states…
    stores/    theme.ts · lang.ts · portal.ts (data + year)
    utils/     format.ts · drive.ts · ranking.ts
    config.ts · i18n.ts (en/hi)
  routes/      / · /contributors · /expenses · /loans · /committee · /downloads · /privacy · /terms
```
