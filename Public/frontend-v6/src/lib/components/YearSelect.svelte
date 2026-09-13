<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import { year, years } from '$lib/stores/portal';
  import { tr } from '$lib/stores/lang';
  import { ALL_YEARS } from '$lib/api/derive';

  function onChange(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    year.set(v === ALL_YEARS ? ALL_YEARS : parseInt(v, 10));
  }
</script>

<div class="relative">
  <select
    class="chip appearance-none bg-gradient-to-br from-brand-500 to-brand-600 pr-7 text-white
      dark:from-brand-500 dark:to-brand-600 dark:text-white"
    aria-label={$tr('select_year')}
    value={String($year)}
    onchange={onChange}
  >
    {#each $years as y}
      <option value={String(y)}>{y}</option>
    {/each}
    <option value={ALL_YEARS}>{$tr('all_years')}</option>
  </select>
  <ChevronDown
    class="pointer-events-none absolute right-1.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white"
    aria-hidden="true"
  />
</div>
