<script lang="ts">
  // Ported from React views/LockYears.jsx — add a new year, lock/unlock years
  // (a locked year blocks all add/edit/delete for that year).
  import { api } from '$lib/api';

  interface Props {
    years: string[];
    lockedYears: Set<number>;
    onChange: () => void;
    onYearAdded?: (() => void) | null;
  }
  let { years, lockedYears, onChange, onYearAdded = null }: Props = $props();

  let busyYear = $state<string | null>(null);
  let newYear = $state('');
  let addingYear = $state(false);

  async function addYear(e: Event) {
    e.preventDefault();
    const y = parseInt(newYear);
    if (!y) { alert('Please enter a valid year (e.g. 2027)'); return; }
    addingYear = true;
    try {
      await api.addYear(y);
      newYear = '';
      onYearAdded && onYearAdded();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      addingYear = false;
    }
  }

  async function toggle(y: string) {
    const isLocked = lockedYears.has(parseInt(y));
    const msg = isLocked ? `Unlock ${y}?` : `Lock ${y}? No one will be able to add/edit/delete anything for this year.`;
    if (!confirm(msg)) return;
    busyYear = y;
    try {
      if (isLocked) await api.unlockYear(y);
      else await api.lockYear(y);
      onChange();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      busyYear = null;
    }
  }
</script>

<h2 style="margin-bottom:15px;">Lock Data</h2>
<p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:15px;">
  For any year that is locked, no one (including you) will be able to add/edit/delete collections, expenses, loans, or committee records for that year. The "All Years" view is always read-only.
</p>
<form onsubmit={addYear} class="glass-card" style="display:flex; gap:10px; padding:15px; margin-bottom:15px;">
  <input type="number" placeholder="e.g. 2027" bind:value={newYear} style="flex-grow:1;" />
  <button class="btn-submit" style="width:auto; padding:6px 14px;" disabled={addingYear}>
    {addingYear ? '...' : 'Add Year'}
  </button>
</form>

<div class="glass-card">
  {#if !years || years.length === 0}<div style="text-align:center; padding:20px;">No years found.</div>{/if}
  {#each years || [] as y (y)}
    {@const locked = lockedYears.has(parseInt(y))}
    <div class="data-row">
      <div>
        <strong>{y}</strong>
        <span class="badge" style="margin-left:8px; background:{locked ? '#FEE2E2' : '#DCFCE7'}; color:{locked ? '#991B1B' : '#166534'};">
          {locked ? 'Locked' : 'Open'}
        </span>
      </div>
      <button
        class="btn-submit"
        style="width:auto; padding:6px 14px; background:{locked ? 'var(--success)' : 'var(--danger)'};"
        disabled={busyYear === y}
        onclick={() => toggle(y)}
      >
        {busyYear === y ? '...' : (locked ? 'Unlock' : 'Lock')}
      </button>
    </div>
  {/each}
</div>
