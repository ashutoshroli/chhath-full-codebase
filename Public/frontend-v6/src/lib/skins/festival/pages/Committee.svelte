<script lang="ts">
  import { Phone, MapPin, LogIn } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { committeeForYear } from '$lib/api/derive';
  import { initials } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { CARD } from '../fest';
  import { mgmtLoginUrl } from '$lib/api/client';

  let loading = $derived($portalState.status === 'loading');
  let members = $derived(committeeForYear($portalState.data, $year));
  const nameOf = (m: { name: string; nameHindi: string }) => ($lang === 'hi' && m.nameHindi ? m.nameHindi : m.name);
  const roleOf = (m: { role: string; roleHindi: string; designation: string; designationHindi: string }) =>
    $lang === 'hi' ? m.roleHindi || m.designationHindi || m.role || m.designation || $tr('member') : m.role || m.designation || $tr('member');
  const villageOf = (m: { village: string; villageHindi: string }) => ($lang === 'hi' && m.villageHindi ? m.villageHindi : m.village);
</script>

<svelte:head><title>{$tr('active_committee')} — {$tr('app_title')}</title></svelte:head>

<div class="mb-4 flex items-center justify-between gap-3">
  <h1 class="text-xl font-black text-[rgb(var(--fest-ink))]">{$tr('active_committee')}</h1>
  <a
    href={mgmtLoginUrl}
    target="_blank"
    rel="noopener"
    class="inline-flex flex-none items-center gap-1.5 rounded-lg bg-[rgb(var(--accent))] px-3 py-2 text-sm font-black text-white transition hover:brightness-110 active:scale-95"
  >
    <LogIn class="h-4 w-4" aria-hidden="true" />
    {$tr('login')}
  </a>
</div>
{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="grid gap-3 sm:grid-cols-2">{#each Array(6) as _}<div class="h-16 animate-pulse rounded-2xl bg-[rgb(var(--accent-2)/0.2)]"></div>{/each}</div>
{:else if members.length === 0}
  <div class="{CARD} p-8 text-center text-[rgb(var(--fest-ink)/0.6)]">{$tr('no_committee')}</div>
{:else}
  <div class="grid gap-3 sm:grid-cols-2">
    {#each members as m, i (m.seed + '-' + i)}
      <div class="{CARD} flex items-center gap-3 p-4">
        <span class="grid h-11 w-11 flex-none place-items-center rounded-full bg-[rgb(var(--accent))] text-base font-black text-[rgb(var(--accent-2))] ring-2 ring-[rgb(var(--accent-2)/0.5)]">{initials(nameOf(m))}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-bold text-[rgb(var(--fest-ink))]">{nameOf(m) || $tr('na')}</div>
          <div class="truncate text-xs font-semibold text-[rgb(var(--accent))]">{roleOf(m)}</div>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.7rem] text-[rgb(var(--fest-ink)/0.6)]">
            {#if villageOf(m)}<span class="inline-flex items-center gap-0.5"><MapPin class="h-3 w-3" />{villageOf(m)}</span>{/if}
            {#if m.mobile}<a href="tel:{m.mobile}" class="inline-flex items-center gap-0.5 hover:text-[rgb(var(--accent))]"><Phone class="h-3 w-3" />{m.mobile}</a>{/if}
          </div>
        </div>
        <span class="flex-none rounded bg-[rgb(var(--accent-2)/0.25)] px-2 py-0.5 text-[0.7rem] font-bold text-[rgb(var(--fest-ink))]">{m.year}</span>
      </div>
    {/each}
  </div>
{/if}
