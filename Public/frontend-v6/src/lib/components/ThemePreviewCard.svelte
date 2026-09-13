<script lang="ts">
  /**
   * A compact, theme-scoped preview of the portal used on the /guide page's
   * theme gallery. The whole card is wrapped in `data-theme="<id>"` (+ the `dark`
   * class for dark themes), so the theme's CSS custom properties from app.css
   * (--page-*, --surface-bg, --surface-alpha, --accent, --accent-2, --fest-*)
   * apply ONLY inside this card — the rest of the page keeps its current theme.
   * Tapping the card applies that theme portal-wide (themeId.select).
   *
   * The inner mini-portal is NOT one generic template: it mirrors the real
   * layout of the skin the theme actually uses (skinIdForTheme):
   *   • premium / aurora  → avatar "card tile" contributors (rounded stat tiles)
   *   • classic / slate / festival → flat "list row" contributors (no avatar,
   *     name left / amount right), matching their real Contributors section.
   * The #1 contributor ("Ashutosh Chandan") gets the same Top-5 crown treatment
   * the real skin uses; the #2 row ("Sujit Kumar") stays plain.
   */
  import { Check, Sun, Moon, Crown } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { themeId } from '$lib/stores/theme';
  import { skinIdForTheme } from '$lib/skins/skinMap';
  import type { ThemeDef } from '$lib/themes';

  interface Props {
    theme: ThemeDef;
    active: boolean;
  }
  let { theme, active }: Props = $props();

  const skin = $derived(skinIdForTheme(theme.id));
  // Premium + aurora render contributors as avatar card-tiles; the rest use a
  // flat list row (name left, +amount right) with an inline crown.
  const cardStyleContributors = $derived(skin === 'premium' || skin === 'aurora');

  // Surface fill = the theme's surface colour composited with its alpha, so glass
  // themes read as translucent and flat themes as solid — same tokens .surface uses.
  const surface = 'rgb(var(--surface-bg) / var(--surface-alpha, 1))';
  const accent = 'rgb(var(--accent))';
  const ink = 'rgb(var(--surface-border))';
  const border = 'rgb(var(--surface-border) / var(--surface-border-alpha, 0.15))';
  // Gold for the crown / Top-5 badge: festival skins have a real --accent-2 gold
  // token; other skins fall back to a warm amber.
  const gold = $derived(skin === 'festival' ? 'rgb(var(--accent-2, 245 184 64))' : '#F5B840');

  const contributors = [
    { ini: 'AC', name: 'Ashutosh Chandan', amt: '₹2,176', top: true },
    { ini: 'SK', name: 'Sujit Kumar', amt: '₹1,167', top: false }
  ];
</script>

<button
  type="button"
  data-theme={theme.id}
  onclick={() => themeId.select(theme.id)}
  aria-pressed={active}
  aria-label={$tr(theme.labelKey)}
  class:dark={theme.mode === 'dark'}
  class:ring-2={active}
  class="group relative block w-full overflow-hidden rounded-2xl border text-left transition active:scale-[.98]
    {active ? 'border-brand-500 ring-brand-500/40' : 'border-black/10 hover:border-brand-400 dark:border-white/10'}"
>
  <!-- Theme-coloured mini portal -->
  <div
    class="p-2.5"
    style="background-image: linear-gradient(160deg, var(--page-from), var(--page-via, var(--page-from)), var(--page-to, var(--page-from)));"
  >
    <!-- Budget Overview banner -->
    <div class="rounded-lg px-2.5 py-2" style="background: {surface}; border: 1px solid {border};">
      <p class="text-[8px] font-semibold uppercase tracking-wide" style="color: {accent};">Total Budget</p>
      <p class="text-[15px] font-black leading-tight" style="color: {accent};">₹35,919</p>
      <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full" style="background: rgb(var(--surface-border) / 0.25);">
        <div class="h-full rounded-full" style="width: 42%; background: {accent};"></div>
      </div>
    </div>

    <!-- Stat tiles -->
    <div class="mt-1.5 grid grid-cols-3 gap-1.5">
      {#each [['36', 'Contrib.'], ['₹22.6k', 'Collected'], ['₹627', 'Avg']] as [v, l]}
        <div class="rounded-md px-1.5 py-1" style="background: {surface}; border: 1px solid {border};">
          <p class="truncate text-[9px] font-black" style="color: {accent};">{v}</p>
          <p class="truncate text-[7px] opacity-70" style="color: {ink};">{l}</p>
        </div>
      {/each}
    </div>

    <!-- Contributors — layout mirrors the real skin -->
    {#if cardStyleContributors}
      <!-- Avatar card-tile rail (premium / aurora) -->
      <div class="no-scrollbar mt-1.5 flex gap-1.5 overflow-hidden">
        {#each contributors as c}
          <div
            class="relative flex w-1/2 shrink-0 flex-col items-center rounded-xl px-1.5 pb-1.5 pt-2.5 text-center"
            style="background: {c.top ? 'rgb(var(--accent) / 0.12)' : surface}; border: 1px solid {c.top ? gold : border};"
          >
            {#if c.top}
              <!-- floating crown, like the real ContributorCard / aurora tile -->
              <span class="absolute -top-1.5 left-1/2 -translate-x-1/2" style="color: {gold};">
                <Crown class="h-3 w-3 fill-current" aria-label="Top 1" />
              </span>
            {/if}
            <span class="grid h-6 w-6 place-items-center rounded-full text-[8px] font-black text-white" style="background: {accent};">{c.ini}</span>
            <span class="mt-1 line-clamp-1 w-full text-[8px] font-bold" style="color: {ink};">{c.name}</span>
            <span class="text-[8px] font-black" style="color: {accent};">{c.amt}</span>
            {#if c.top}
              <span class="mt-0.5 rounded-full px-1 py-px text-[6px] font-black uppercase tracking-wide" style="background: rgb(var(--accent) / 0.18); color: {gold};">{$tr('top5')}</span>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <!-- Flat list rows (classic / slate / festival): name left, +amount right, no avatar -->
      <div class="mt-1.5 rounded-md px-2 py-0.5" style="background: {surface}; border: 1px solid {border};">
        {#each contributors as c, i}
          <div class="flex items-center justify-between gap-1.5 py-1.5 {i === 0 ? 'border-b border-dashed' : ''}" style="border-color: {border};">
            <span class="flex min-w-0 flex-1 items-center gap-1 text-[8px] font-semibold" style="color: {ink};">
              {#if c.top}
                <Crown class="h-2.5 w-2.5 flex-none fill-current" style="color: {gold};" aria-label="Top 1" />
              {/if}
              <span class="truncate">{c.name}</span>
            </span>
            <span class="text-[8px] font-black" style="color: {accent};">+{c.amt}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Label footer (uses the page's own theme, not the previewed one) -->
  <div class="flex items-center gap-1.5 bg-white px-2.5 py-1.5 dark:bg-ink">
    {#if theme.mode === 'dark'}
      <Moon class="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
    {:else}
      <Sun class="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
    {/if}
    <span class="min-w-0 flex-1">
      <span class="block truncate text-xs font-bold text-slate-800 dark:text-slate-100">{$tr(theme.labelKey)}</span>
      <span class="block truncate text-[10px] text-slate-400">{$tr(theme.originKey)}</span>
    </span>
    {#if active}
      <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500 text-white" title={$tr('choose_theme')}>
        <Check class="h-3 w-3" />
      </span>
    {/if}
  </div>
</button>
