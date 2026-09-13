<script lang="ts">
  // Ported from the LoginAttempts sub-component of React views/AuditLogs.jsx —
  // login history with all/failed/success filter and per-user-id search.
  import { api, reportClientError } from '$lib/api';
  import { timeAgo } from '$lib/components/audit/timeAgo';

  const REASON_LABEL: Record<string, string> = {
    ok: 'Success',
    bad_password: 'Wrong password',
    unknown_user: 'Unknown user',
    locked_out: 'Locked out'
  };

  let rows = $state<any[]>([]);
  let loading = $state(false);
  let error = $state('');
  let name = $state('');
  let filter = $state('all');

  function load() {
    loading = true;
    error = '';
    const opts: any = { name2: name.trim() || undefined, limit: 300 };
    if (filter === 'failed') opts.failedOnly = true;
    else if (filter === 'success') opts.successOnly = true;
    api.getLoginAttempts(opts)
      .then((d: any) => (rows = d.attempts || []))
      .catch((err: Error) => { error = err.message; reportClientError('AuditLogs', 'getLoginAttempts failed', err); })
      .finally(() => (loading = false));
  }

  // React: useEffect on [filter].
  let lastFilter = '__init__';
  $effect(() => {
    if (filter === lastFilter) return;
    lastFilter = filter;
    load();
  });
</script>

<div>
  <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; align-items:center;">
    <input bind:value={name} placeholder="Filter by user id (optional)" onkeydown={(e) => e.key === 'Enter' && load()} style="padding:8px; border-radius:6px; border:1px solid #ddd; font-size:0.85rem; flex:1 1 180px;" />
    <select bind:value={filter} style="padding:8px; border-radius:6px; border:1px solid #ddd; font-size:0.85rem;">
      <option value="all">All</option>
      <option value="failed">Failed only</option>
      <option value="success">Success only</option>
    </select>
    <button type="button" class="btn-outline" style="padding:8px 12px; font-size:0.85rem;" onclick={load}>Search</button>
  </div>

  {#if error}<div class="error-banner" style="margin-bottom:10px;">{error}</div>{/if}
  {#if loading}<div class="inline-spinner">Loading...</div>{/if}
  {#if !loading && rows.length === 0 && !error}<div style="color:var(--text-muted); font-size:0.85rem;">No login attempts found.</div>{/if}

  {#each rows as r (r.id)}
    <div style="border:1px solid var(--border, #e2e2e2); border-left:4px solid {r.success ? 'var(--success)' : 'var(--danger)'}; border-radius:8px; padding:8px 12px; margin-bottom:6px;">
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <span style="font-weight:600; font-size:0.88rem;">{r.identifier || r.name || '—'}</span>
        <span style="font-size:0.8rem; color:{r.success ? 'var(--success)' : 'var(--danger)'};">
          {REASON_LABEL[r.reason] || r.reason || (r.success ? 'Success' : 'Failed')}
        </span>
      </div>
      <div style="font-size:0.76rem; color:var(--text-muted);">
        IP {r.ip || '—'} · {r.device_info ? r.device_info.slice(0, 60) : 'unknown device'} · {timeAgo(r.created_at)}
      </div>
    </div>
  {/each}
</div>
