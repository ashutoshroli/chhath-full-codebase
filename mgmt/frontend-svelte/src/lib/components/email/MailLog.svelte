<script lang="ts">
  // Ported from the MailLog sub-component of React views/Email.jsx — sent/queued
  // email log with a stuck-email banner and resend/re-queue. 60s poll.
  import { api } from '$lib/api';
  import { startPolling } from '$lib/polling';

  let rows = $state<any[] | null>(null);
  let loading = $state(true);
  let error = $state('');
  let stuck = $state<any>(null);
  let resendingId = $state<string | null>(null);

  function load(silent?: boolean) {
    if (!silent) loading = true;
    api.getEmailLog().then((r: any) => (rows = r)).catch((err: Error) => (error = err.message)).finally(() => (loading = false));
    api.getStuckEmails(30).then((s: any) => (stuck = s)).catch(() => {});
  }

  let started = false;
  $effect(() => { if (started) return; started = true; load(); });
  $effect(() => startPolling(() => load(true), 60000));

  const badgeClass = (status: string) => (status === 'sent' ? 'badge-ok' : status === 'failed' ? 'badge-warn' : 'badge-pending');
  let stuckCount = $derived(stuck ? stuck.total : 0);

  async function resend(m: any) {
    resendingId = m.message_id;
    try { await api.resendEmail(m.message_id); load(true); } catch (err) { alert((err as Error).message); } finally { resendingId = null; }
  }
</script>

{#if stuckCount > 0}
  <div style="background:#FEE2E2; color:#991B1B; border-radius:8px; padding:10px 12px; font-size:0.85rem; margin:10px 0;">
    🚨 <strong>{stuckCount} email{stuckCount === 1 ? '' : 's'}</strong> have been stuck in the queue for over 30 minutes —
    this usually means <code>RESEND_API_KEY</code> is missing/invalid or the sending domain is not verified in Resend.
  </div>
{/if}

{#if loading}<div class="inline-spinner">Loading emails...</div>{/if}
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}
{#if !loading && !error && (!rows || rows.length === 0)}
  <div class="glass-card" style="text-align:center; padding:20px;">No emails have been sent yet.</div>
{/if}

{#if !loading && !error}
  {#each rows || [] as m, i (m.message_id || i)}
    <div class="glass-card" style="padding:15px; margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:6px; gap:8px; flex-wrap:wrap;">
        <strong>{m.to_email}</strong>
        <div style="display:flex; gap:6px;">
          {#if m.message_type === 'priority'}<span class="badge badge-warn">⚡ Priority</span>{/if}
          <span class="badge {badgeClass(m.status)}">{m.status}</span>
        </div>
      </div>
      {#if m.subject}<p style="margin:0 0 4px; font-weight:600; font-size:0.9rem;">✉️ {m.subject}</p>{/if}
      {#if m.file_link}<div style="font-size:0.75rem; color:var(--text-muted);">📎 <a href={m.file_link} target="_blank" rel="noreferrer">Attached link</a></div>{/if}
      {#if m.remarks}<div style="font-size:0.8rem; color:var(--text-muted);">Remarks: {m.remarks}</div>{/if}
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; gap:8px; flex-wrap:wrap;">
        <div style="font-size:0.75rem; color:var(--text-muted);">
          {m.created_at}{#if m.attempts > 0} · {m.attempts} attempt{m.attempts === 1 ? '' : 's'}{/if}{#if m.sent_at} · finished {m.sent_at}{/if}
        </div>
        {#if m.status !== 'sent'}
          <button class="btn-submit" style="width:auto; padding:4px 12px; font-size:0.8rem;" onclick={() => resend(m)} disabled={resendingId === m.message_id}>
            {resendingId === m.message_id ? 'Re-queuing...' : m.status === 'failed' ? 'Resend' : 'Re-queue'}
          </button>
        {/if}
      </div>
    </div>
  {/each}
{/if}
