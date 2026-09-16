<script lang="ts">
  // Ported from the ActivityTrail sub-component of React views/AuditLogs.jsx —
  // searchable activity trail (by user id), 300-row limit.
  import { api, reportClientError } from '$lib/api';
  import { timeAgo } from '$lib/components/audit/timeAgo';

  let rows = $state<any[]>([]);
  let loading = $state(false);
  let error = $state('');
  let name = $state('');

  function load() {
    loading = true;
    error = '';
    api.getActivityLog({ name2: name.trim() || undefined, limit: 300 })
      .then((d: any) => (rows = d.activity || []))
      .catch((err: Error) => { error = err.message; reportClientError('AuditLogs', 'getActivityLog failed', err); })
      .finally(() => (loading = false));
  }
  let started = false;
  $effect(() => { if (started) return; started = true; load(); });
</script>

<div>
  <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
    <input bind:value={name} placeholder="Filter by user id (optional)" onkeydown={(e) => e.key === 'Enter' && load()} style="padding:8px; border-radius:6px; border:1px solid #ddd; font-size:0.85rem; flex:1 1 200px;" />
    <button type="button" class="btn-outline" style="padding:8px 12px; font-size:0.85rem;" onclick={load}>Search</button>
  </div>
  {#if error}<div role="alert" class="error-banner" style="margin-bottom:10px;">{error}</div>{/if}
  {#if loading}<div class="inline-spinner">Loading...</div>{/if}
  {#if !loading && rows.length === 0 && !error}
    <div style="color:var(--text-muted); font-size:0.85rem;">No activity recorded yet.</div>
  {/if}
  {#each rows as r (r.id)}
    <div style="border:1px solid var(--border, #e2e2e2); border-radius:8px; padding:8px 12px; margin-bottom:6px;">
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <span style="font-weight:600; font-size:0.88rem;">{r.name}</span>
        <span style="font-size:0.8rem; color:var(--primary-saffron);">{r.action}</span>
      </div>
      <div style="font-size:0.78rem; color:var(--text-muted); overflow-wrap:anywhere;">
        {r.details || ''}{r.details ? ' · ' : ''}IP {r.ip_client_reported || '—'} · {timeAgo(r.timestamp)}
      </div>
    </div>
  {/each}
</div>
