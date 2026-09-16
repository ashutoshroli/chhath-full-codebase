<script lang="ts">
  // Ported from React views/ListManagement.jsx — manage dropdown-list values
  // (Category / Payment Mode / Loan Status / Village) + FestivalDates editor.
  import { api } from '$lib/api';
  import { createDropdownList, invalidateDropdownLists, type DropdownList } from '$lib/dropdownList';
  import TransliterateInput from '$lib/components/TransliterateInput.svelte';
  import FestivalDates from '$lib/components/FestivalDates.svelte';

  const TYPES = ['Category', 'Payment Mode', 'Loan Status', 'Village'];

  let years = $state<string[] | null>(null);
  let yearsError = $state('');
  let yearsLoaded = false;
  $effect(() => {
    if (yearsLoaded) return;
    yearsLoaded = true;
    api.getYears().then((y: any) => (years = y)).catch((err: Error) => (yearsError = err.message));
  });

  let activeType = $state('Category');

  // Recreate the dropdown-list store when the active type changes (matches
  // useDropdownList(activeType)).
  let list = $state<DropdownList>(createDropdownList('Category'));
  let lastType = 'Category';
  $effect(() => {
    if (activeType !== lastType) {
      lastType = activeType;
      list = createDropdownList(activeType);
    }
  });
  let ls = $state({ options: [] as any[], loading: true });
  $effect(() => list.subscribe((s) => (ls = s as any)));

  let adding = $state(false);
  let newItem = $state({ en: '', hi: '' });
  let saving = $state(false);
  let editingRow = $state<number | null>(null);
  let editValue = $state({ en: '', hi: '' });

  function switchType(t: string) {
    activeType = t;
    adding = false;
    editingRow = null;
  }

  function doRefresh() { invalidateDropdownLists(); list.refresh(); }

  async function addItem(e: Event) {
    e.preventDefault();
    if (!newItem.en.trim()) { alert('English value is required'); return; }
    saving = true;
    try {
      await api.addDropdownListItem(activeType, newItem.en, newItem.hi);
      newItem = { en: '', hi: '' };
      adding = false;
      doRefresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  function startEdit(row: any) {
    editingRow = row.__rowIndex;
    editValue = { en: row['English Value'], hi: row['Hindi Label'] || '' };
  }

  async function saveEdit(row: any) {
    saving = true;
    try {
      await api.updateDropdownListItem(row.__rowIndex, editValue.en, editValue.hi, true);
      editingRow = null;
      doRefresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function removeItem(row: any) {
    if (!confirm(`Delete "${row['English Value']}" from the list? Existing records will not be affected, but this value will no longer appear in the dropdown for new entries.`)) return;
    try {
      await api.deleteDropdownListItem(row.__rowIndex);
      doRefresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }
</script>

<h2 style="margin-bottom:15px;">List Management</h2>

{#if yearsError}<div role="alert" class="error-banner">Years failed to load: {yearsError}</div>{/if}
<FestivalDates {years} />

<div style="display:flex; gap:8px; margin-bottom:15px; flex-wrap:wrap;">
  {#each TYPES as t (t)}
    <button class="nav-btn {activeType === t ? 'active' : ''}" onclick={() => switchType(t)}>{t}</button>
  {/each}
</div>

{#if ls.loading}<div class="inline-spinner">Loading...</div>{/if}

{#if !ls.loading}
  <div class="glass-card">
    {#if ls.options.length === 0}<div style="text-align:center; padding:20px;">No values found.</div>{/if}
    {#each ls.options as row (row.__rowIndex)}
      <div class="data-row">
        {#if editingRow === row.__rowIndex}
          <div style="flex-grow:1;">
            <TransliterateInput label="English Value" value={editValue} onChange={(v) => (editValue = v)} />
            <p style="font-size:0.75rem; color:var(--danger); margin:4px 0;">
              Note: Changing the English value will not update the label on previously saved records — the new value will be treated as a brand-new item.
            </p>
            <div style="display:flex; gap:8px;">
              <button class="btn-submit" style="width:auto;" onclick={() => saveEdit(row)} disabled={saving}>Save</button>
              <button class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={() => (editingRow = null)}>Cancel</button>
            </div>
          </div>
        {:else}
          <div>
            <strong style="display:block;">{row['English Value']}</strong>
            <span style="font-size:0.85rem; color:var(--text-muted);">{row['Hindi Label'] || '-'}</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <button type="button" class="btn-bare material-icons-round" aria-label="Edit this item" onclick={() => startEdit(row)}>edit</button>
            <button type="button" class="btn-bare material-icons-round" style="color:var(--danger);" aria-label="Delete this item" onclick={() => removeItem(row)}>delete</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if !adding}
  <button class="fab" onclick={() => (adding = true)}><span class="material-icons-round">add</span></button>
{/if}

{#if adding}
  <div class="glass-card" style="padding:15px; margin-top:15px;">
    <h3 style="margin-bottom:10px;">Add to {activeType}</h3>
    <form onsubmit={addItem}>
      <TransliterateInput label="English Value" value={newItem} onChange={(v) => (newItem = v)} />
      <div style="display:flex; gap:8px;">
        <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Add'}</button>
        <button type="button" class="btn-submit" style="background:#e5e7eb; color:#111;" onclick={() => (adding = false)}>Cancel</button>
      </div>
    </form>
  </div>
{/if}
