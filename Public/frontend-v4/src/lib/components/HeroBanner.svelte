<script lang="ts">
  import { Heart } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
</script>

<section class="relative pb-1 pt-2">
  <p class="font-hand text-2xl font-bold leading-tight text-brand-800 drop-shadow-sm dark:text-brand-100 sm:text-3xl">
    {#each $tr('hero_headline').split('\n') as line}
      <span class="block">{line}</span>
    {/each}
    <Heart class="mt-1 inline h-5 w-5 fill-current text-danger align-middle" aria-hidden="true" />
  </p>
  <p class="mt-2 text-xs font-semibold text-brand-900/70 dark:text-white/70">
    {$tr('hero_sub')}
  </p>
</section>
