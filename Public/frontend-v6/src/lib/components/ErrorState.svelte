<script lang="ts">
  import { TriangleAlert, RefreshCw } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { refreshPortal } from '$lib/stores/portal';

  let busy = $state(false);
  async function retry() {
    busy = true;
    await refreshPortal();
    busy = false;
  }
</script>

<div class="surface mx-auto my-10 max-w-md p-8 text-center">
  <span class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-danger/15 text-danger">
    <TriangleAlert class="h-7 w-7" aria-hidden="true" />
  </span>
  <h2 class="mt-4 text-lg font-black">{$tr('error_title')}</h2>
  <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{$tr('error_help')}</p>
  <button class="btn-primary mx-auto mt-5" onclick={retry} disabled={busy}>
    <RefreshCw class="h-4 w-4 {busy ? 'animate-spin' : ''}" />
    {$tr('retry')}
  </button>
</div>
