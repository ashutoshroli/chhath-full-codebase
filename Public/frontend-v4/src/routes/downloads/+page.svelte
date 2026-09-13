<script lang="ts">
  import { Download, Search, FileText, ChevronRight, ArrowLeft } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { portalState } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { villages, peopleInVillage, downloadsForPerson } from '$lib/api/derive';
  import type { UserRow } from '$lib/api/schema';
  import { initials, avatarGradient, safeUrl } from '$lib/utils/format';

  let loading = $derived($portalState.status === 'loading');
  let village = $state('');
  let query = $state('');
  let selected = $state<UserRow | null>(null);

  let villageList = $derived(villages($portalState.data, $lang));
  let people = $derived(village ? peopleInVillage($portalState.data, village, query) : []);
  let groups = $derived(selected ? downloadsForPerson($portalState.data, (selected.ID ?? '').toString()) : []);
  let selectedGrad = $derived(avatarGradient((selected?.ID ?? '').toString()));

  const nameOf = (u: UserRow) =>
    ($lang === 'hi' && u['Name (Hindi)'] ? u['Name (Hindi)'] : u.Name ?? '').toString();
</script>

<svelte:head>
  <title>{$tr('download_center')} — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={Download} titleKey="download_center" subtitle={$tr('org_name')} />

{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="space-y-2.5">
    {#each Array(5) as _}<div class="skeleton h-14 rounded-2xl"></div>{/each}
  </div>
{:else if selected}
  <!-- Person's documents -->
  <button class="chip mb-3" onclick={() => (selected = null)}>
    <ArrowLeft class="h-4 w-4" /> {$tr('back')}
  </button>
  <div class="surface mb-3 flex items-center gap-3 p-3.5">
    <span
      class="grid h-11 w-11 place-items-center rounded-full text-sm font-black text-white"
      style="background-image: linear-gradient(135deg, {selectedGrad[0]}, {selectedGrad[1]})"
    >
      {initials(nameOf(selected))}
    </span>
    <p class="font-bold">{nameOf(selected)}</p>
  </div>

  {#if groups.length === 0}
    <EmptyState message={$tr('no_docs')} />
  {:else}
    {#each groups as g}
      <h2 class="mb-2 mt-4 text-sm font-bold text-slate-600 dark:text-slate-300">{$tr(g.titleKey)}</h2>
      <ul class="space-y-2">
        {#each g.docs as d}
          <li class="surface flex items-center gap-3 p-3">
            <span class="grid h-9 w-9 place-items-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
              <FileText class="h-4 w-4" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold">{$tr(d.labelKey)}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{d.year}</p>
            </div>
            {#if safeUrl(d.publicLink)}
              <a class="btn-primary !px-3 !py-1.5 text-xs" href={safeUrl(d.publicLink)} target="_blank" rel="noopener">
                {$tr('download')}
              </a>
            {:else}
              <span class="rounded-lg bg-black/5 px-3 py-1.5 text-xs font-semibold text-slate-400 dark:bg-white/10">
                {$tr('not_available')}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
{:else}
  <!-- Village + person picker -->
  <div class="surface mb-3 space-y-2 p-3">
    <select class="chip !h-10 w-full" bind:value={village} aria-label={$tr('select_village')}>
      <option value="">{$tr('select_village')}</option>
      {#each villageList as v}
        <option value={v}>{v}</option>
      {/each}
    </select>
    {#if village}
      <label class="relative block">
        <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          class="w-full rounded-xl bg-black/5 py-2 pl-9 pr-3 text-sm outline-none dark:bg-white/10"
          placeholder={$tr('name')}
          bind:value={query}
          type="search"
        />
      </label>
    {/if}
  </div>

  {#if !village}
    <EmptyState message={$tr('select_village_first')} />
  {:else if people.length === 0}
    <EmptyState message={$tr('no_matches')} />
  {:else}
    <ul class="space-y-2">
      {#each people as u (u.ID)}
        {@const grad = avatarGradient((u.ID ?? '').toString())}
        <li>
          <button class="surface flex w-full items-center gap-3 p-3 text-left transition active:scale-[.99]" onclick={() => (selected = u)}>
            <span
              class="grid h-10 w-10 place-items-center rounded-full text-sm font-black text-white"
              style="background-image: linear-gradient(135deg, {grad[0]}, {grad[1]})"
            >
              {initials(nameOf(u))}
            </span>
            <span class="min-w-0 flex-1 truncate text-sm font-semibold">{nameOf(u)}</span>
            <ChevronRight class="h-4 w-4 text-slate-400" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
{/if}
