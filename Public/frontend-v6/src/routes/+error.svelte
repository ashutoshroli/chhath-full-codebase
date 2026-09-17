<script lang="ts">
  /**
   * A real error page (audit PR-42).
   *
   * There was none, so an unknown path fell through to the SPA fallback and rendered the HOME
   * PAGE. A visitor who mistyped a URL saw the portal and no indication anything was wrong, and
   * a crawler following a stale link indexed the home page's content under the wrong URL.
   *
   * HONEST LIMIT: this is a statically hosted site, so the fallback is served with HTTP 200
   * whatever this component says. `noindex` keeps the wrong URL out of the index, which is the
   * part the app can control; returning a genuine 404 status needs a rule at the host and is
   * written up for the operator in the PR rather than pretended at here.
   */
  import { page } from '$app/stores';
  import { tr } from '$lib/stores/lang';
  import { Home, AlertTriangle } from '@lucide/svelte';

  let status = $derived($page.status);
  let notFound = $derived(status === 404);
</script>

<svelte:head>
  <title>{notFound ? $tr('error_404_title') : $tr('error_generic_title')} — {$tr('app_title')}</title>
  <!-- An error page must never be indexed, whatever status the host returns. -->
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
  <span class="grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/15 text-brand-600 dark:text-brand-300">
    <AlertTriangle class="h-7 w-7" aria-hidden="true" />
  </span>
  <h1 class="text-xl font-black">
    {notFound ? $tr('error_404_title') : $tr('error_generic_title')}
  </h1>
  <p class="text-sm text-slate-600 dark:text-slate-300">
    {notFound ? $tr('error_404_body') : $tr('error_generic_body')}
  </p>
  <a
    href="/"
    class="mt-2 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white"
  >
    <Home class="h-4 w-4" aria-hidden="true" />
    {$tr('error_back_home')}
  </a>
</div>
