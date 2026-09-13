<script lang="ts">
  /**
   * A compact, theme-scoped preview of the portal used on the /guide page's
   * theme gallery. The whole card is wrapped in `data-theme="<id>"` (+ the `dark`
   * class for dark themes), so the theme's CSS custom properties from app.css
   * (--page-*, --surface-bg, --surface-alpha, --accent) apply ONLY inside this
   * card — the rest of the page keeps its current theme. Tapping the card applies
   * that theme portal-wide (themeId.select).
   */
  import { Check, Sun, Moon } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { themeId } from '$lib/stores/theme';
  import type { ThemeDef } from '$lib/themes';

  interface Props {
    theme: ThemeDef;
    active: boolean;
  }
  let { theme, active }: Props = $props();

  // Surface fill = the theme's surface colour composited with its alpha, so glass
  // themes read as translucent and flat themes as solid — same tokens the real
  // .surface class uses.
  const surface = 'rgb(var(--surface-bg) / var(--surface-alpha, 1))';
  const accent = 'rgb(var(--accent))';
  const border = 'rgb(var(--surface-border) / var(--surface-border-alpha, 0.15))';
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
    <div
      class="rounded-lg px-2.5 py-2"
      style="background: {surface}; border: 1px solid {border};"
    >
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
          <p class="truncate text-[7px] opacity-70" style="color: rgb(var(--surface-border));">{l}</p>
        </div>
      {/each}
    </div>

    <!-- Contributor list rows -->
    <div class="mt-1.5 rounded-md" style="background: {surface}; border: 1px solid {border};">
      {#each [['GV', 'Govind V.', '₹2,176'], ['AB', 'Aarohi B.', '₹1,167']] as [ini, name, amt], i}
        <div class="flex items-center gap-1.5 px-2 py-1.5 {i === 0 ? 'border-b' : ''}" style="border-color: {border};">
          <span class="grid h-4 w-4 place-items-center rounded-full text-[6px] font-black text-white" style="background: {accent};">{ini}</span>
          <span class="flex-1 truncate text-[8px] font-semibold" style="color: rgb(var(--surface-border));">{name}</span>
          <span class="text-[8px] font-black" style="color: {accent};">{amt}</span>
        </div>
      {/each}
    </div>
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
