<script lang="ts">
  // Ported from the LockedAccounts sub-component of React views/AuditLogs.jsx —
  // list currently locked accounts and unlock one / all.
  import { api, reportClientError } from '$lib/api';

  let rows = $state<any[]>([]);
  let loading = $state(false);
  let error = $state('');
  let busy = $state(false);

  function load() {
    loading = true;
    error = '';
    api.getLockedAccounts()
      .then((d: any) => (rows = d.locked || []))
      .catch((err: Error) => { error = err.message; reportClientError('AuditLogs', 'getLockedAccounts failed', err); })
      .finally(() => (loading = false));
  }
  let started = false;
  $effect(() => { if (started) return; started = true; load(); });

  async function unlock(row: any) {
    busy = true;
    try { await api.revokeLock(row.key); load(); }
    catch (err) { alert((err as Error).message); }
    finally { busy = false; }
  }
  async function unlockAll() {
    if (!confirm('Unlock ALL currently locked accounts?')) return;
    busy = true;
    try { await api.revokeAllLocks(); load(); }
    catch (err) { alert((err as Error).message); }
    finally { busy = false; }
  }
</script>

<div>
  <div style="display:flex; justify-content:space-between; margin-bottom:12px; gap:8px;">
    <button type="button" class="btn-outline" style="padding:8px 12px; font-size:0.85rem;" onclick={load}>Refresh</button>
    {#if rows.length > 0}
      <button type="button" class="btn-danger" disabled={busy} style="font-size:0.82rem;" onclick={unlockAll}>Unlock all</button>
    {/if}
  </div>
  {#if error}<div role="alert" class="error-banner" style="margin-bottom:10px;">{error}</div>{/if}
  {#if loading}<div class="inline-spinner">Loading...</div>{/if}
  {#if !loading && rows.length === 0 && !error}
    <div style="color:var(--success); font-size:0.85rem;">✓ No accounts are currently locked.</div>
  {/if}
  {#each rows as r (r.key)}
    <div style="border:1px solid var(--border, #e2e2e2); border-radius:8px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
      <div>
        <div style="font-weight:600; font-size:0.88rem;">🔒 {r.name}</div>
        <div style="font-size:0.78rem; color:var(--text-muted);">IP {r.ip || '—'} · {r.attempts} failed attempts</div>
      </div>
      <button type="button" class="btn-danger" disabled={busy} style="font-size:0.8rem; white-space:nowrap;" onclick={() => unlock(r)}>Unlock now</button>
    </div>
  {/each}
</div>
