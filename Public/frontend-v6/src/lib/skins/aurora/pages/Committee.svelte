<script lang="ts">
  import { Phone, MapPin, LogIn } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { committeeForYear } from '$lib/api/derive';
  import { initials, avatarGradient } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { GLASS } from '../glass';
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
  <h1 class="text-xl font-bold text-white">{$tr('active_committee')}</h1>
  <a
    href={mgmtLoginUrl}
    target="_blank"
    rel="noopener"
    class="inline-flex flex-none items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-2 text-sm font-bold text-white shadow-glow transition hover:bg-violet-400 active:scale-95"
  >
    <LogIn class="h-4 w-4" aria-hidden="true" />
    {$tr('login')}
  </a>
</div>
{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="grid gap-3 sm:grid-cols-2">{#each Array(6) as _}<div class="h-16 animate-pulse rounded-2xl bg-white/10"></div>{/each}</div>
{:else if members.length === 0}
  <div class="{GLASS} p-8 text-center text-slate-400">{$tr('no_committee')}</div>
{:else}
  <div class="grid gap-3 sm:grid-cols-2">
    {#each members as m, i (m.seed + '-' + i)}
      {@const g = avatarGradient(m.seed)}
      <div class="{GLASS} flex items-center gap-3 p-4">
        <span class="grid h-11 w-11 flex-none place-items-center rounded-full text-base font-black text-white" style="background-image:linear-gradient(135deg,{g[0]},{g[1]})">{initials(nameOf(m))}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-semibold text-white">{nameOf(m) || $tr('na')}</div>
          <div class="truncate text-xs font-medium text-violet-300">{roleOf(m)}</div>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.7rem] text-slate-400">
            {#if villageOf(m)}<span class="inline-flex items-center gap-0.5"><MapPin class="h-3 w-3" />{villageOf(m)}</span>{/if}
            {#if m.mobile}<a href="tel:{m.mobile}" class="inline-flex items-center gap-0.5 hover:text-violet-200"><Phone class="h-3 w-3" />{m.mobile}</a>{/if}
          </div>
        </div>
        <span class="flex-none rounded-md bg-white/10 px-2 py-0.5 text-[0.7rem] text-slate-300">{m.year}</span>
      </div>
    {/each}
  </div>
{/if}
