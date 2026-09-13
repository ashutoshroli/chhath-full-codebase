<script lang="ts">
  import { ShieldCheck } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { tr } from '$lib/stores/lang';
</script>

<svelte:head>
  <title>Privacy — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={ShieldCheck} titleKey="app_subtitle" subtitle="Privacy Policy" />

<article class="surface space-y-3 p-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
  <p>
    This portal is a read-only public transparency dashboard for {$tr('org_name')}, {$tr('org_location')}.
    It displays contribution, expense, loan and committee records the committee has chosen to make public.
  </p>
  <h2 class="text-base font-bold text-slate-900 dark:text-white">What we show</h2>
  <p>
    Only fields the committee marks as public are displayed. Personal contact details are shown solely where
    the committee has published them (for example, a committee member's mobile number).
  </p>
  <h2 class="text-base font-bold text-slate-900 dark:text-white">Data &amp; caching</h2>
  <p>
    Data is fetched from the committee's public API. Your browser may cache the last-loaded copy locally so the
    portal remains usable offline; this cache stays on your device and is never shared.
  </p>
  <p>
    For corrections or questions about your record, please contact the committee directly.
  </p>
</article>
