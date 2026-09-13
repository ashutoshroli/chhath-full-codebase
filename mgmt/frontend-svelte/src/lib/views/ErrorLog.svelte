<script lang="ts">
  // Ported from React views/ErrorLog.jsx — searchable/filterable error log with
  // cleanup, per-row report-to-WhatsApp, and the AI-fix modal.
  import { api } from '$lib/api';
  import { isTruthyFlag } from '$lib/flags';
  import CleanupPanel from '$lib/components/CleanupPanel.svelte';
  import AiFixModal from '$lib/components/AiFixModal.svelte';
  import ErrorRow from '$lib/components/ErrorRow.svelte';

  interface Props {
    role: string;
  }
  let { role }: Props = $props();

  let rows = $state<any[] | null>(null);
  let loading = $state(true);
  let error = $state('');
  let busyId = $state<string | null>(null);
  let aiFixError = $state<any>(null);
  let aiFixByError = $state<Record<string, any>>({});
  let query = $state('');
  let sourceFilter = $state('All');
  let onlyUnreported = $state(false);
  let limit = $state(300);

  function load(lim?: number) {
    loading = true;
    error = '';
    api.getErrorLog(lim || limit)
      .then((r: any) => (rows = r))
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
  }

  // React: useEffect on [limit].
  let lastLimit = -1;
  $effect(() => {
    if (limit === lastLimit) return;
    lastLimit = limit;
    load(limit);
  });

  function loadAiFixes() {
    api.getAiFixes()
      .then((list: any) => {
        const map: Record<string, any> = {};
        (list || []).forEach((f: any) => { if (f.error_id && !map[f.error_id]) map[f.error_id] = f; });
        aiFixByError = map;
      })
      .catch(() => {});
  }
  let fixesStarted = false;
  $effect(() => { if (fixesStarted) return; fixesStarted = true; loadAiFixes(); });

  async function report(errorId: string) {
    busyId = errorId;
    try {
      const res: any = await api.reportErrorToWhatsApp(errorId);
      if (res && res.alreadyReported) {
        alert('This error has already been reported.');
      } else {
        alert(`Sent to WhatsApp (${(res && res.sentTo) || 0} Superadmin(s)).`);
      }
      load(limit);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      busyId = null;
    }
  }

  let sources = $derived.by(() => {
    const set = new Set((rows || []).map((r) => r.source).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  });

  let filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (sourceFilter !== 'All' && r.source !== sourceFilter) return false;
      if (onlyUnreported && isTruthyFlag(r.reported)) return false;
      if (!q) return true;
      return [r.message, r.page, r.source, r.error_id, r.context]
        .some((v) => (v || '').toString().toLowerCase().includes(q));
    });
  });

  let unreportedCount = $derived((rows || []).filter((r) => !isTruthyFlag(r.reported)).length);
</script>

<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; gap:8px; flex-wrap:wrap;">
  <h2 style="margin:0;">Error Log</h2>
  <button type="button" class="btn-submit" style="width:auto; padding:6px 12px; font-size:0.8rem; background:#e5e7eb; color:#111;" onclick={() => load(limit)}>
    🔄 Refresh
  </button>
</div>
{#if error}<div class="error-banner">{error}</div>{/if}

<CleanupPanel target="error_log" label="the Error Log" {role} onDone={() => load(limit)} />

<div class="glass-card" style="padding:12px; margin-bottom:12px;">
  <input placeholder="Message / page / Ref search..." bind:value={query} style="margin-bottom:8px;" />
  <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
    <select bind:value={sourceFilter} style="width:auto; flex:0 1 auto;">
      {#each sources as s (s)}<option value={s}>{s === 'All' ? 'All sources' : s}</option>{/each}
    </select>
    <select value={limit} onchange={(e) => (limit = Number((e.currentTarget as HTMLSelectElement).value))} style="width:auto; flex:0 1 auto;">
      <option value={300}>Last 300</option>
      <option value={600}>Last 600</option>
      <option value={1000}>Last 1000</option>
    </select>
    <label style="display:flex; align-items:center; gap:6px; margin:0; font-size:0.8rem;">
      <input type="checkbox" bind:checked={onlyUnreported} style="width:auto;" />
      Unreported only ({unreportedCount})
    </label>
  </div>
  {#if rows}
    <p style="font-size:0.75rem; color:var(--text-muted); margin:8px 0 0;">
      Showing {filtered.length} / {rows.length} rows.
      If the same error recurs within 5 minutes, no new row is created (de-duplication), so older errors stay in the list.
    </p>
  {/if}
</div>

{#if loading}<div class="inline-spinner">Loading...</div>{/if}
{#if !loading && (!rows || rows.length === 0)}<div style="text-align:center; padding:20px;">No errors have been logged.</div>{/if}
{#if !loading && rows && rows.length > 0 && filtered.length === 0}
  <div style="text-align:center; padding:20px;">No errors match this filter.</div>
{/if}

{#if !loading}
  {#each filtered as r, i (r.error_id || `row-${r.id || i}`)}
    <ErrorRow {r} onReport={report} onAiFix={(x) => (aiFixError = x)} busy={busyId === r.error_id} aiFix={aiFixByError[r.error_id]} />
  {/each}
{/if}

{#if aiFixError}
  <AiFixModal error={aiFixError} onClose={() => { aiFixError = null; loadAiFixes(); }} />
{/if}
