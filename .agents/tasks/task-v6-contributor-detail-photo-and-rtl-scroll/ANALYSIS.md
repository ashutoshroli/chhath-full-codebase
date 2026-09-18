# v6 Contributor detail photo + RTL scroll — baseline analysis

Scope: `Public/frontend-v6` ONLY (the live public site chhath.shaharpura.com,
SvelteKit 2 + Svelte 5 runes + TS + Tailwind static PWA). No backend, no other
frontends. This document grounds FEAT-002 (photo in detail card + tap-to-open in
all skins) and FEAT-003 (make horizontal/RTL scrollers live in all skins). It
changes no product code.

There are **five** skins under `src/lib/skins/`: `aurora`, `classic`,
`festival`, `premium`, `slate`. "All themes" means all five.

## Baseline verification (untouched checkout)

Run from `Public/frontend-v6` with `export PATH="/root/.nvm/versions/node/v22.23.2/bin:$PATH"` (node v22.23.2, npm 11.4.2):

| Gate | Command | Result |
| --- | --- | --- |
| Type/Svelte check | `npm run check` (`svelte-check --fail-on-warnings`) | **PASS** — 0 errors, 0 warnings |
| Tests | `npm test` (`vitest run`) | **PASS** — 13 files, **271 tests passed** |
| Build | `npm run build` (adapter-static + PWA) | **PASS** — built in ~7.5s, PWA precache 95 entries, wrote `build/` |

Notes:
- `npm run check` prints one benign Vite `configLoader: 'native'` warning about
  `import "./src/lib/ratings"` without a file extension in `vite.config.ts`. It
  is NOT a svelte-check warning and does not fail the gate.
- `npm test` output contains lines like `::error::first-load JS for index.html
  is 1000 bytes, over the 999 byte budget` and `references missing files` —
  these are **intentional assertions inside** `firstLoadBytes.test.ts` /
  `critical-path.test.ts` (they feed fixtures to the budget checker and assert it
  reports over-budget). All 271 tests pass.

Baseline is green and matches the recorded expectation (271 tests + build OK).

---

## Requirement 1 — Profile photo: list avatars vs detail-card avatar

### The photo field
Each contributor object carries the photo in `Contributor.photo`:

- `src/lib/api/derive.ts:158-159` — `/** public R2 URL of the member's profile
  photo, or '' for the initials avatar. */  photo: string;`
- `src/lib/api/derive.ts:277` — it is populated from the API row as
  `photo: (user?.Photo ?? '').toString()`. So `photo` is either a public R2 URL
  or `''` (empty string) when there is no photo. The backend already sends it;
  **no API change is needed**.

### Avatar helpers (`src/lib/utils/format.ts`)
- `initials(name)` — line 38, initials for the fallback avatar.
- `avatarGradient(seed)` — line 57, returns `[color0, color1]` used as a
  `linear-gradient(135deg, …)` behind the initials.
- `fmt(n)` — line 13, currency formatting.

### The list-side photo + fallback pattern (the reference)
Two shared components already render the photo with a graceful initials
fallback:

- **`ContributorCard.svelte`** (used inside `LiveScroll`): keeps
  `let photoFailed = $state(false)` and resets it in an effect
  (`$effect(() => { void c.photo; photoFailed = false; })`) so a URL change
  clears the failed flag. Renders
  `{#if c.photo && !photoFailed}<img src={c.photo} … onerror={() => (photoFailed = true)} />{:else}<span …initials avatar…>{/if}`. Image is `h-11 w-11 rounded-full object-cover`.
- **`ContributorsListModal.svelte`**: same idea but for a list, using a
  `SvelteSet<string>` `failedPhotos` keyed by `entry.item.key`
  (`onerror={() => failedPhotos.add(entry.item.key)}`), condition
  `{#if entry.item.photo && !failedPhotos.has(entry.item.key)}`. Image is
  `h-10 w-10 rounded-full object-cover`.
- **`aurora/pages/Home.svelte`** inline rail: also already uses the
  `SvelteSet` `failedPhotos` pattern for its `h-10 w-10` avatars.

### The gap: the detail card has NO photo
- **`ContributorDetail.svelte`** renders ONLY the initials gradient avatar. The
  avatar block (around lines 55-63) is:
  `<span class="grid h-20 w-20 place-items-center rounded-full …" style="background-image: linear-gradient(135deg, {grad[0]}, {grad[1]})">{initials(displayName)}</span>`.
  It does **not** reference `c.photo` anywhere. Confirmed by reading the whole
  file — the only avatar is the initials span.

**Which skins show a photo in the detail card today:** NONE. The detail card is
only mounted by `premium` (see req 2) and even there it shows initials only.

### Proposed approach (FEAT-002)
`ContributorDetail.svelte` is a **shared** component, so fixing it once fixes
every skin that shows it. Add the same photo+fallback pattern used by
`ContributorCard.svelte`: a `photoFailed` `$state` reset via `$effect` on
`c.photo`, an `<img src={c.photo} … onerror={() => (photoFailed = true)}>` when
`c.photo && !photoFailed`, else the existing initials avatar. Keep the current
`h-20 w-20 rounded-full` sizing (add `object-cover`) so the detail avatar keeps
its size. Consider extracting a tiny pure helper (e.g. `shouldShowPhoto(photo,
failed)`) so the decision can be unit-tested as a node test.

---

## Requirement 2 — How/where the Contributor Details card opens and is positioned, per skin

### The detail card component
`ContributorDetail.svelte` is a hand-rolled sheet (NOT built on `Modal.svelte`):
- Backdrop: `fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4` — bottom-sheet on mobile, centered on desktop.
- Panel: `surface w-full max-w-sm rounded-b-none rounded-t-3xl p-5 sm:rounded-3xl`, `role="dialog"`, `aria-modal="true"`, `use:dialog={{ onclose }}` (focus trap, Esc, inert background, scroll-lock, focus return), backdrop click closes, inner click `stopPropagation`.
- **Key difference vs `Modal.svelte`:** `Modal` uses `z-[60]` and a fixed-height
  scroll container: `flex max-h-[85vh] … flex-col overflow-hidden … sm:max-h-[80vh]` with an inner `min-h-0 flex-1 overflow-y-auto` body. `ContributorDetail` has **no `max-h` and no internal scroll region** — a tall card can overflow the viewport with nothing to scroll, and it sits at `z-50` (one below `Modal`'s `z-[60]`).

### Per-skin wiring (who opens the detail card)

| Skin | Contributor UI | Rows tappable? | Mounts `ContributorDetail`? | Opens detail card? |
| --- | --- | --- | --- | --- |
| **premium** | `LiveScroll` (auto rail) + `ContributorsListModal` | Yes (cards in `LiveScroll`) | **Yes** | **Yes** |
| **aurora** | own inline `overflow-x` rail + `ContributorsListModal` | No | No | **No** |
| **classic** | vertical text list (search + tabs) | No | No | **No** |
| **festival** | vertical text list (search + tabs) | No | No | **No** |
| **slate** | vertical text list (search + tabs) | No | No | **No** |

Details:
- **premium** (`premium/pages/Home.svelte`) is the ONLY skin that opens the
  detail card. `<LiveScroll onselect={onSelect} …>` sets `selected` from
  `rankedContributors(...).find(r => r.item.key === key)`, and
  `<ContributorDetail entry={selected} onclose={() => (selected = null)} />` is
  mounted at the bottom. This matches the user's screenshots.
- **aurora** mounts only `ContributorsListModal` (opened from the "contributors"
  stat tile and the rail's "view list" link). Its rail tiles are plain `<div>`s,
  **not** buttons, so tapping a contributor does nothing. `ContributorsListModal`
  rows are also **not** tappable in any skin.
- **classic / festival / slate** render a vertical list of names/amounts with a
  search box and Contributors/Resold tabs. Rows are plain `<div>`s; there is no
  detail card and no `ContributorDetail` import.

**Which skins can open a detail card at all today:** ONLY `premium`.

### The reported mis-anchoring / overlap
Most consistent with `ContributorDetail` lacking `max-h` + internal scroll (a
tall card overflows and appears to overlap surrounding cards) and/or its
`z-50` / `backdrop-blur` stacking, versus the cleaner `Modal.svelte` contract.

### Proposed approach (FEAT-002)
1. Make `ContributorDetail` present as a clean, consistent modal/bottom-sheet —
   centered on desktop, bottom-sheet on mobile — with a proper backdrop, a
   `max-h` + internal `overflow-y-auto` scroll region for tall content, and no
   scroll-jump, aligned with `Modal.svelte` conventions. It must behave
   identically wherever it is opened.
2. Route tap-to-open through **shared** components so every skin benefits:
   - Make `ContributorsListModal` rows open `ContributorDetail` (the list modal
     is the common "Contributors <year>" list the user references; used by aurora
     + premium).
   - Make each skin's own contributor rows/cards open `ContributorDetail`
     (aurora rail tiles → buttons; classic/festival/slate list rows → buttons),
     mounting `ContributorDetail` + `selected` state in each skin's `Home`.
   Keep it minimal and consistent so "sabhi theme me" (all themes) is satisfied.

---

## Requirement 3 — Inventory of horizontal / RTL scrollers, per skin

Searched `src/lib` for `overflow-x`, `translateX`/`translate3d`, `marquee`,
`requestAnimationFrame`, `scrollLeft`, `scrollBy`, and `LiveScroll`. Complete
hit list:

**Horizontal scrollers (only two):**
- **(A) `LiveScroll.svelte` — LIVE auto-scroll marquee.** The real RTL showcase:
  a `requestAnimationFrame` loop drives `el.scrollLeft += SPEED` (`SPEED = 0.6`
  px/frame) so content moves left / cards flow in from the right; a duplicated
  track (`doubled`) wraps at the halfway mark for a seamless infinite loop. Has
  prev/pause/next controls (`nudge()` uses `scrollBy({behavior:'smooth'})`);
  pauses on hover, touch/wheel interaction, hidden tab, and
  `prefers-reduced-motion`. The scroll container is
  `no-scrollbar flex gap-2.5 overflow-x-auto` (line 162). **Used only by
  `premium`.**
- **(B) `aurora/pages/Home.svelte` rail — MANUAL only.** An inline
  `no-scrollbar flex gap-2.5 overflow-x-auto pb-1` rail (line 104). No
  `requestAnimationFrame`, no `scrollLeft`/`scrollBy`, no prev/pause/next, no
  live badge — swipe/drag only.

**Other `requestAnimationFrame` hits (NOT scrollers):**
- `a11y/dialog.ts:152` — one-shot rAF to focus the initial element on dialog
  open.
- `CountUp.svelte:33,35` — number count-up animation, no horizontal scroll.

**No matches** for `translateX`/`translate3d` or `marquee` anywhere in
`src/lib`. So there is no other CSS-transform or marquee-based horizontal
animation to worry about.

### Per-skin horizontal-scroll summary

| Skin | Horizontal scroller | Kind |
| --- | --- | --- |
| **premium** | `LiveScroll` | **Live** (auto RTL + controls) |
| **aurora** | own inline `overflow-x` rail | **Manual** only |
| **classic** | none (vertical list) | — |
| **festival** | none (vertical list) | — |
| **slate** | none (vertical list) | — |

**Which skins have a live vs manual horizontal scroller today:** `premium` =
live; `aurora` = manual; `classic` / `festival` / `slate` = no horizontal
scroller (vertical lists).

### Proposed approach (FEAT-003)
The user wants every horizontal/RTL scroller to be "live" in all themes. Only
`premium` has the live marquee. Cleanest path: have the skins that show a
horizontal contributor rail use the **shared** `LiveScroll` so the live
auto-scroll + controls behave identically — i.e. convert `aurora`'s inline
manual rail to `LiveScroll` (matching its `onselect` / `oncountclick` contract),
keeping premium as-is. For `classic` / `festival` / `slate` there is genuinely no
horizontal scroller (they are vertical lists), so there is nothing to make
"live" there; document that explicitly rather than inventing a rail. All changes
must keep `npm run check` (no new warnings), `npm test`, and `npm run build`
green and stay within the CI JS-size budgets; add jsdom component tests for
LiveScroll behaviour where useful.
