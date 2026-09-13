<script lang="ts">
  import { Heart } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { year } from '$lib/stores/portal';
  import FooterLinks from './FooterLinks.svelte';
</script>

<footer class="mx-auto max-w-6xl px-4 pb-28 pt-8 md:pb-10">
  <div class="surface flex flex-col items-center gap-2 px-4 py-5 text-center sm:flex-row sm:justify-between sm:text-left">
    <div class="flex items-center gap-3">
      <img src="/logo.svg" alt="" class="h-9 w-9" width="36" height="36" />
      <div>
        <p class="text-sm font-bold">{$tr('org_name')}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {$tr('org_location')} · {$year}
        </p>
      </div>
    </div>
    <p class="flex items-center gap-1.5 font-hand text-lg text-brand-600 dark:text-brand-300">
      {$tr('seva_line')}
      <Heart class="h-4 w-4 fill-current text-danger" />
    </p>
  </div>
  <div class="mt-3 text-center text-slate-500 dark:text-slate-400">
    <FooterLinks />
  </div>
</footer>
