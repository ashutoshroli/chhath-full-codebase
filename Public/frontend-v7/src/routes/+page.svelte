<script lang="ts">
  import { onMount } from 'svelte';

  type Row = Record<string, unknown>;
  type PortalData = { collections?: Row[]; expenses?: Row[]; loans?: Row[]; committee?: Row[]; users?: Row[] };
  const API = 'https://chhath-public-worker.shaharpura.com';
  let data: PortalData = {};
  let loading = true;
  let error = '';
  let selectedYear = String(new Date().getFullYear());
  let years: string[] = [selectedYear, 'All'];
  let query = '';

  const value = (row: Row, ...keys: string[]) => {
    for (const key of keys) if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) return String(row[key]);
    return '';
  };
  const amount = (v: unknown) => {
    const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  const yearOf = (r: Row) => value(r, 'Year', 'year');
  const byYear = (rows: Row[] = []) => selectedYear === 'All' ? rows : rows.filter(r => yearOf(r) === selectedYear);
  $: collections = byYear(data.collections || []);
  $: expenses = byYear(data.expenses || []);
  $: contributors = collections.reduce((map, row) => {
    const name = value(row, 'Name', 'name') || 'Community contribution';
    const key = name.toLocaleLowerCase();
    const old = map.get(key) || { name, amount: 0, type: '' };
    old.amount += amount(value(row, 'Amount', 'amount'));
    old.type = value(row, 'Contribution Type', 'Type', 'type') || old.type;
    map.set(key, old);
    return map;
  }, new Map<string, {name: string; amount: number; type: string}>());
  $: collectionTotal = collections.reduce((sum, row) => sum + amount(value(row, 'Amount', 'amount')), 0);
  $: expenseTotal = expenses.reduce((sum, row) => sum + amount(value(row, 'Amount', 'amount')), 0);
  $: loanRows = (data.loans || []).filter(r => selectedYear === 'All' || yearOf(r) === String(Number(selectedYear) - 1));
  $: returnedLoans = loanRows.reduce((sum, row) => {
    const principal = amount(value(row, 'Amount', 'amount'));
    const rate = amount(value(row, 'Interest Rate', 'Intrest Rate'));
    const tenure = amount(value(row, 'Tenure'));
    return sum + principal + principal * rate / 100 * tenure;
  }, 0);
  $: budget = collectionTotal + returnedLoans;
  $: filteredContributors = [...contributors.values()].filter(c => c.name.toLowerCase().includes(query.toLowerCase())).sort((a,b) => b.amount-a.amount);
  $: availableYears = [...new Set([...(data.collections || []), ...(data.expenses || []), ...(data.loans || []), ...(data.committee || [])].map(yearOf).filter(Boolean))].sort((a,b) => Number(b)-Number(a));
  onMount(async () => {
    try {
      const response = await fetch(API + '?action=portalData');
      if (!response.ok) throw new Error('Portal data is temporarily unavailable.');
      const raw = await response.json();
      data = raw.data && typeof raw.data === 'object' ? raw.data : raw;
      years = [...new Set([...availableYears, String(new Date().getFullYear())])];
      if (availableYears.length && !availableYears.includes(selectedYear)) selectedYear = availableYears[0];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to load public records.';
    } finally { loading = false; }
  });
</script>

<svelte:head>
  <title>Chhath Puja — Transparency Portal</title>
  <meta name="theme-color" content="#f8f8f5" />
</svelte:head>

<header class="topbar">
  <a class="brand" href="/" aria-label="Chhath Puja home">
    <span class="sun" aria-hidden="true">☼</span>
    <span><strong>Chhath Puja</strong><small>Transparency Portal</small></span>
  </a>
  <div class="header-actions">
    <a class="language" href="?lang=hi" aria-label="Hindi language option">EN / हिंदी</a>
    <label class="year-picker"><span class="sr-only">Select year</span>
      <select bind:value={selectedYear} aria-label="Select year">
        {#each years as y}<option value={y}>{y}</option>{/each}
        <option value="All">All years</option>
      </select>
    </label>
  </div>
</header>

<main class="page">
  <section class="intro">
    <p class="eyebrow"><span class="live-dot"></span> PUBLIC LEDGER <span class="separator">/</span> SHAHARPURA</p>
    <h1>Faith deserves<br /><span>transparency.</span></h1>
    <p class="lede">छठ पूजा पारदर्शिता पोर्टल — नवयुवक छठ पूजा समिति</p>
  </section>

  {#if error}<div class="notice" role="status">{error} <button onclick={() => location.reload()}>Retry</button></div>{/if}
  {#if loading}
    <div class="loading" aria-label="Loading public records"><span></span><span></span><span></span></div>
  {:else}
    <section class="summary" aria-label="Financial summary">
      <article class="budget-card">
        <p class="eyebrow">TOTAL BUDGET · {selectedYear}</p>
        <strong>{money(budget)}</strong>
        <div class="progress-track"><span style:width="{budget > 0 ? Math.min(100, expenseTotal / budget * 100) : 0}%"></span></div>
        <div class="budget-foot"><span>{budget > 0 ? (expenseTotal / budget * 100).toFixed(1) : '0.0'}% used</span><span>{money(budget-expenseTotal)} remaining</span></div>
      </article>
      <article class="metric"><span class="metric-label">Collected</span><strong>{money(collectionTotal)}</strong><span class="metric-note">Public contributions</span></article>
      <article class="metric"><span class="metric-label">Expenses</span><strong>{money(expenseTotal)}</strong><span class="metric-note">Recorded spending</span></article>
      <article class="metric"><span class="metric-label">Past loan return*</span><strong>{money(returnedLoans)}</strong><span class="metric-note">Principal + recorded interest</span></article>
    </section>

    <section class="section-head" id="contributors">
      <div><p class="eyebrow">COMMUNITY · {filteredContributors.length} NAMES</p><h2>Contributors</h2></div>
      <label class="search"><span aria-hidden="true">⌕</span><input bind:value={query} placeholder="Search name…" aria-label="Search contributors" /></label>
    </section>
    <section class="records" aria-label="Contributor list">
      {#each filteredContributors as contributor, i}
        <article class="record">
          <span class="rank">{String(i+1).padStart(2,'0')}</span>
          <div class="record-main"><strong>{contributor.name}</strong><small>{contributor.type || 'Community contribution'}</small></div>
          <strong class="record-amount">{money(contributor.amount)}</strong>
        </article>
      {:else}
        <p class="empty">No contributors match this search.</p>
      {/each}
    </section>

    <section class="section-head" id="expenses">
      <div><p class="eyebrow">OUTGOING · {expenses.length} RECORDS</p><h2>Recent expenses</h2></div>
      <span class="section-total">{money(expenseTotal)}</span>
    </section>
    <section class="records">
      {#each expenses.slice(0, 8) as item, i}
        <article class="record">
          <span class="rank">{String(i+1).padStart(2,'0')}</span>
          <div class="record-main"><strong>{value(item, 'Description', 'Discription', 'description', 'Name') || 'Expense record'}</strong><small>{value(item, 'Category', 'category') || yearOf(item) || selectedYear}</small></div>
          <strong class="record-amount">{money(amount(value(item, 'Amount', 'amount')))}</strong>
        </article>
      {:else}
        <p class="empty">No expense records available for this year.</p>
      {/each}
    </section>
  {/if}

  <section class="journey" id="journey">
    <div><p class="eyebrow">2017 — 2026</p><h2>A decade of community service.</h2><p>See how our Chhath Puja journey has grown through the years.</p></div>
    <a href="/decade/">Explore journey <span aria-hidden="true">↗</span></a>
  </section>
  <nav class="quick-links" aria-label="Portal sections">
    <a href="#contributors">Contributors <span>↗</span></a>
    <a href="#expenses">Expenses <span>↗</span></a>
    <a href="/decade/">Our Journey <span>↗</span></a>
    <a href="/downloads/">Downloads <span>↗</span></a>
  </nav>
  <footer><span>CHHATH PUJA / TRANSPARENCY</span><span>Faith · Unity · Accountability</span></footer>
</main>