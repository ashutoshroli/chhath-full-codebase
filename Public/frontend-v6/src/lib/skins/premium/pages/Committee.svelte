<script lang="ts">
  import { Users, MapPin, Phone, LogIn } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import SkeletonList from '$lib/components/SkeletonList.svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { committeeForYear } from '$lib/api/derive';
  import { initials, avatarGradient } from '$lib/utils/format';
  import { mgmtLoginUrl } from '$lib/api/client';

  let loading = $derived($portalState.status === 'loading');
  let members = $derived(committeeForYear($portalState.data, $year));

  const nameOf = (m: { name: string; nameHindi: string }) =>
    $lang === 'hi' && m.nameHindi ? m.nameHindi : m.name;
  const roleOf = (m: { role: string; roleHindi: string; designation: string; designationHindi: string }) => {
    if ($lang === 'hi') return m.roleHindi || m.designationHindi || m.role || m.designation || $tr('member');
    return m.role || m.designation || $tr('member');
  };
  const villageOf = (m: { village: string; villageHindi: string }) =>
    $lang === 'hi' && m.villageHindi ? m.villageHindi : m.village;
</script>

<svelte:head>
  <title>{$tr('active_committee')} — {$tr('app_title')}</title>
</svelte:head>

<div class="flex items-center justify-between gap-3">
  <PageHeading icon={Users} titleKey="active_committee" />
  <a
    href={mgmtLoginUrl}
    target="_blank"
    rel="noopener"
    class="inline-flex flex-none items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-bold text-white shadow-card transition hover:bg-brand-600 active:scale-95"
  >
    <LogIn class="h-4 w-4" aria-hidden="true" />
    {$tr('login')}
  </a>
</div>

{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <SkeletonList rows={5} />
{:else if members.length === 0}
  <EmptyState message={$tr('no_committee')} />
{:else}
  <div class="grid gap-2.5 sm:grid-cols-2">
    {#each members as m, i (m.seed + '-' + i)}
      {@const grad = avatarGradient(m.seed)}
      <div class="surface flex items-center gap-3 p-3.5">
        <span
          class="grid h-12 w-12 shrink-0 place-items-center rounded-full text-base font-black text-white"
          style="background-image: linear-gradient(135deg, {grad[0]}, {grad[1]})"
          aria-hidden="true"
        >
          {initials(nameOf(m))}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-bold">{nameOf(m) || $tr('na')}</p>
          <p class="truncate text-xs font-semibold text-brand-600 dark:text-brand-300">{roleOf(m)}</p>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {#if villageOf(m)}
              <span class="inline-flex items-center gap-1"><MapPin class="h-3 w-3" />{villageOf(m)}</span>
            {/if}
            {#if m.mobile}
              <a href="tel:{m.mobile}" class="inline-flex items-center gap-1 hover:text-brand-500">
                <Phone class="h-3 w-3" />{m.mobile}
              </a>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  </div>
{/if}
