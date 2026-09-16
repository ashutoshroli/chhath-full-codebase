<script lang="ts">
  // Ported from the MessageLog sub-component of React views/WhatsApp.jsx —
  // person/group message log with a stuck-message banner and resend. 12s poll.
  import { api } from '$lib/api';
  import { startPolling } from '$lib/polling';

  let tab = $state('person');
  let rows = $state<any[] | null>(null);
  let loading = $state(true);
  let error = $state('');
  let resendingId = $state<string | null>(null);
  let stuck = $state<any>(null);

  function load(silent?: boolean) {
    if (!silent) loading = true;
    api.getMessageLog().then((r: any) => (rows = r)).catch((err: Error) => (error = err.message)).finally(() => (loading = false));
    api.getStuckMessages(30).then((s: any) => (stuck = s)).catch(() => {});
  }

  let started = false;
  $effect(() => { if (started) return; started = true; load(); });
  $effect(() => startPolling(() => load(true), 12000));

  const badgeClass = (status: string) => (status === 'sent' ? 'badge-ok' : status === 'failed' ? 'badge-warn' : 'badge-pending');
  let stuckCount = $derived(stuck ? stuck.total : 0);

  async function resend(m: any) {
    resendingId = m.message_id;
    try { await api.resendMessage(m.type, m.message_id); load(true); } catch (err) { alert((err as Error).message); } finally { resendingId = null; }
  }

  let filtered = $derived((rows || []).filter((r) => r.type === tab));
</script>

<div class="subtabs">
  <button class="subtab-btn {tab === 'person' ? 'active' : ''}" onclick={() => (tab = 'person')}>Person</button>
  <button class="subtab-btn {tab === 'group' ? 'active' : ''}" onclick={() => (tab = 'group')}>Group</button>
</div>

{#if stuckCount > 0}
  <div style="background:#FEE2E2; color:#991B1B; border-radius:8px; padding:10px 12px; font-size:0.85rem; margin:10px 0;">
    🚨 <strong>{stuckCount} message{stuckCount === 1 ? '' : 's'}</strong> have been stuck in the queue for over 30 minutes
    ({stuck.person.length} person, {stuck.group.length} group) — this means the external WhatsApp sender script is not running,
    or its API key / URL is incorrect. Check the sender script and <code>WHATSAPP_QUEUE_API_KEY</code>.
  </div>
{/if}

{#if loading}<div class="inline-spinner">Loading messages...</div>{/if}
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}

{#if !loading && !error && filtered.length === 0}
  <div class="glass-card" style="text-align:center; padding:20px;">No message records found.</div>
{/if}

{#if !loading && !error}
  {#each filtered as m, i (m.message_id || i)}
    <div class="glass-card" style="padding:15px; margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:6px; gap:8px; flex-wrap:wrap;">
        <strong>{m.recipient}</strong>
        <div style="display:flex; gap:6px;">
          {#if m.message_type === 'priority'}<span class="badge badge-warn">⚡ Priority</span>{/if}
          <span class="badge {badgeClass(m.status)}">{m.status}</span>
        </div>
      </div>
      <p style="margin:0 0 6px; font-size:0.9rem; overflow-wrap:anywhere; white-space:pre-wrap;">{m.message}</p>
      {#if m.from}<div style="font-size:0.75rem; color:var(--text-muted);">From: {m.from}</div>{/if}
      {#if m.file_link}<div style="font-size:0.75rem; color:var(--text-muted);">📎 <a href={m.file_link} target="_blank" rel="noreferrer">Attached file</a></div>{/if}
      {#if m.remarks}<div style="font-size:0.8rem; color:var(--text-muted);">Remarks: {m.remarks}</div>{/if}
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; gap:8px; flex-wrap:wrap;">
        <div style="font-size:0.75rem; color:var(--text-muted);">
          {m.created_at}{#if m.attempts > 0} · {m.attempts} attempt{m.attempts === 1 ? '' : 's'}{/if}{#if m.sent_at} · finished {m.sent_at}{/if}
        </div>
        {#if m.status !== 'sent'}
          <button class="btn-submit" style="width:auto; padding:4px 12px; font-size:0.8rem;" onclick={() => resend(m)} disabled={resendingId === m.message_id}>
            {resendingId === m.message_id ? 'Resending...' : m.status === 'failed' ? 'Resend' : 'Re-queue'}
          </button>
        {/if}
      </div>
    </div>
  {/each}
{/if}
