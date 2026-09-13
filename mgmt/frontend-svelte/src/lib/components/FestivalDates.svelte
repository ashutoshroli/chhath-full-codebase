<script lang="ts">
  // Ported from React FestivalDates.jsx — per-year festival dates used in loan
  // consent placeholders (Diwali next day, Nahay-Khay, Chhath morning arghya).
  import { api } from '$lib/api';

  interface Props {
    years: string[] | null;
  }
  let { years }: Props = $props();

  let year = $state<string | number>((years && years[0]) || new Date().getFullYear());
  let dates = $state({ diwali: '', nahayKhay: '', chhathArghya: '' });
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');

  // React: useEffect on [year].
  let lastYear: string | number = '__init__';
  $effect(() => {
    if (year === lastYear) return;
    lastYear = year;
    loading = true;
    error = '';
    api.getFestivalDates(String(year))
      .then((row: any) => (dates = {
        diwali: row['Diwali Next Day Date'] || '',
        nahayKhay: row['Nahay-Khay Date'] || '',
        chhathArghya: row['Chhath Morning Arghya Date'] || ''
      }))
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
  });

  async function save() {
    saving = true;
    error = '';
    try {
      await api.saveFestivalDates(String(year), dates.diwali, dates.nahayKhay, dates.chhathArghya);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<div class="glass-card" style="padding:15px; margin-bottom:15px;">
  <strong>Festival Dates (used for loan consent placeholders)</strong>
  <p style="font-size:0.8rem; color:var(--text-muted); margin:2px 0 10px;">
    These change every year — please set them here before the new fund-year begins.
  </p>
  {#if error}<div class="error-banner" style="margin-bottom:10px;">{error}</div>{/if}

  <div class="form-group">
    <label>Year</label>
    <select bind:value={year}>
      {#each (years || [year]) as y (y)}<option value={y}>{y}</option>{/each}
    </select>
  </div>

  {#if loading}
    <div class="inline-spinner">Loading...</div>
  {:else}
    <div class="form-group">
      <label>Day After Diwali</label>
      <input type="date" value={dates.diwali} oninput={(e) => (dates = { ...dates, diwali: (e.currentTarget as HTMLInputElement).value })} />
    </div>
    <div class="form-group">
      <label>Nahay-Khay Date</label>
      <input type="date" value={dates.nahayKhay} oninput={(e) => (dates = { ...dates, nahayKhay: (e.currentTarget as HTMLInputElement).value })} />
    </div>
    <div class="form-group">
      <label>Chhath Morning Arghya Date</label>
      <input type="date" value={dates.chhathArghya} oninput={(e) => (dates = { ...dates, chhathArghya: (e.currentTarget as HTMLInputElement).value })} />
    </div>
    <button class="btn-submit" style="width:auto;" onclick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
  {/if}
</div>
