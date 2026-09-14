<script lang="ts">
  // Parity with the React views/CustomNotification.jsx — manual push broadcast to
  // everyone who opted in on the PUBLIC portal. Subscriptions are created by the
  // public worker; this only sends.
  import { api, reportClientError } from '$lib/api';

  let title = $state('');
  let body = $state('');
  let url = $state('/');
  let sending = $state(false);
  let loading = $state(true);
  let stats = $state<{ total: number; active: number }>({ total: 0, active: 0 });
  let configured = $state(true);
  let error = $state('');
  let notice = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      const res: any = await api.listPushSubscriptions(1);
      stats = { ...(res.stats || { total: 0, active: 0 }) };
      configured = res.configured !== false;
    } catch {
      // Listing is superadmin-only; an Admin must still be able to send, so a
      // failure here is not fatal.
      stats = { total: 0, active: 0 };
    } finally {
      loading = false;
    }
  }
  let started = false;
  $effect(() => { if (started) return; started = true; load(); });

  async function send() {
    if (!title.trim() || !body.trim()) {
      error = 'Please fill in both the title and the message.';
      return;
    }
    if (!confirm('Send this notification to everyone who opted in?')) return;
    sending = true;
    error = '';
    notice = '';
    try {
      const res: any = await api.sendCustomPush(title.trim(), body.trim(), url.trim() || '/');
      notice = `Notification queued for ${res.sent ?? 0} subscriber(s).`;
      title = '';
      body = '';
      await load();
    } catch (err) {
      error = (err as Error).message || 'Failed to send the notification.';
      reportClientError('CustomNotification', 'Failed to send custom push', err as Error);
    } finally {
      sending = false;
    }
  }

  const inputStyle = 'width:100%; padding:10px; border-radius:8px; border:1px solid #ddd; font-size:0.9rem; margin-bottom:12px;';
  const labelStyle = 'font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:5px;';
  const btn = (bg: string) => `background:${bg}; color:#fff; border:none; padding:10px 16px; border-radius:8px; font-weight:700; font-size:0.9rem; cursor:pointer;`;
</script>

{#if loading}
  <div class="inline-spinner">Loading...</div>
{:else}
  <div>
    <h2 style="margin-bottom:6px;">Custom Notification</h2>
    <p style="font-size:0.9rem; color:var(--text-muted); margin-bottom:16px;">
      Send a one-off push notification to every visitor who turned notifications on
      in the public portal — an announcement, a reminder, or a festival greeting.
      New contributions already notify automatically; this is for everything else.
    </p>

    {#if !configured}
      <div class="glass-card" style="border-color:var(--danger); color:var(--danger); margin-bottom:12px; padding:12px;">
        Push notifications are not configured on the server (VAPID keys missing), so sending will fail.
      </div>
    {/if}
    {#if error}<div class="glass-card" style="border-color:var(--danger); color:var(--danger); margin-bottom:12px; padding:12px;">{error}</div>{/if}
    {#if notice}<div class="glass-card" style="border-color:var(--success); color:var(--success); margin-bottom:12px; padding:12px;">{notice}</div>{/if}

    <div class="glass-card" style="margin-bottom:18px; padding:16px;">
      <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">
        Subscribers: <strong>{stats.active}</strong> active{stats.total !== stats.active ? ` (${stats.total} total)` : ''}
      </div>

      <label style={labelStyle}>Title</label>
      <input style={inputStyle} maxlength="120" bind:value={title} placeholder="Chhath Puja 2026" />

      <label style={labelStyle}>Message</label>
      <textarea style="{inputStyle} min-height:90px;" maxlength="500" bind:value={body} placeholder="Nahay Khay kal hai. Sabhi shraddhalu samay par ghat par pahunchein."></textarea>

      <label style={labelStyle}>Open this page when tapped</label>
      <input style={inputStyle} bind:value={url} placeholder="/" />

      <button style={btn('var(--primary-saffron, #F97316)')} onclick={send} disabled={sending || stats.active === 0}>
        {sending ? 'Sending...' : 'Send Notification'}
      </button>
      {#if stats.active === 0}
        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:10px;">
          Nobody has opted in yet, so there is nothing to send. Visitors opt in from the portal's User Guide page.
        </p>
      {/if}
    </div>

    <p style="font-size:0.8rem; color:var(--text-muted);">
      Notifications reach a device only while its browser subscription is alive. Endpoints
      the push service reports as gone are deactivated automatically.
    </p>
  </div>
{/if}
