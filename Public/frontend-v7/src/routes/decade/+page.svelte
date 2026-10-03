<script lang="ts">
  import { onMount } from 'svelte';
  let years = Array.from({length:10}, (_,i)=>2017+i);
  let active = 2017;
  let counts = 0;
  onMount(async () => {
    try {
      const res = await fetch('https://chhath-public-worker.shaharpura.com?action=portalData');
      if (res.ok) {
        const raw = await res.json();
        const data = raw.data ?? raw;
        const all = [...(data.collections || []), ...(data.expenses || []), ...(data.loans || []), ...(data.committee || [])];
        const seen = [...new Set(all.map((r: Record<string,unknown>) => String(r.Year ?? r.year ?? '')).filter((y: string) => /^20\d\d$/.test(y)))].map(Number).sort((a,b)=>a-b);
        if (seen.length) years = seen;
        counts = (data.collections || []).filter((r: Record<string,unknown>) => String(r.Year ?? r.year) === String(active)).length;
      }
    } catch { /* Journey remains navigable with the published decade range. */ }
  });
  async function selectYear(y:number) {
    active = y;
    try {
      const res = await fetch('https://chhath-public-worker.shaharpura.com?action=portalData');
      if (res.ok) { const raw = await res.json(); const d = raw.data ?? raw; counts = (d.collections || []).filter((r:Record<string,unknown>)=>String(r.Year ?? r.year)===String(y)).length; }
    } catch { counts = 0; }
  }
</script>
<svelte:head><title>Our Journey — Chhath Puja</title></svelte:head>
<header class="topbar"><a class="brand" href="/"><span class="sun">☼</span><span><strong>Chhath Puja</strong><small>Transparency Portal</small></span></a><a class="language" href="/">← Home</a></header>
<main class="page journey-page">
  <p class="eyebrow">OUR JOURNEY / 2017—2026</p>
  <h1>A decade of<br /><span>showing up.</span></h1>
  <p class="lede">छठी मैया के आशीर्वाद, समुदाय के सहयोग और पारदर्शिता की यात्रा।</p>
  <div class="year-strip" aria-label="Choose a year">
    {#each years as y}<button class:active={active===y} onclick={() => selectYear(y)}>{y}</button>{/each}
  </div>
  <section class="journey-feature"><p class="eyebrow">YEAR IN FOCUS</p><strong class="journey-year">{active}</strong><h2>One community. A shared commitment.</h2><p>Every contribution and every recorded expense is part of our shared story.</p><div class="journey-stat"><span>Contribution records</span><strong>{counts}</strong></div></section>
  <a class="back-link" href="/">← Back to public ledger</a>
</main>