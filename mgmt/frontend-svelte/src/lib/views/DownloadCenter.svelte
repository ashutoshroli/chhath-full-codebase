<script lang="ts">
  // Ported from React views/DownloadCenter.jsx — search a person by village +
  // name, list their downloadable docs (collections / loaner / guarantor) and
  // generate/download each. Section rendering inlined; item is DownloadItem.
  import { api } from '$lib/api';
  import { createDropdownList } from '$lib/dropdownList';
  import DownloadItem from '$lib/components/DownloadItem.svelte';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  interface Props {
    role: string;
  }
  let { role }: Props = $props();

  let canGenerate = $derived(role === 'Superadmin');

  const villageList = createDropdownList('Village');
  let villages = $state<any[]>([]);
  $effect(() => villageList.subscribe((s) => (villages = s.options)));

  let village = $state('');
  let nameQuery = $state('');
  let results = $state<any[] | null>(null);
  let searching = $state(false);
  let selected = $state<any>(null);
  let downloads = $state<any>(null);
  let loadingDownloads = $state(false);
  let error = $state('');

  async function search() {
    if (!village) { alert('Please select a village first'); return; }
    searching = true;
    error = '';
    selected = null;
    downloads = null;
    try {
      const res: any = await api.searchUsersByVillageAndName(village, nameQuery);
      results = res;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      searching = false;
    }
  }

  async function selectUser(u: any) {
    selected = u;
    loadingDownloads = true;
    error = '';
    try {
      const res: any = await api.getPersonDownloads(u.ID);
      downloads = res;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loadingDownloads = false;
    }
  }

  function markGenerated(recordId: string, publicLink: string) {
    if (!downloads) return;
    const patch = (arr: any[]) => arr.map((item) => (item.recordId === recordId ? { ...item, publicLink } : item));
    downloads = {
      ...downloads,
      collections: patch(downloads.collections),
      loanerItems: patch(downloads.loanerItems),
      guarantorItems: patch(downloads.guarantorItems)
    };
  }
</script>

<h2 style="margin-bottom:15px;">Download Center</h2>
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}

<div class="glass-card" style="padding:15px; margin-bottom:15px;">
  <div class="form-group">
    <label for={`${uid}-f1`}>Village</label>
    <select id={`${uid}-f1`}
      value={village}
      onchange={(e) => { village = (e.currentTarget as HTMLSelectElement).value; results = null; selected = null; downloads = null; }}
    >
      <option value="">-- Select Village --</option>
      {#each villages as v (v['English Value'])}
        <option value={v['English Value']}>{v['English Value']}</option>
      {/each}
    </select>
  </div>
  <div class="form-group">
    <label for={`${uid}-f2`}>Name / Mobile / ID</label>
    <input id={`${uid}-f2`} bind:value={nameQuery} placeholder="Search..." disabled={!village} />
  </div>
  <button class="btn-submit" onclick={search} disabled={searching || !village}>{searching ? 'Searching...' : 'Search'}</button>
</div>

{#if results && !selected}
  <div class="glass-card" style="padding:15px; margin-bottom:15px;">
    {#if results.length === 0}<div style="text-align:center; padding:10px;">No matches found.</div>{/if}
    {#each results as u (u.ID)}
      <button type="button" class="btn-bare" onclick={() => selectUser(u)}
        style="display:block; width:100%; text-align:left; padding:10px 0; border-bottom:1px solid #f0f0f0;">
        <strong>{u.Name}</strong>
        <div style="font-size:0.8rem; color:var(--text-muted);">{u.Village} {u.Mobile ? `| ${u.Mobile}` : ''}</div>
      </button>
    {/each}
  </div>
{/if}

{#if selected}
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
    <strong>{selected.Name} ({selected.Village})</strong>
    <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={() => { selected = null; downloads = null; }}>
      ← Back
    </button>
  </div>

  {#if loadingDownloads}<div class="inline-spinner">Loading...</div>{/if}

  {#if downloads}
    {#if downloads.collections && downloads.collections.length > 0}
      <div class="glass-card" style="padding:15px; margin-bottom:15px;">
        <strong>Receipts / Certificates / Material</strong>
        <div style="margin-top:8px;">
          {#each downloads.collections as item (item.recordId)}
            <DownloadItem {item} onGenerated={markGenerated} {canGenerate} />
          {/each}
        </div>
      </div>
    {/if}
    {#if downloads.loanerItems && downloads.loanerItems.length > 0}
      <div class="glass-card" style="padding:15px; margin-bottom:15px;">
        <strong>Loan Consent (Loaner)</strong>
        <div style="margin-top:8px;">
          {#each downloads.loanerItems as item (item.recordId)}
            <DownloadItem {item} onGenerated={markGenerated} {canGenerate} />
          {/each}
        </div>
      </div>
    {/if}
    {#if downloads.guarantorItems && downloads.guarantorItems.length > 0}
      <div class="glass-card" style="padding:15px; margin-bottom:15px;">
        <strong>Loan Consent (Guarantor)</strong>
        <div style="margin-top:8px;">
          {#each downloads.guarantorItems as item (item.recordId)}
            <DownloadItem {item} onGenerated={markGenerated} {canGenerate} />
          {/each}
        </div>
      </div>
    {/if}
    {#if downloads.collections.length === 0 && downloads.loanerItems.length === 0 && downloads.guarantorItems.length === 0}
      <div class="glass-card" style="text-align:center; padding:20px;">No downloadable records available for this person.</div>
    {/if}
  {/if}
{/if}
