# Theme Authoring Guide — Chhath Public Portal (`frontend-v6`)

> **Purpose of this file.** This is a self-contained reference for adding or
> customizing a **theme** in the public portal. Drop this file into any context
> (a new chat, a new developer's hands, an AI agent) and it should contain
> everything needed to design a *new theme* end-to-end — what the portal is,
> what technology it uses, exactly what switches when you change a theme, which
> pages/components/icons exist, and the precise files + steps to add one.
>
> Everything here is **frontend-only**. Themes do not touch the backend, the
> database, migrations, or the cache.

---

## 1. What is this portal? (domain context)

A **public, read-only transparency portal** for the *Navyuvak Chhath Puja
Samiti* (Shaharpura, Gardih) — a community that organises the Chhath Puja
festival. Tagline: **"Faith • Unity • Transparency" / "Seva Hi Sanskriti Hai"**.

It shows the community, in full transparency, where money comes from and goes:

| Section | Route | What it shows |
|---|---|---|
| **Home** | `/` | Headline financials + a live contributor rail/dashboard |
| **Expenses** | `/expenses` | Year-wise expense records |
| **Loans** | `/loans` | Loans taken / past loan returned (with interest) |
| **Committee** | `/committee` | Committee members for a year |
| **Downloads** | `/downloads` | Per-person receipts / certificates (Google Drive) |
| **Our Journey** | `/decade` | The "10 Years of Chhath" story + live decade stats |
| **Contributors** | `/contributors` | Full searchable/sortable contributor directory |
| **Privacy / Terms** | `/privacy`, `/terms` | Static legal pages |

- **Bilingual**: English + Hindi (toggle in the header). All UI strings live in
  `src/lib/i18n.ts`; data rows carry `*_hi` columns.
- **Data source**: a Cloudflare Worker public API (read-only), loaded once into a
  store (`src/lib/stores/portal.ts`) with a **year selector**. Financials are
  derived client-side in `src/lib/api/derive.ts` (contributors, totals, decade
  stats, etc.).
- Main data concepts: **contributors** (money / material / service, ranked),
  **expenses**, **loans**, **committee**, **downloads**, **journey entries** (DB
  driven story), **profile photos**, and computed **financial totals** (budget,
  collection, expense, % utilized, net surplus).

---

## 2. Tech stack

| Concern | Tech |
|---|---|
| Framework | **SvelteKit ^2.8** + **Svelte 5** (runes: `$props`, `$state`, `$derived`, `$effect`), TypeScript |
| Build | **Vite ^5.4**, **`@sveltejs/adapter-static`** — a fully static SPA (`fallback: 200.html`, `prerender = true`) |
| Styling | **Tailwind CSS ^3.4** with **`darkMode: 'class'`** (manual light/dark) + CSS custom properties for per-theme tints |
| Icons | **`@lucide/svelte`** (Lucide) — the only UI icon set |
| PWA | **`@vite-pwa/sveltekit`** — installable, offline (NetworkFirst API, CacheFirst fonts). Manifest name: "Chhath Public Portal" |
| Data validation | **`zod`** (API schema) |
| Tests | **Vitest** (`src/**/*.{test,spec}.ts`) |
| Fonts | `Inter` (sans) + `Kalam` (hand-drawn), loaded non-blocking in `app.html` |

Tailwind brand palette (in `tailwind.config.ts`): `brand` ramp 50–900 (base
`#F27A1A` saffron), `gold #F5B840`, `ink #0b1020`, `navy`, status colors. Custom
shadows `card` / `card-dark` / `glow`; animations `sunrise`, `floatUp`, `ripple`,
`pulseDot`, `marquee`, `aurora`; extra breakpoint `xs: 400px`.

---

## 3. The key idea: **Theme** vs **Skin**

This is the single most important concept. There are **two** layers:

- **Theme** = a *palette*. An entry in `src/lib/themes.ts` (id + metadata +
  swatch) whose visual tokens live in a `[data-theme='<id>']` block in
  `src/app.css`. A theme only sets **colors / background / surface look**.

- **Skin** = a *layout*. A bundle of Svelte components in
  `src/lib/skins/<skinId>/` — a `Shell` (header/nav/footer) **plus one component
  per page**. A skin decides the whole structure of every page.

- **Theme → Skin map** (`src/lib/skins/skinMap.ts`) wires them: **many themes
  can share one skin**, only re-tinting it via CSS tokens.

> **Switching a theme swaps the ENTIRE portal look** — the shell and every page
> component — not just colors, because the theme id also selects a skin.

### 3.1 Current themes (13) — `src/lib/themes.ts`

Each `ThemeDef` has: `id` (persisted), `labelKey` (i18n name), `mode`
(`light`|`dark`, drives the `dark` class), `originKey` (i18n caption), `swatch`
(`[bg, surface, accent]` preview chip).

| Theme id | Mode | i18n label key | Skin | Notes |
|---|---|---|---|---|
| `sunrise` | light | `theme_sunrise` | premium | default light |
| `warm-night` | dark | `theme_warm_night` | premium | default dark |
| `classic-light` | light | `theme_classic_light` | classic | flat, clean |
| `slate-light` | light | `theme_slate_light` | slate | enterprise |
| `slate-dark` | dark | `theme_slate_dark` | slate | enterprise dark |
| `midnight` | dark | `theme_midnight` | premium | |
| `aurora` | dark | `theme_aurora` | aurora | glass + animated mesh + bento |
| `festival` | light | `theme_festival` | festival | maroon + gold, festive |
| `neon-noir` | dark | `theme_neon_noir` | aurora | Gen-Z: black + neon cyan |
| `cyber-lime` | dark | `theme_cyber_lime` | aurora | Gen-Z: black + electric lime |
| `sunset-vapor` | dark | `theme_sunset_vapor` | aurora | Gen-Z: indigo→pink→orange |
| `mint-frost` | dark | `theme_mint_frost` | aurora | Gen-Z: dark glass + mint/teal |

Also in `themes.ts`: `DEFAULT_LIGHT = 'sunrise'`, `DEFAULT_DARK = 'warm-night'`,
`THEME_KEY = 'cpm_public_v5_theme'` (localStorage), and helpers `getTheme`,
`isValidThemeId`, `pickDefaultTheme`.

### 3.2 Skins (5) — `src/lib/skins/`

| Skin id | Folder | Look |
|---|---|---|
| `premium` | `skins/premium/` | Default — hero banner, financial overview, summary cards, live scroll |
| `classic` | `skins/classic/` | v1 — flat saffron + off-white, simple inline lists |
| `slate` | `skins/slate/` | v2 — enterprise "master calculation" grid + bordered lists |
| `aurora` | `skins/aurora/` | v6 — glassmorphism, animated aurora mesh, bento-grid dashboard |
| `festival` | `skins/festival/` | v6 — deep maroon + marigold gold, decorated cards |

Each skin folder exports a `Skin` object (contract in `src/lib/skins/types.ts`):

```ts
{ id, Shell, pages: { Home, Expenses, Loans, Committee, Downloads, Decade } }
```

`aurora` also has `AuroraBg.svelte` + `glass.ts` (shared `GLASS` class);
`festival` has `fest.ts` (shared `CARD` class).

### 3.3 Theme → Skin map — `src/lib/skins/skinMap.ts`

```ts
THEME_SKIN_ID = {
  sunrise: 'premium', 'warm-night': 'premium', midnight: 'premium',
  'classic-light': 'classic',
  'slate-light': 'slate', 'slate-dark': 'slate',
  aurora: 'aurora', festival: 'festival',
  // Gen-Z themes reuse the aurora skin, only re-tinting via tokens:
  'neon-noir': 'aurora', 'cyber-lime': 'aurora',
  'sunset-vapor': 'aurora', 'mint-frost': 'aurora',
};
DEFAULT_SKIN_ID = 'premium';   // fallback for any unmapped theme
```

`src/lib/skins/registry.ts` resolves a skin id to the real `Skin` object and
exposes `skinForTheme(themeId)`.

---

## 4. What actually switches on theme change — CSS tokens (`src/app.css`)

A `:root[data-theme='<id>']` block may set these **CSS custom properties**.
Surface/accent colors are **rgb triplets** (e.g. `242 122 26`) so alpha can be
composed as `rgb(var(--accent) / 0.5)`.

| Token | Controls |
|---|---|
| `--surface-bg` | Card/surface fill color (used by `.surface`) |
| `--surface-alpha` | Surface fill opacity (1 = flat, <1 = glassy) |
| `--surface-border` | Surface border color |
| `--surface-border-alpha` | Surface border opacity |
| `--accent` | Accent color — buttons, highlights, the chat orb glow |
| `--page-from` / `--page-via` / `--page-to` | The 3-stop sky gradient in `LiveBackground.svelte` |
| `--page-sun` | `1`/`0` — whether `LiveBackground` shows the sunrise sun glow |
| `--aurora-bg`, `--aurora-b1..b4` | Base + 4 mesh-blob colors for `AuroraBg.svelte` (aurora-skin themes only) |
| `--chat-orb-3d` | `1` = turn the flat chat launcher into a glossy **3D orb** (see §7) |
| `--marquee-duration` | Speed of the `LiveScroll` ticker marquee |

**`@layer components`** in `app.css` defines the theme-reading utility classes:
`.surface`, `.chip`, `.btn-primary`, `.skeleton`, `.no-scrollbar`,
`.chat-orb*`, `.chat-panel*`. A `prefers-reduced-motion` block disables all
animation globally.

**The `data-theme` + `dark` mechanism**: both are set on `<html>`
(`document.documentElement`):
- `data-theme="<id>"` selects the palette block.
- `classList.toggle('dark', theme.mode === 'dark')` drives Tailwind `dark:`
  variants.

---

## 5. Theme-switch flow (how selection is applied + remembered)

- **Store**: `src/lib/stores/theme.ts` — `themeId` writable with `.select(id)`;
  `apply(id)` sets `data-theme`, toggles `dark`, writes
  `localStorage['cpm_public_v5_theme']`. On load, reads the saved id (validated)
  else `pickDefaultTheme(devicePrefersDark())`. Exports `activeTheme` (derived).
- **Skin swap**: `src/lib/stores/skin.ts` — `activeSkin = derived(themeId, skinForTheme)`.
  `+layout.svelte` renders `$activeSkin.Shell` and each route renders
  `$activeSkin.pages.<Name>`, keyed by skin id with a ~220ms cross-fade.
- **First-visit default**: `pickDefaultTheme(prefersDark, rnd)` → prefers-dark ⇒
  `warm-night`, prefers-light ⇒ `sunrise`, no signal ⇒ random. This logic is
  **duplicated** in the no-flash inline script in **`src/app.html`** (so there's
  no light→dark flicker before hydration).
- **Picker UI**: `src/lib/components/ThemeGallery.svelte` (a `Modal`) renders
  every `THEMES` entry as a preview card from `swatch[]`, with a `Check` on the
  active one and `Sun`/`Moon` by mode; clicking calls `themeId.select(id)`.
  Opened via the header `Palette` button (`openThemeGallery()` in
  `src/lib/stores/ui.ts`); rendered once in `+layout.svelte`.

---

## 6. Pages & components inventory

### 6.1 Routes (`src/routes/`)
Skin-delegating (render `$activeSkin.pages.X`): `/`, `/expenses`, `/loans`,
`/committee`, `/downloads`, `/decade`. Skin-agnostic: `/contributors`,
`/privacy`, `/terms`.

### 6.2 Per-skin page components
Every skin provides: `Shell.svelte` + `pages/{Home, Expenses, Loans, Committee,
Downloads, Decade}.svelte`. The `Shell` = header (logo, bilingual title, nav,
`Palette` theme button, `Languages` toggle, `YearSelect`), a status banner, the
`<main>` slot, footer, and (on mobile) a bottom nav.

### 6.3 Shared components (`src/lib/components/`) — used across skins
| Component | Renders |
|---|---|
| `SummaryCards` | Contributors / Total collected / Average / "View list" cards (`CountUp`) |
| `LiveScroll` | Auto-scrolling infinite contributor ticker (pause on hover, swipe, prev/next) |
| `ContributorCard` | Avatar (photo or gradient initials) + name + amount + material/service badges + `Crown` |
| `ContributorsListModal` | Modal with **Contributors / Resold** tabs |
| `ContributorDetail` | One contributor's detail popup |
| `DecadeBanner` | Home → `/decade` teaser (live range + tagline) |
| `Chatbot` | Floating assistant (posts to the Render chat endpoint) — the **3D orb**, see §7 |
| `Modal` | Accessible modal (scroll-lock, Esc close, bottom-sheet on mobile) |
| `Header` / `Footer` | Used by non-aurora skins |
| `LiveBackground` | CSS sunrise/water/diya, driven by `--page-*` tokens |
| `AuroraBg` | Animated mesh (aurora skin), driven by `--aurora-*` tokens |
| `AnnouncementPopup` | Backend-driven popup, once per 24h |
| others | `StatusBanner`, `YearSelect`, `BottomNav`, `PageHeading`, `FinancialOverview`, `HeroBanner`, `ProgressRing`, `CountUp`, `SkeletonList`, `EmptyState`, `ErrorState`, `ThemeGallery` |

`src/lib/components/nav.ts` exports `NAV_ITEMS` (the 5 primary nav entries with
their icons).

---

## 7. Icons (`@lucide/svelte`)

Imported as named components, rendered with Tailwind size classes and usually
`aria-hidden`:

```svelte
import { Users } from '@lucide/svelte';
<Users class="h-5 w-5 text-violet-300" aria-hidden="true" />
```

Representative icons per area:

| Area | Icons |
|---|---|
| Nav (`nav.ts`) | `Home`, `ReceiptText`, `Landmark`, `Users`, `Download` |
| Theme gallery | `Check`, `Sun`, `Moon`, `Palette` |
| Shell / header | `Palette`, `Languages`, `Heart` |
| Home tiles | `Users`, `Landmark`, `TrendingUp`, `TrendingDown`, `Crown` |
| Summary cards | `Users`, `PiggyBank`, `BarChart3`, `ListChecks`, `ChevronRight` |
| Live scroll | `ChevronLeft`, `ChevronRight`, `Pause`, `Play`, `Radio` |
| Chatbot | `MessageCircle`, `X`, `Send`, `Loader2` |
| Decade | `Trophy`, `ArrowRight`, `Info`, `Sunrise`, `ShieldCheck`, `Sparkles` |
| Legal | `ShieldCheck`, `FileText` |

**Chat orb (the "3D" launcher):** on `--chat-orb-3d: 1` themes (aurora, festival,
neon-noir, cyber-lime, sunset-vapor, mint-frost) the launcher is a glossy layered
orb (radial-gradient sphere + `.chat-orb__gloss` highlight + accent glow + float
animation) and the open chat panel gets an accent header wash + glow; on all
other themes it's a flat accent circle. Pure CSS — no library.

---

## 8. ✅ How to add a NEW theme — end-to-end checklist

The four Gen-Z themes (`neon-noir`, `cyber-lime`, `sunset-vapor`, `mint-frost`)
are the reference example: they **reuse the `aurora` skin** and differ **only by
CSS tokens**. Follow the same recipe for a re-tinted theme.

### Case A — new theme that REUSES an existing skin (recommended, low-risk)

1. **`src/lib/themes.ts`** — add a `ThemeDef` to the `THEMES` array:
   ```ts
   {
     id: 'my-theme',
     labelKey: 'theme_my_theme',
     mode: 'dark',                // or 'light' — drives the `dark` class
     originKey: 'theme_origin_genz',   // or a new caption key
     swatch: ['#0a0f1e', '#141b30', '#7c5cff']  // [bg, surface, accent] preview
   }
   ```

2. **`src/app.css`** — add a token block (copy a Gen-Z block and re-tint):
   ```css
   :root[data-theme='my-theme'] {
     --surface-bg: 20 27 48;
     --surface-alpha: 0.6;
     --surface-border: 255 255 255;
     --surface-border-alpha: 0.12;
     --accent: 124 92 255;             /* rgb triplet */
     --page-from: #0a0f1e; --page-via: #141b30; --page-to: #241141;
     --page-sun: 0;
     /* aurora-skin themes: mesh colors */
     --aurora-bg: #0a0f1e;
     --aurora-b1: #7c5cff; --aurora-b2: #22d3ee;
     --aurora-b3: #ff5db1; --aurora-b4: #2dd4bf;
   }
   ```
   If it's a glass/3D look, add `[data-theme='my-theme']` to the grouped
   `--chat-orb-3d`, `.chat-orb`, `.chat-orb__gloss/__icon`, `.chat-panel*` rules.

3. **`src/lib/skins/skinMap.ts`** — map the theme to a skin:
   ```ts
   'my-theme': 'aurora',   // reuse the aurora layout → NO new components needed
   ```

4. **`src/lib/i18n.ts`** — add the label key in **both** `en` and `hi`:
   ```ts
   theme_my_theme: 'My Theme',   // en block
   theme_my_theme: 'मेरी थीम',    // hi block
   ```
   (Reuse an existing `theme_origin_*` caption, or add a new one in both blocks.)

5. **`src/app.html`** — add the id to the no-flash inline script's `LIGHT`/`DARK`
   list (comment there says *"Must mirror src/lib/themes.ts"*) so first paint is
   correct.

Done. `ThemeGallery`, the store, the skin registry, and every page pick it up
automatically because they read `THEMES` / `THEME_SKIN_ID` / the CSS tokens
dynamically. **No page/component code changes are needed.**

### Case B — new theme with a genuinely NEW layout (higher effort)

Do steps 1, 2, 4, 5 above, then instead of reusing a skin:

6. Create `src/lib/skins/<skinId>/` with `Shell.svelte`, a `pages/` folder
   containing all six page components (`Home, Expenses, Loans, Committee,
   Downloads, Decade`), and an `index.ts` exporting the `Skin` object per
   `src/lib/skins/types.ts`.
7. Add `<skinId>` to the `SkinId` union in `src/lib/skins/skinMap.ts` and
   register the skin in `src/lib/skins/registry.ts`.
8. Map `'my-theme': '<skinId>'` in `THEME_SKIN_ID`.

All page components read the SAME derived data from `src/lib/api/derive.ts`
(`computeFinancials`, `computeSummary`, `rankedContributors`, `contributorTags`,
`decadeStats`, `journeyEntries`, `journeyTagline`, …) — a new skin only changes
*layout/markup*, never the data.

---

## 9. Files you will touch (quick map)

| File | Role |
|---|---|
| `src/lib/themes.ts` | Theme registry (add the `ThemeDef`) |
| `src/app.css` | Per-theme `[data-theme]` CSS tokens (+ chat-orb / aurora rules) |
| `src/lib/skins/skinMap.ts` | `THEME_SKIN_ID` mapping (+ `SkinId` union for a new skin) |
| `src/lib/i18n.ts` | `theme_<id>` label (en + hi) + `theme_origin_*` caption |
| `src/app.html` | No-flash inline script LIGHT/DARK list |
| `src/lib/skins/registry.ts` | Only for a brand-new skin |
| `src/lib/skins/<skinId>/` | Only for a brand-new skin (Shell + 6 pages + index) |

## 10. Verify before shipping

```bash
cd Public/frontend-v6
npm run check   # svelte-check — must be 0 errors
npm test        # vitest — includes a skin-registry coverage test:
                # EVERY theme must map to a known skin in THEME_SKIN_ID
npm run build   # static build must succeed
```

> **Important test:** `src/lib/api/derive.test.ts` has a *"skin registry
> coverage"* test asserting every theme in `THEMES` has an entry in
> `THEME_SKIN_ID`. If you add a theme but forget the skin map, this test fails —
> that's your safety net.

Then deploy: `npm run build && npx vercel --prod` (theme changes are frontend
only — no backend/DB/cache work).
