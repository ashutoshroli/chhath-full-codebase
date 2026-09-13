<script lang="ts">
  // Ported from React views/EmailOfficial.jsx — official mailbox (chhath@...):
  // inbox/sent list, read a thread, compose/reply with attachments. 60s poll.
  import DOMPurify from 'dompurify';
  import { api } from '$lib/api';
  import { startPolling } from '$lib/polling';
  import Modal from '$lib/components/Modal.svelte';

  function fmtDate(s: string): string {
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d.toLocaleString();
  }

  let box = $state('inbox');
  let rows = $state<any[] | null>(null);
  let unread = $state(0);
  let loading = $state(true);
  let error = $state('');
  let openMsg = $state<any>(null);
  let opening = $state(false);

  let composeOpen = $state(false);
  let replyTo = $state<string | null>(null);
  let form = $state({ to: '', cc: '', subject: '', body: '' });
  let attachments = $state<any[]>([]);
  let sending = $state(false);

  async function onFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    const read = (file: File) => new Promise<any>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ filename: file.name, content: (r.result || '').toString().split(',')[1] || '' });
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    try {
      const added = await Promise.all(files.map(read));
      const next = [...attachments, ...added];
      const total = next.reduce((s, a) => s + (a.content ? a.content.length : 0), 0);
      if (total > 3 * 1024 * 1024) { alert('Attachments too large (max ~2 MB total).'); return; }
      attachments = next;
    } catch (err) { alert('Could not read the file.'); }
  }
  function removeAttachment(i: number) { attachments = attachments.filter((_, idx) => idx !== i); }

  function load(silent?: boolean) {
    if (!silent) loading = true;
    api.listOfficialEmails(box, 50)
      .then((r: any) => { rows = r.emails || []; unread = r.unread || 0; })
      .catch((e: Error) => (error = e.message))
      .finally(() => (loading = false));
  }

  // React: useEffect on [box] (load) + 60s poll.
  let lastBox = '__init__';
  $effect(() => {
    if (box === lastBox) return;
    lastBox = box;
    load();
  });
  $effect(() => startPolling(() => load(true), 60000));

  async function openMessage(m: any) {
    opening = true;
    try {
      const res: any = await api.getOfficialEmail(m.message_id);
      openMsg = res;
      if (box === 'inbox' && !m.is_read) load(true);
    } catch (e) { alert((e as Error).message); } finally { opening = false; }
  }

  function startCompose() {
    replyTo = null;
    form = { to: '', cc: '', subject: '', body: '' };
    attachments = [];
    composeOpen = true;
  }
  function startReply(msg: any) {
    replyTo = msg.message_id;
    form = { to: '', cc: '', subject: '', body: '' };
    attachments = [];
    composeOpen = true;
  }

  async function submitSend(e: Event) {
    e.preventDefault();
    if (!form.body.trim()) { alert('Please write a message.'); return; }
    sending = true;
    try {
      const att = attachments.length ? attachments : undefined;
      if (replyTo) {
        await api.replyOfficialEmail(replyTo, form.body.trim(), att);
      } else {
        if (!form.to.trim()) { alert('Recipient is required.'); sending = false; return; }
        if (!form.subject.trim()) { alert('Subject is required.'); sending = false; return; }
        await api.sendOfficialEmail(form.to.trim(), form.cc.trim(), form.subject.trim(), form.body.trim(), att);
      }
      composeOpen = false;
      openMsg = null;
      box = 'sent';
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      sending = false;
    }
  }

  function bodyHtml(html: string, text: string): { kind: 'html' | 'text' | 'empty'; value: string } {
    if (html && html.trim()) return { kind: 'html', value: DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) };
    if (text && text.trim()) return { kind: 'text', value: text };
    return { kind: 'empty', value: '' };
  }
</script>

<div style="padding:20px;">
  <h2 style="margin-bottom:4px;">✉️ Mail (official)</h2>
  <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">chhath@shaharpura.com</p>

  <div class="subtabs">
    <button class="subtab-btn {box === 'inbox' ? 'active' : ''}" onclick={() => { box = 'inbox'; openMsg = null; }}>
      Inbox{unread > 0 ? ` (${unread})` : ''}
    </button>
    <button class="subtab-btn {box === 'sent' ? 'active' : ''}" onclick={() => { box = 'sent'; openMsg = null; }}>Sent</button>
  </div>

  {#if error}<div class="error-banner">{error}</div>{/if}
  {#if loading}<div class="inline-spinner">Loading mailbox...</div>{/if}

  {#if !loading && !error && (rows || []).length === 0}
    <div class="glass-card" style="text-align:center; padding:20px;">
      {box === 'inbox' ? 'No emails received yet.' : 'No emails sent yet.'}
    </div>
  {/if}

  {#if !loading && !error}
    {#each rows || [] as m, i (m.message_id || i)}
      {@const who = box === 'inbox' ? m.from_addr : m.to_addr}
      {@const unreadRow = box === 'inbox' && !m.is_read}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="glass-card"
        style="padding:12px; margin-bottom:8px; cursor:pointer; border-left:{unreadRow ? '3px solid var(--primary, #d97706)' : '3px solid transparent'};"
        onclick={() => openMessage(m)}
      >
        <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <strong style="font-weight:{unreadRow ? 700 : 500};">{who || '(unknown)'}</strong>
          <span style="font-size:0.72rem; color:var(--text-muted);">{fmtDate(m.created_at)}</span>
        </div>
        <div style="font-size:0.88rem; margin-top:2px;">{m.subject || '(no subject)'}</div>
        {#if box === 'sent' && m.status === 'failed'}<span class="badge badge-warn" style="margin-top:6px;">failed</span>{/if}
      </div>
    {/each}
  {/if}

  <button class="fab" onclick={startCompose} title="Compose"><span class="material-icons-round">edit</span></button>

  <Modal open={!!openMsg} onClose={() => (openMsg = null)}>
    {#if opening}<div class="inline-spinner">Opening...</div>{/if}
    {#if openMsg}
      <h3 style="margin-bottom:4px;">{openMsg.message.subject || '(no subject)'}</h3>
      <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
        {#each (openMsg.thread || [openMsg.message]) as t, i (t.message_id || i)}
          {@const body = bodyHtml(t.body_html, t.body_text)}
          <div class="glass-card" style="padding:12px; background:{t.direction === 'inbound' ? '#f9fafb' : '#eef6ff'};">
            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px;">
              <strong>{t.direction === 'inbound' ? t.from_addr : 'You (chhath@shaharpura.com)'}</strong>
              {t.direction === 'inbound' ? '' : ` → ${t.to_addr}`} · {fmtDate(t.created_at)}{t.status === 'failed' ? ' · failed' : ''}
            </div>
            {#if body.kind === 'html'}
              <div style="font-size:0.9rem; line-height:1.5;">{@html body.value}</div>
            {:else if body.kind === 'text'}
              <div style="font-size:0.9rem; line-height:1.5; white-space:pre-wrap;">{body.value}</div>
            {:else}
              <div style="font-size:0.85rem; color:var(--text-muted); font-style:italic;">(No message body — the email had no text/HTML content, or its body could not be retrieved.)</div>
            {/if}
            {#if Array.isArray(t.attachments) && t.attachments.length > 0}
              <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
                {#each t.attachments as a, ai (ai)}
                  <span class="badge" style="background:#eef2ff; color:#3730a3;">📎 {a.filename || 'attachment'}</span>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <button class="btn-submit" style="margin-top:14px;" onclick={() => startReply(openMsg.message)}>Reply</button>
    {/if}
  </Modal>

  <Modal open={composeOpen} onClose={() => (composeOpen = false)}>
    <h3 style="margin-bottom:12px;">{replyTo ? 'Reply' : 'Compose'}</h3>
    <form onsubmit={submitSend}>
      {#if !replyTo}
        <div class="form-group">
          <label>To</label>
          <input type="email" bind:value={form.to} placeholder="recipient@example.com" />
        </div>
        <div class="form-group">
          <label>Cc (optional)</label>
          <input type="email" bind:value={form.cc} placeholder="optional" />
        </div>
        <div class="form-group">
          <label>Subject</label>
          <input bind:value={form.subject} />
        </div>
      {/if}
      <div class="form-group">
        <label>Message</label>
        <textarea rows={8} bind:value={form.body} style="width:100%; padding:10px; border-radius:8px; border:1px solid #ddd;"></textarea>
      </div>
      <div class="form-group">
        <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
          <span class="material-icons-round" style="font-size:18px;">attach_file</span> Attach files (≤ ~2 MB total)
          <input type="file" multiple onchange={onFiles} style="display:none;" />
        </label>
        {#if attachments.length > 0}
          <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
            {#each attachments as a, i (i)}
              <span class="badge" style="background:#eef2ff; color:#3730a3; display:inline-flex; align-items:center; gap:4px;">
                📎 {a.filename}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span class="material-icons-round" style="font-size:14px; cursor:pointer;" onclick={() => removeAttachment(i)}>close</span>
              </span>
            {/each}
          </div>
        {/if}
      </div>
      <button class="btn-submit" disabled={sending}>{sending ? 'Sending...' : (replyTo ? 'Send Reply' : 'Send')}</button>
    </form>
  </Modal>
</div>
