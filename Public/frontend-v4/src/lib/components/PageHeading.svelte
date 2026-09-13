<script lang="ts">
  import { year } from '$lib/stores/portal';
  import { tr } from '$lib/stores/lang';
  import { ALL_YEARS } from '$lib/api/derive';
  import type { Component } from 'svelte';

  interface Props {
    icon: Component;
    titleKey: string;
    subtitle?: string;
  }
  let { icon, titleKey, subtitle = '' }: Props = $props();
  let Icon = $derived(icon);
</script>

<div class="mb-3 mt-1 flex items-center gap-3">
  <span class="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-300">
    <Icon class="h-5 w-5" aria-hidden="true" />
  </span>
  <div>
    <h1 class="text-lg font-black leading-tight sm:text-xl">{$tr(titleKey)}</h1>
    <p class="text-xs text-slate-500 dark:text-slate-400">
      {subtitle || ($year === ALL_YEARS ? $tr('all_years') : $year)}
    </p>
  </div>
</div>
