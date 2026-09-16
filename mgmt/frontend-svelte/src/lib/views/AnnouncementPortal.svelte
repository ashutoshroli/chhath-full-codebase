<script lang="ts">
  // Ported from React views/AnnouncementPortal.jsx — generate/revoke PIN-gated
  // announcement links per year and manage custom announcements per year.
  import { api } from '$lib/api';
  import { isTruthyFlag } from '$lib/flags';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  interface Props {
    years: string[];
  }
  let { years }: Props = $props();

  function fmtDateTimeLocal(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // audit PR-40: deliberate one-time capture. This is EDITABLE local state seeded from a
  // prop; making it `$derived` would discard whatever the operator has typed every time the
  // parent re-rendered. The prop is re-read where it genuinely needs to be (see the $effect).
  // svelte-ignore state_referenced_locally
  let year = $state((years && years[0]) || '');
  let pin = $state('');
  let neverExpires = $state(true);
  let expiresAt = $state(fmtDateTimeLocal(new Date(Date.now() + 6 * 60 * 60 * 1000)));
  let generating = $state(false);
  let generatedLink = $state<{ url: string; pin: string } | null>(null);
  let links = $state<any[]>([]);
  let error = $state('');

  let customs = $state<any[]>([]);
  // audit PR-40: deliberate one-time capture. This is EDITABLE local state seeded from a
  // prop; making it `$derived` would discard whatever the operator has typed every time the
  // parent re-rendered. The prop is re-read where it genuinely needs to be (see the $effect).
  // svelte-ignore state_referenced_locally
  let customYear = $state((years && years[0]) || '');
  let textHindi = $state('');
  let textEnglish = $state('');
  let priority = $state(false);
  let editingId = $state<string | null>(null);
  let savingCustom = $state(false);

  // React: useEffect on [years] — default year/customYear once years arrive.
  $effect(() => {
    if (years && years.length && !year) year = years[0];
    if (years && years.length && !customYear) customYear = years[0];
  });

  function refreshLinks() {
    api.getAnnouncementLinks().then((l: any) => (links = l)).catch((err: Error) => (error = err.message));
  }
  let linksLoaded = false;
  $effect(() => {
    if (linksLoaded) return;
    linksLoaded = true;
    refreshLinks();
  });

  function refreshCustoms() {
    if (!customYear) return;
    api.getCustomAnnouncements(customYear).then((c: any) => (customs = c)).catch((err: Error) => (error = err.message));
  }
  // React: useEffect on [customYear].
  let lastCustomYear = '__init__';
  $effect(() => {
    if (customYear === lastCustomYear) return;
    lastCustomYear = customYear;
    refreshCustoms();
  });

  let baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  async function generate() {
    if (!year) { error = 'Please select a year'; return; }
    if (!pin || pin.trim().length < 4) { error = 'PIN must be at least 4 digits'; return; }
    generating = true;
    error = '';
    try {
      const res: any = await api.generateAnnouncementLink(year, pin.trim(), neverExpires ? null : new Date(expiresAt).toISOString());
      generatedLink = { url: `${baseUrl}/announce/${res.token}`, pin: pin.trim() };
      pin = '';
      refreshLinks();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      generating = false;
    }
  }

  async function revoke(token: string) {
    if (!confirm('Revoke this link? It will stop working immediately.')) return;
    try {
      await api.revokeAnnouncementLink(token);
      refreshLinks();
    } catch (err) {
      error = (err as Error).message;
    }
  }

  function copyLink(url: string) {
    if (!navigator.clipboard) { window.prompt('Copy this link:', url); return; }
    navigator.clipboard.writeText(url)
      .then(() => alert('Link copied'))
      .catch(() => window.prompt('Permission to copy was not granted — please copy this link manually:', url));
  }

  function resetCustomForm() { textHindi = ''; textEnglish = ''; priority = false; editingId = null; }

  async function saveCustom() {
    if (!textHindi.trim() && !textEnglish.trim()) { error = 'At least one of Hindi or English text is required'; return; }
    savingCustom = true;
    error = '';
    try {
      if (editingId) await api.updateCustomAnnouncement(editingId, textHindi.trim(), textEnglish.trim(), priority);
      else await api.addCustomAnnouncement(customYear, textHindi.trim(), textEnglish.trim(), priority);
      resetCustomForm();
      refreshCustoms();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      savingCustom = false;
    }
  }

  function editCustom(c: any) {
    editingId = c.ID;
    textHindi = c.TextHindi || '';
    textEnglish = c.TextEnglish || '';
    priority = isTruthyFlag(c.Priority);
  }

  async function deleteCustom(id: string) {
    if (!confirm('Delete this custom announcement?')) return;
    try {
      await api.deleteCustomAnnouncement(id);
      refreshCustoms();
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<h2 style="margin-bottom:15px;">Announcement Portal</h2>
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}

<div class="glass-card" style="padding:15px;">
  <strong style="display:block; margin-bottom:10px;">Generate New Link</strong>
  <div class="form-group">
    <label for={`${uid}-f1`}>Year</label>
    <select id={`${uid}-f1`} bind:value={year}>
      {#each years || [] as y (y)}<option value={y}>{y}</option>{/each}
    </select>
  </div>
  <div class="form-group">
    <label for={`${uid}-f2`}>PIN (minimum 4 digits)</label>
    <input id={`${uid}-f2`} type="text" inputmode="numeric" bind:value={pin} placeholder="e.g. 4821" />
  </div>
  <div class="form-group">
    <label style="display:flex; align-items:center; gap:8px;">
      <input type="checkbox" bind:checked={neverExpires} />
      Never expires
    </label>
  </div>
  {#if !neverExpires}
    <div class="form-group">
      <label for={`${uid}-f3`}>Expiry Date/Time</label>
      <input id={`${uid}-f3`} type="datetime-local" bind:value={expiresAt} />
    </div>
  {/if}
  <button class="btn-submit" onclick={generate} disabled={generating}>
    {generating ? 'Generating...' : 'Generate Link'}
  </button>

  {#if generatedLink}
    <div style="margin-top:15px; padding:12px; background:#F0FDF4; border-radius:8px; border:1px solid #BBF7D0;">
      <div style="font-size:0.85rem; margin-bottom:6px;"><strong>Link:</strong> <span style="word-break:break-all;">{generatedLink.url}</span></div>
      <div style="font-size:0.85rem; margin-bottom:10px;"><strong>PIN:</strong> {generatedLink.pin}</div>
      <button class="btn-submit" style="width:auto;" onclick={() => copyLink(generatedLink!.url)}>Copy Link</button>
    </div>
  {/if}
</div>

<div class="glass-card" style="padding:15px;">
  <strong style="display:block; margin-bottom:10px;">Existing Links</strong>
  {#if links.length === 0}<p style="color:var(--text-muted); font-size:0.85rem;">No links have been created yet.</p>{/if}
  {#each links as l (l.Token)}
    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #eee; gap:10px; flex-wrap:wrap;">
      <div>
        <div style="font-weight:600;">Year {l.Year} <span style="margin-left:8px; font-size:0.7rem; padding:2px 8px; border-radius:12px; background:{l.status === 'active' ? '#D1FAE5' : l.status === 'expired' ? '#FEF3C7' : '#FEE2E2'}; color:{l.status === 'active' ? '#065F46' : l.status === 'expired' ? '#92400E' : '#991B1B'};">{l.status}</span></div>
        <div style="font-size:0.75rem; color:var(--text-muted);">
          {l.ExpiresAt ? `Expires: ${new Date(l.ExpiresAt).toLocaleString('en-IN')}` : 'Never expires'} · By {l.CreatedBy}
        </div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={() => copyLink(`${baseUrl}/announce/${l.Token}`)}>Copy Link</button>
        {#if l.status !== 'revoked'}<button class="btn-danger" onclick={() => revoke(l.Token)}>Revoke</button>{/if}
      </div>
    </div>
  {/each}
</div>

<div class="glass-card" style="padding:15px;">
  <strong style="display:block; margin-bottom:10px;">Custom Announcements</strong>
  <div class="form-group">
    <label for={`${uid}-f4`}>Year</label>
    <select id={`${uid}-f4`} bind:value={customYear}>
      {#each years || [] as y (y)}<option value={y}>{y}</option>{/each}
    </select>
  </div>
  <div class="form-group">
    <label for={`${uid}-f5`}>Text (Hindi)</label>
    <textarea id={`${uid}-f5`} rows={2} bind:value={textHindi} style="width:100%; padding:10px; border-radius:8px; border:1px solid #ddd;"></textarea>
  </div>
  <div class="form-group">
    <label for={`${uid}-f6`}>Text (English)</label>
    <textarea id={`${uid}-f6`} rows={2} bind:value={textEnglish} style="width:100%; padding:10px; border-radius:8px; border:1px solid #ddd;"></textarea>
  </div>
  <div class="form-group">
    <label style="display:flex; align-items:center; gap:8px;">
      <input type="checkbox" bind:checked={priority} />
      Priority (interrupts the queue to display immediately)
    </label>
  </div>
  <div style="display:flex; gap:8px;">
    <button class="btn-submit" style="width:auto;" onclick={saveCustom} disabled={savingCustom}>
      {editingId ? 'Update' : 'Add'}
    </button>
    {#if editingId}<button class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={resetCustomForm}>Cancel</button>{/if}
  </div>

  <div style="margin-top:15px;">
    {#if customs.length === 0}<p style="color:var(--text-muted); font-size:0.85rem;">No custom announcements for this year.</p>{/if}
    {#each customs as c (c.ID)}
      <div style="display:flex; justify-content:space-between; align-items:flex-start; padding:10px 0; border-bottom:1px solid #eee; gap:10px;">
        <div style="flex:1;">
          {#if isTruthyFlag(c.Priority)}
            <span style="font-size:0.7rem; padding:2px 8px; border-radius:12px; background:#FEF3C7; color:#92400E; margin-right:6px;">Priority</span>
          {/if}
          {#if c.TextHindi}<div style="font-size:0.9rem;">{c.TextHindi}</div>{/if}
          {#if c.TextEnglish}<div style="font-size:0.85rem; color:var(--text-muted);">{c.TextEnglish}</div>{/if}
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Announced: {c.AnnouncedCount || 0}</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={() => editCustom(c)}>Edit</button>
          <button class="btn-danger" onclick={() => deleteCustom(c.ID)}>Delete</button>
        </div>
      </div>
    {/each}
  </div>
</div>
