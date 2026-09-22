<script lang="ts">
  /**
   * Theme gallery — opens from the header's theme icon. Shows every available
   * portal theme as a live mini-preview card; tapping one applies it instantly
   * and persists the choice (so a returning user keeps it).
   */
  import { Check, Sun, Moon } from '@lucide/svelte';
  import Modal from './Modal.svelte';
  import { ALL_THEMES } from '$lib/themes';
  import { themeId } from '$lib/stores/theme';
  import { tr } from '$lib/stores/lang';

  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();
</script>

<Modal {open} {onclose} title={$tr('choose_theme')}>
  <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">{$tr('choose_theme_help')}</p>

  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
    {#each ALL_THEMES as theme}
      {@const active = $themeId === theme.id}
      <button
        type="button"
        onclick={() => themeId.select(theme.id)}
        aria-pressed={active}
        class="group relative overflow-hidden rounded-2xl border-2 text-left transition active:scale-[.98]
          {active
            ? 'border-brand-500 ring-2 ring-brand-500/30'
            : 'border-black/10 hover:border-brand-400 dark:border-white/10'}"
      >
        <div class="relative h-24 w-full" style="background-image: linear-gradient(135deg, {theme.swatch[0]}, {theme.swatch[0]});">
          <div class="absolute inset-0" style="background-image: linear-gradient(160deg, {theme.swatch[0]} 0%, {theme.swatch[0]} 100%);"></div>
          <div class="absolute left-2 right-2 top-2 h-8 rounded-lg shadow" style="background: {theme.swatch[1]}; border: 1px solid rgba(0,0,0,.06);"></div>
          <div class="absolute left-2 top-3.5 h-1.5 w-10 rounded-full" style="background: {theme.swatch[2]};"></div>
          <div class="absolute bottom-2 left-2 flex gap-1">
            <span class="h-4 w-8 rounded" style="background: {theme.swatch[2]};"></span>
            <span class="h-4 w-8 rounded" style="background: {theme.swatch[1]}; border:1px solid rgba(0,0,0,.08);"></span>
          </div>
          {#if active}
            <span class="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-white shadow">
              <Check class="h-4 w-4" />
            </span>
          {/if}
        </div>

        <div class="flex items-center gap-1.5 px-2.5 py-2">
          {#if theme.mode === 'dark'}
            <Moon class="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          {:else}
            <Sun class="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          {/if}
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-bold">{$tr(theme.labelKey)}</span>
            <span class="block truncate text-[10px] text-slate-400">{$tr(theme.originKey)}</span>
          </span>
        </div>
      </button>
    {/each}
  </div>
</Modal>
