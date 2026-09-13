<script lang="ts">
  // Ported from the UserSessions sub-component of React views/AuditLogs.jsx —
  // look up a user's active device sessions and force-logout one/all.
  import { api, reportClientError } from '$lib/api';
  import { timeAgo } from '$lib/components/audit/timeAgo';

  let targetName = $state('');
  let rows = $state<any[]>([]);
  let loading = $state(false);
  let error = $state('');
  let busy = $state(false);
  let searched = $state(false);

  async function load() {
    const name = targetName.trim();
    if (!name) return;
    loading = true;
    error = '';
    searched = true;
    try {
      const d: any = await api.getUserSessions(name);
      rows = d.sessions || [];
    } catch (err) { error = (err as Error).message; reportClientError('AuditLogs', 'getUserSessions failed', err as Error); }
    finally { loading = false; }
  }

  async function forceLogout(s: any) {
    if (!confirm(`Force logout this device of ${targetName.trim()}?`)) return;
    busy = true;
    try { await api.revokeUserSession(targetName.trim(), s.id); load(); }
    catch (err) { alert((err as Error).message); }
    finally { busy = false; }
  }
  async function forceLogoutAll() {
    if (!confirm(`Force logout ALL devices of ${targetName.trim()}?`)) return;
    busy = true;
    try { await api.revokeUserSession(targetName.trim(), null); load(); }
    catch (err) { alert((err as Error).message); }
    finally { busy = false; }
  }
</script>

<div>
  <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
    <input bind:value={targetName} placeholder="Enter user id (e.g. USER0042)" onkeydown={(e) => e.key === 'Enter' && load()} style="padding:8px; border-radius:6px; border:1px solid #ddd; font-size:0.85rem; flex:1 1 200px;" />
    <button type="button" class="btn-outline" style="padding:8px 12px; font-size:0.85rem;" onclick={load}>View sessions</button>
  </div>
  {#if error}<div class="error-banner" style="margin-bottom:10px;">{error}</div>{/if}
  {#if loading}<div class="inline-spinner">Loading...</div>{/if}
  {#if !loading && searched && rows.length === 0 && !error}
    <div style="color:var(--text-muted); font-size:0.85rem;">No active sessions for this user.</div>
  {/if}
  {#if !loading && rows.length > 0}
    {#each rows as s (s.id)}
      <div style="border:1px solid var(--border, #e2e2e2); border-radius:8px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div style="min-width:0;">
          <div style="font-weight:600; font-size:0.88rem; overflow-wrap:anywhere;">{s.device || 'Unknown device'}</div>
          <div style="font-size:0.78rem; color:var(--text-muted);">IP {s.ip || '—'} · signed in {timeAgo(s.createdAt)} · active {timeAgo(s.lastSeenAt)}</div>
        </div>
        <button type="button" class="btn-danger" disabled={busy} style="font-size:0.8rem; white-space:nowrap;" onclick={() => forceLogout(s)}>Force logout</button>
      </div>
    {/each}
    <button type="button" class="btn-danger" disabled={busy} style="margin-top:4px; font-size:0.82rem;" onclick={forceLogoutAll}>Force logout all devices</button>
  {/if}
</div>
