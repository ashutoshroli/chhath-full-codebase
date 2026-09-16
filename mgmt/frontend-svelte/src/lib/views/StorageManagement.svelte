<script lang="ts">
  // Ported from React views/StorageManagement.jsx — per-year R2/Drive storage
  // overview with "Move to Drive" archival.
  import { api } from '$lib/api';

  function fmtBytes(n: unknown): string {
    const b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  let data = $state<any>(null);
  let loading = $state(true);
  let error = $state('');
  let busyYear = $state<string | null>(null);
  let result = $state('');

  function load() {
    loading = true;
    error = '';
    api.getStorageOverview()
      .then((d: any) => (data = d))
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
  }
  let started = false;
  $effect(() => { if (started) return; started = true; load(); });

  async function moveYear(year: string) {
    if (!confirm(`All files for ${year} (PDFs + consent photos/signatures) will be moved to Google Drive and removed from R2. This frees up R2 space. Continue?`)) return;
    busyYear = year;
    result = '';
    try {
      const res: any = await api.moveYearToDrive(year);
      result = res.message || `${year}: done.`;
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      busyYear = null;
    }
  }
</script>

<h2 style="margin-bottom:15px;">Storage Management</h2>
<p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:15px;">
  New files are stored on R2 (fast storage). You can archive an older year
  using "Move to Drive" — all of that year's files move to Drive and free up
  R2 space. Popup images always remain on R2.
</p>

{#if loading}<div class="inline-spinner">Loading...</div>{/if}
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}

{#if !loading && data && !data.r2Enabled}
  <div style="background:#FEF3C7; color:#92400E; border-radius:8px; padding:10px 12px; font-size:0.85rem; margin-bottom:15px;">
    ⚠️ R2 storage is not configured yet (bucket + R2_PUBLIC_BASE). Files are
    currently going to Google Drive. Once set up, this screen will show R2
    usage.
  </div>
{/if}

{#if result}
  <div style="background:#DCFCE7; color:#166534; border-radius:8px; padding:10px 12px; font-size:0.85rem; margin-bottom:15px;">{result}</div>
{/if}

{#if !loading && data}
  <div class="glass-card">
    {#if !data.years || data.years.length === 0}<div style="text-align:center; padding:20px;">No years found.</div>{/if}
    {#each data.years || [] as row (row.year)}
      <div class="data-row">
        <div>
          <strong>{row.year}</strong>
          <span class="badge" style="margin-left:8px; background:{row.location === 'R2' ? '#DBEAFE' : '#E5E7EB'}; color:{row.location === 'R2' ? '#1E40AF' : '#374151'};">
            {row.location === 'R2' ? 'R2 (fast)' : 'Drive (archived)'}
          </span>
          {#if row.location === 'R2'}
            <span style="font-size:0.75rem; color:var(--text-muted); margin-left:8px;">
              {row.r2Count} file{row.r2Count === 1 ? '' : 's'} · {fmtBytes(row.r2Bytes)}
            </span>
          {/if}
        </div>
        {#if data.r2Enabled && row.location === 'R2' && row.r2Count > 0}
          <button
            class="btn-submit"
            style="width:auto; padding:6px 14px; background:var(--primary-saffron);"
            disabled={busyYear === row.year}
            onclick={() => moveYear(row.year)}
          >
            {busyYear === row.year ? 'Moving...' : 'Move to Drive'}
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}
