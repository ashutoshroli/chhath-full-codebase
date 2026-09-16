<script lang="ts">
  // Ported from the EmailLog sub-component of React views/Email.jsx — the "Queue"
  // tab: emails stuck > 30 min with re-queue. 60s poll.
  import { api } from '$lib/api';
  import { startPolling } from '$lib/polling';

  let stuck = $state<any>(null);
  let error = $state('');
  let resendingId = $state<string | null>(null);

  function load() {
    api.getStuckEmails(30).then((s: any) => (stuck = s)).catch((err: Error) => (error = err.message));
  }
  let started = false;
  $effect(() => { if (started) return; started = true; load(); });
  $effect(() => startPolling(() => load(), 60000));

  const badgeClass = (status: string) => (status === 'sent' ? 'badge-ok' : status === 'failed' ? 'badge-warn' : 'badge-pending');
  async function resend(m: any) {
    resendingId = m.message_id;
    try { await api.resendEmail(m.message_id); load(); } catch (err) { alert((err as Error).message); } finally { resendingId = null; }
  }
  let emails = $derived((stuck && stuck.emails) || []);
</script>

<div style="font-size:0.85rem; color:var(--text-muted); margin:4px 0 12px;">
  Emails queued but not yet delivered in the last 30 minutes. Sent emails leave the queue; a long-stuck list means <code>RESEND_API_KEY</code> is missing or invalid, or the sending domain is not verified.
</div>
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}
{#if emails.length === 0}<div class="glass-card" style="text-align:center; padding:20px;">No stuck emails — the queue is healthy.</div>{/if}
{#each emails as m, i (m.message_id || i)}
  <div class="glass-card" style="padding:15px; margin-bottom:10px;">
    <div style="display:flex; justify-content:space-between; margin-bottom:6px; gap:8px; flex-wrap:wrap;">
      <strong>{m.to_email}</strong>
      <span class="badge {badgeClass(m.status)}">{m.status}</span>
    </div>
    {#if m.remarks}<div style="font-size:0.8rem; color:var(--text-muted);">Remarks: {m.remarks}</div>{/if}
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; gap:8px; flex-wrap:wrap;">
      <div style="font-size:0.75rem; color:var(--text-muted);">
        {m.created_at}{#if m.attempts > 0} · {m.attempts} attempt{m.attempts === 1 ? '' : 's'}{/if}
      </div>
      {#if m.status !== 'sent'}
        <button class="btn-submit" style="width:auto; padding:4px 12px; font-size:0.8rem;" onclick={() => resend(m)} disabled={resendingId === m.message_id}>
          {resendingId === m.message_id ? 'Re-queuing...' : 'Re-queue'}
        </button>
      {/if}
    </div>
  </div>
{/each}
