<script lang="ts">
  import { Phone, MapPin, LogIn } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { committeeForYear } from '$lib/api/derive';
  import { initials } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { mgmtLoginUrl } from '$lib/api/client';

  let loading = $derived($portalState.status === 'loading');
  let members = $derived(committeeForYear($portalState.data, $year));
  const nameOf = (m: { name: string; nameHindi: string }) => ($lang === 'hi' && m.nameHindi ? m.nameHindi : m.name);
  const roleOf = (m: { role: string; roleHindi: string; designation: string; designationHindi: string }) =>
    $lang === 'hi'
      ? m.roleHindi || m.designationHindi || m.role || m.designation || $tr('member')
      : m.role || m.designation || $tr('member');
  const villageOf = (m: { village: string; villageHindi: string }) => ($lang === 'hi' && m.villageHindi ? m.villageHindi : m.village);
</script>

<svelte:head><title>{$tr('active_committee')} — {$tr('app_title')}</title></svelte:head>

<div class="mb-4 flex items-center justify-between gap-3">
  <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-100">{$tr('active_committee')}</h2>
  <a
    href={mgmtLoginUrl}
    target="_blank"
    rel="noopener"
    class="inline-flex flex-none items-center gap-1.5 rounded-lg bg-[#F27A1A] px-3 py-2 text-sm font-bold text-white transition hover:brightness-110 active:scale-95"
  >
    <LogIn class="h-4 w-4" aria-hidden="true" />
    {$tr('login')}
  </a>
</div>

{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="min-h-[200px] space-y-3">{#each Array(5) as _}<div class="skeleton h-16 w-full rounded-xl"></div>{/each}</div>
{:else if members.length === 0}
  <div class="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">{$tr('no_committee')}</div>
{:else}
  <div class="space-y-3">
    {#each members as m, i (m.seed + '-' + i)}
      <div class="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <span class="grid h-11 w-11 flex-none place-items-center rounded-full bg-[#FFEDD5] text-base font-bold text-[#F27A1A] dark:bg-gray-700">
          {initials(nameOf(m))}
        </span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-semibold text-gray-800 dark:text-gray-100">{nameOf(m) || $tr('na')}</div>
          <div class="truncate text-xs font-semibold text-[#F27A1A]">{roleOf(m)}</div>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.7rem] text-gray-500 dark:text-gray-400">
            {#if villageOf(m)}<span class="inline-flex items-center gap-0.5"><MapPin class="h-3 w-3" />{villageOf(m)}</span>{/if}
            {#if m.mobile}<a href="tel:{m.mobile}" class="inline-flex items-center gap-0.5 hover:text-[#F27A1A]"><Phone class="h-3 w-3" />{m.mobile}</a>{/if}
          </div>
        </div>
        <span class="flex-none rounded bg-gray-100 px-2 py-0.5 text-[0.7rem] text-gray-600 dark:bg-gray-700 dark:text-gray-300">{m.year}</span>
      </div>
    {/each}
  </div>
{/if}
