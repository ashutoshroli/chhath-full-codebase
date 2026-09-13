<script lang="ts">
  import { Landmark } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import SkeletonList from '$lib/components/SkeletonList.svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { loanItems } from '$lib/api/derive';
  import { fmt, initials, avatarGradient } from '$lib/utils/format';

  let loading = $derived($portalState.status === 'loading');
  let items = $derived(loanItems($portalState.data, $year));
  let totalPrincipal = $derived(items.reduce((s, l) => s + l.principal, 0));
  let totalWithInterest = $derived(items.reduce((s, l) => s + l.total, 0));

  const nameOf = (l: { name: string; nameHindi: string }) =>
    $lang === 'hi' && l.nameHindi ? l.nameHindi : l.name;
</script>

<svelte:head>
  <title>{$tr('loan_distribution')} — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={Landmark} titleKey="loan_distribution" />

{#if $portalState.failed}
  <ErrorState />
{:else}
  {#if !loading && items.length > 0}
    <div class="mb-3 grid grid-cols-2 gap-2.5">
      <div class="surface p-3.5">
        <p class="text-xs text-slate-500 dark:text-slate-400">{$tr('principal')}</p>
        <p class="text-lg font-black text-info">{fmt(totalPrincipal)}</p>
      </div>
      <div class="surface p-3.5">
        <p class="text-xs text-slate-500 dark:text-slate-400">{$tr('total_with_interest')}</p>
        <p class="text-lg font-black text-brand-600 dark:text-brand-300">{fmt(totalWithInterest)}</p>
      </div>
    </div>
  {/if}

  {#if loading}
    <SkeletonList rows={4} />
  {:else if items.length === 0}
    <EmptyState message={$tr('not_distributed')} />
  {:else}
    <ul class="space-y-2.5">
      {#each items as l, i (l.loanId || i)}
        {@const grad = avatarGradient(l.seed)}
        <li class="surface p-3.5">
          <div class="flex items-center gap-3">
            <span
              class="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-black text-white"
              style="background-image: linear-gradient(135deg, {grad[0]}, {grad[1]})"
              aria-hidden="true"
            >
              {initials(nameOf(l))}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold">{nameOf(l) || $tr('na')}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {$tr('year')} {l.year}{#if l.loanId} · {l.loanId}{/if}
              </p>
            </div>
            <span class="shrink-0 text-right">
              <span class="block font-extrabold text-brand-600 dark:text-brand-300">{fmt(l.total)}</span>
              <span class="text-[10px] text-slate-400">{$tr('total_with_interest')}</span>
            </span>
          </div>
          <dl class="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-black/[.03] p-2.5 text-center text-xs dark:bg-white/[.04]">
            <div>
              <dt class="text-slate-500 dark:text-slate-400">{$tr('principal')}</dt>
              <dd class="font-bold">{fmt(l.principal)}</dd>
            </div>
            <div>
              <dt class="text-slate-500 dark:text-slate-400">{$tr('interest')}</dt>
              <dd class="font-bold text-success">{fmt(l.interest)}</dd>
            </div>
            <div>
              <dt class="text-slate-500 dark:text-slate-400">{$tr('int_rate')} · {$tr('tenure')}</dt>
              <dd class="font-bold">{l.ratePerMonth}% · {l.tenure}</dd>
            </div>
          </dl>
        </li>
      {/each}
    </ul>
  {/if}
{/if}
