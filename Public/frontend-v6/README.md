# Chhath Puja Transparency Portal — frontend-v6

A **skin-based multi-portal** for Navyuvak Chhath Puja Samiti (Shaharpura,
Gardih). Selecting a theme from the gallery swaps the **entire portal** — its
layout, chrome and every page — not just the colours. All skins run on **one
shared data layer**, so business logic is never duplicated.

> Self-contained under `Public/frontend-v6/`. The existing frontends
> (`frontend`, `frontend-v2`, `frontend-v3`, `frontend-v4`, `frontend-v5`) and
> the backend / API / Cloudflare Worker are **untouched**. v6 only reads the
> documented public API.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | SvelteKit 2 + Svelte 5 (runes) + TypeScript |
| Rendering | `@sveltejs/adapter-static` (static, `200.html` SPA fallback) |
| UI | Tailwind CSS (`darkMode: 'class'`) + per-theme CSS variables |
| Icons | Lucide (`@lucide/svelte`) |
| Validation | Zod (soft-validates the API payload) |
| Caching | client-side cache + localStorage snapshot + `stale` fallback |
| PWA | manifest + maskable icons + offline app-shell |

Backend / database / Worker: **UNCHANGED.**

## Skins & themes

A **skin** is a full-portal look (Shell + 6 pages). A **theme** is a named entry
in the gallery that selects a skin and a palette.

| Theme (gallery) | Skin | Mode | Look |
| --- | --- | --- | --- |
| Sunrise | premium | light | v4/v5 warm-glass, live Chhath background |
| Warm Night | premium | dark | warm-glass, dusk palette |
| Midnight | premium | dark | deep navy + gold |
| Classic Light | classic | light | v3 look: dark budget card, 2 stat boxes, vertical list |
| Slate Light | slate | light | v2 enterprise: 5-column budget grid, bordered cards |
| Slate Dark | slate | dark | enterprise, dark slate |
| Aurora | aurora | dark | **new** — glassmorphism, animated aurora mesh, bento grid |
| Festival | festival | light | **new** — maroon + marigold gold, celebratory |

## How theme selection works

- The header's theme (palette) icon opens the **Theme Gallery**; tapping a card
  applies it instantly and persists it (`localStorage: cpm_public_v5_theme`).
- **Returning visitor** with a saved theme → that theme.
- **First-time visitor** → device `prefers-color-scheme` picks the matching
  default; if the device gives no signal → a random light/dark default.
- A **no-flash inline script** in `app.html` applies `data-theme` + the `dark`
  class before first paint (no flicker), mirroring `src/lib/themes.ts`.

## Architecture

```
src/lib/
  api/        schema.ts (Zod) · client.ts (fetch+cache) · derive.ts (pure calcs) · derive.test.ts
  stores/     portal.ts (data+year) · lang.ts · theme.ts (themeId) · skin.ts (activeSkin) · ui.ts
  themes.ts   the gallery theme list + default-picker
  skins/
    types.ts      the Skin contract (Shell + pages)
    skinMap.ts    pure themeId -> skinId map (unit-tested)
    registry.ts   resolves skinId -> Skin component bundle
    premium/  classic/  slate/  aurora/  festival/   (each: Shell.svelte + pages/*.svelte)
  components/ shared, skin-agnostic UI (Modal, Chatbot, AnnouncementPopup, ThemeGallery, states, YearSelect, nav)
  utils/      format.ts · drive.ts · ranking.ts
src/routes/   thin — each +page renders `activeSkin.pages.X`; +layout renders `activeSkin.Shell`
```

Every skin's pages call the **same** derive functions (`computeFinancials`,
`rankedContributors`, `expenseItems`, `loanItems` with guarantors,
`committeeForYear`, `downloadsForPerson`, …), so the numbers, the Top-5 crown /
entry-order rule, resell exclusion and material/service handling are identical
across all skins.

## Add a new skin (recipe)

1. Create `src/lib/skins/<name>/` with `Shell.svelte` + `pages/{Home,Expenses,Loans,Committee,Downloads,Decade}.svelte` (reuse the shared derive functions and stores).
2. Export it from `src/lib/skins/<name>/index.ts` (`export const <name>Skin: Skin = {...}`).
3. Add a theme entry in `src/lib/themes.ts` (`id`, `labelKey`, `mode`, `originKey`, `swatch`).
4. Add a `[data-theme='<id>']` CSS-var block in `src/app.css`.
5. Map the theme id → skin id in `src/lib/skins/skinMap.ts`, and register the skin object in `src/lib/skins/registry.ts`.
6. Add the `theme_<id>` label to `src/lib/i18n.ts` (en + hi), and the id to the `LIGHT`/`DARK` maps in `src/app.html`.

The gallery and routing pick it up automatically.

## Scripts

```bash
npm install
npm run dev        # local dev
npm run build      # static production build -> ./build
npm run check      # svelte-check (type + a11y)
npm test           # vitest (financials, ranking, schema, i18n, theme + skin map)
```

Requires Node 18+ (developed on Node 22). CI runs `check`, `test` and `build`
for v6 on every PR (`.github/workflows/ci.yml`, job `public-frontend-v6`).

## Configuration

Four `PUBLIC_*` env vars with production fallbacks in `src/lib/config.ts`
(`.env.example`): `PUBLIC_API_BASE`, `PUBLIC_RENDER_CHAT_URL`,
`PUBLIC_MGMT_LOGIN_URL`, `PUBLIC_SITE_URL`. Set them in Vercel for production.
`vercel.json` pins `outputDirectory: build` and `framework: null`.
