<script lang="ts">
  import { portalState, year } from '$lib/stores/portal';
  import { tr as translate } from '$lib/stores/lang';
  import { expenseItems } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import { ReceiptText } from '@lucide/svelte';

  let items = $derived(expenseItems($portalState.data, $year));
  let total = $derived(items.reduce((s, x) => s + x.amount, 0));
</script>

<svelte:head>
  <title>{$translate('expenses_ledger')} — {$translate('app_title')}</title>
</svelte:head>

<div class="kinetic-command">
  <div class="kinetic-kicker">02 / OUTGOING</div>
  <h1 class="kinetic-title">Expenses.</h1>
</div>

<p class="kinetic-subtitle">{$translate('expenses_ledger')} / {$year === 'All' ? $translate('all_years') : $year}</p>

<div class="kinetic-grid kinetic-grid--2">
  <section class="kinetic-panel kinetic-panel--yellow">
    <ReceiptText />
    <div class="kinetic-label">{$translate('total_expense')}</div>
    <div class="kinetic-number">{fmt(total)}</div>
  </section>
  <section class="kinetic-panel">
    <div class="kinetic-label">RECORDS</div>
    <div class="kinetic-number">{items.length}</div>
  </section>
</div>

<section class="kinetic-panel" style="margin-top:14px;padding:0;overflow:auto">
  <table class="kinetic-table">
    <thead>
      <tr>
        <th>#</th>
        <th>{$translate('description')}</th>
        <th>{$translate('category')}</th>
        <th>{$translate('amount')}</th>
      </tr>
    </thead>
    <tbody>
      {#each items as item, i}
        <tr>
          <td>{String(i + 1).padStart(2, '0')}</td>
          <td>
            <strong>{item.description}</strong>
            {#if item.descriptionHindi}<div class="kinetic-micro">{item.descriptionHindi}</div>{/if}
          </td>
          <td><span class="kinetic-chip">{item.category || '—'}</span></td>
          <td>{fmt(item.amount)}</td>
        </tr>
      {/each}
      {#if items.length === 0}
        <tr><td colspan="4">{$translate('no_expenses')}</td></tr>
      {/if}
    </tbody>
  </table>
</section>
