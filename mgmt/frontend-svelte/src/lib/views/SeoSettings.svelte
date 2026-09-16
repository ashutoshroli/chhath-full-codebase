<script lang="ts">
  // Ported from React views/SeoSettings.jsx — edit SEO/link-preview metadata for
  // the public + mgmt portals, upload preview images, set deploy hooks, publish.
  import { api, reportClientError } from '$lib/api';
  import { prepareImageForUpload } from '$lib/imagePrep';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  const str = (v: unknown) => (v === undefined || v === null ? '' : v.toString());

  const EMPTY = {
    public: { title: '', description: '', keywords: '', image: '' },
    mgmt: { title: '', description: '', image: '' },
    deployHooks: { publicConfigured: false, mgmtConfigured: false }
  };

  let data = $state<any>(structuredClone(EMPTY));
  let loading = $state(true);
  let saving = $state(false);
  let publishing = $state('');
  let uploading = $state('');
  let error = $state('');
  let notice = $state('');
  let publicHook = $state('');
  let mgmtHook = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      const res: any = await api.getSeoSettings();
      data = {
        public: { ...EMPTY.public, ...(res.public || {}) },
        mgmt: { ...EMPTY.mgmt, ...(res.mgmt || {}) },
        deployHooks: { ...EMPTY.deployHooks, ...(res.deployHooks || {}) }
      };
    } catch (err) {
      error = (err as Error).message || 'Failed to load SEO settings.';
      reportClientError('SeoSettings', 'Failed to load SEO settings', err as Error);
    } finally {
      loading = false;
    }
  }
  let started = false;
  $effect(() => { if (started) return; started = true; load(); });

  function setPublic(patch: any) { data = { ...data, public: { ...data.public, ...patch } }; }
  function setMgmt(patch: any) { data = { ...data, mgmt: { ...data.mgmt, ...patch } }; }

  async function uploadImage(portal: string, file: File | undefined) {
    if (!file) return;
    uploading = portal;
    error = '';
    notice = '';
    try {
      const prepped = await prepareImageForUpload(file);
      const res: any = await api.uploadSeoImage(prepped.base64, prepped.fileName);
      const imageUrl = res.imageUrl || res.url;
      if (!imageUrl) throw new Error('The server did not return an image URL.');
      if (portal === 'public') setPublic({ image: imageUrl });
      else setMgmt({ image: imageUrl });
      notice = 'Image uploaded. Remember to Save, then Publish.';
    } catch (err) {
      error = `Image upload failed: ${(err as Error).message}`;
      reportClientError('SeoSettings', 'SEO image upload failed', err as Error, { portal, fileName: file.name, fileType: file.type, fileSize: file.size });
    } finally {
      uploading = '';
    }
  }

  async function save() {
    saving = true;
    error = '';
    notice = '';
    try {
      const payload: any = {
        public: {
          title: str(data.public.title).trim(),
          description: str(data.public.description).trim(),
          keywords: str(data.public.keywords).trim(),
          image: str(data.public.image).trim()
        },
        mgmt: {
          title: str(data.mgmt.title).trim(),
          description: str(data.mgmt.description).trim(),
          image: str(data.mgmt.image).trim()
        },
        deployHooks: {}
      };
      if (publicHook.trim()) payload.deployHooks.publicUrl = publicHook.trim();
      if (mgmtHook.trim()) payload.deployHooks.mgmtUrl = mgmtHook.trim();

      await api.saveSeoSettings(payload);
      publicHook = '';
      mgmtHook = '';
      notice = 'Settings saved. Press "Publish" to rebuild a portal and apply the new link preview.';
      await load();
    } catch (err) {
      error = (err as Error).message || 'Failed to save settings.';
      reportClientError('SeoSettings', 'Failed to save SEO settings', err as Error);
    } finally {
      saving = false;
    }
  }

  async function publish(target: string) {
    publishing = target;
    error = '';
    notice = '';
    try {
      const res: any = await api.triggerRebuild(target);
      if (res.success) {
        notice = 'Rebuild started. The new link preview will be live in about 1-2 minutes.';
      } else {
        const reasons = Object.entries(res.results || {})
          .filter(([, r]: any) => !r.triggered)
          .map(([p, r]: any) => `${p}: ${r.reason || 'not triggered'}`)
          .join('; ');
        error = `Could not start the rebuild. ${reasons || 'Check that a deploy hook is configured.'}`;
      }
    } catch (err) {
      error = (err as Error).message || 'Failed to trigger the rebuild.';
      reportClientError('SeoSettings', 'Failed to trigger rebuild', err as Error);
    } finally {
      publishing = '';
    }
  }

  const inputStyle = 'width:100%; padding:10px; border-radius:8px; border:1px solid #ddd; font-size:0.9rem; margin-bottom:12px;';
  const labelStyle = 'font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:5px;';
  const btn = (bg: string) => `background:${bg}; color:#fff; border:none; padding:10px 16px; border-radius:8px; font-weight:700; font-size:0.9rem; cursor:pointer;`;
</script>

{#snippet previewCard(image: string, title: string, description: string, domain: string)}
  <div style="border:1px solid var(--border, #e2e2e2); border-radius:10px; overflow:hidden; max-width:420px; background:var(--surface, #fff);">
    <div style="width:100%; aspect-ratio:1200 / 630; background:#f0f0f0; display:flex; align-items:center; justify-content:center; overflow:hidden;">
      {#if image}
        <img src={image} alt="Link preview" style="width:100%; height:100%; object-fit:cover;" />
      {:else}
        <span style="color:var(--text-muted, #888); font-size:0.85rem;">No preview image</span>
      {/if}
    </div>
    <div style="padding:10px 12px;">
      <div style="font-size:0.72rem; text-transform:uppercase; color:var(--text-muted, #888);">{domain}</div>
      <div style="font-weight:700; font-size:0.95rem; margin:2px 0;">{title || 'Untitled'}</div>
      <div style="font-size:0.82rem; color:var(--text-muted, #666);">{description || 'No description set.'}</div>
    </div>
  </div>
{/snippet}

{#if loading}
  <div class="inline-spinner">Loading...</div>
{:else}
  <div>
    <h2 style="margin-bottom:6px;">SEO &amp; Link Preview</h2>
    <p style="font-size:0.9rem; color:var(--text-muted); margin-bottom:16px;">
      Control how each portal appears in search engines and when its link is shared
      (WhatsApp, Facebook, X). Save your changes, then press <strong>Publish</strong> to
      rebuild a portal so the new preview goes live.
    </p>

    {#if error}<div class="glass-card" style="border-color:var(--danger); color:var(--danger); margin-bottom:12px; padding:12px;">{error}</div>{/if}
    {#if notice}<div class="glass-card" style="border-color:var(--success); color:var(--success); margin-bottom:12px; padding:12px;">{notice}</div>{/if}

    <div class="glass-card" style="margin-bottom:18px; padding:16px;">
      <h3 style="margin-bottom:12px;">Public Portal — chhath.shaharpura.com</h3>

      <label for={`${uid}-f1`} style={labelStyle}>Title</label>
      <input id={`${uid}-f1`} style={inputStyle} value={data.public.title} oninput={(e) => setPublic({ title: (e.currentTarget as HTMLInputElement).value })} placeholder="Navyuvak Chhath Puja Samiti Shaharpura" />

      <label for={`${uid}-f2`} style={labelStyle}>Description</label>
      <textarea id={`${uid}-f2`} style="{inputStyle} min-height:70px;" value={data.public.description} oninput={(e) => setPublic({ description: (e.currentTarget as HTMLTextAreaElement).value })} placeholder="Short summary shown under the title in search results and link previews."></textarea>

      <label for={`${uid}-f3`} style={labelStyle}>Keywords (comma separated)</label>
      <textarea id={`${uid}-f3`} style="{inputStyle} min-height:70px;" value={data.public.keywords} oninput={(e) => setPublic({ keywords: (e.currentTarget as HTMLTextAreaElement).value })} placeholder="Chhath Puja, Shaharpura, Gardih, Giridih, Jharkhand, ..."></textarea>

      <label for={`${uid}-f4`} style={labelStyle}>Preview Image (recommended 1200 × 630)</label>
      <input id={`${uid}-f4`} type="file" accept="image/*" onchange={(e) => uploadImage('public', (e.currentTarget as HTMLInputElement).files?.[0])} disabled={uploading === 'public'} style="margin-bottom:12px;" />
      {#if uploading === 'public'}<div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">Uploading...</div>{/if}

      <div style="margin-top:8px;">
        <div style={labelStyle}>Preview</div>
        {@render previewCard(data.public.image, data.public.title, data.public.description, 'chhath.shaharpura.com')}
      </div>
    </div>

    <div class="glass-card" style="margin-bottom:18px; padding:16px;">
      <h3 style="margin-bottom:12px;">Management Portal — mgmt-chhath.shaharpura.com</h3>

      <label for={`${uid}-f5`} style={labelStyle}>Title</label>
      <input id={`${uid}-f5`} style={inputStyle} value={data.mgmt.title} oninput={(e) => setMgmt({ title: (e.currentTarget as HTMLInputElement).value })} placeholder="Chhath Puja Management Portal" />

      <label for={`${uid}-f6`} style={labelStyle}>Description</label>
      <textarea id={`${uid}-f6`} style="{inputStyle} min-height:70px;" value={data.mgmt.description} oninput={(e) => setMgmt({ description: (e.currentTarget as HTMLTextAreaElement).value })} placeholder="Short summary for the management portal link preview."></textarea>

      <label for={`${uid}-f7`} style={labelStyle}>Preview Image (recommended 1200 × 630)</label>
      <input id={`${uid}-f7`} type="file" accept="image/*" onchange={(e) => uploadImage('mgmt', (e.currentTarget as HTMLInputElement).files?.[0])} disabled={uploading === 'mgmt'} style="margin-bottom:12px;" />
      {#if uploading === 'mgmt'}<div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">Uploading...</div>{/if}

      <div style="margin-top:8px;">
        <div style={labelStyle}>Preview</div>
        {@render previewCard(data.mgmt.image, data.mgmt.title, data.mgmt.description, 'mgmt-chhath.shaharpura.com')}
      </div>
    </div>

    <div class="glass-card" style="margin-bottom:18px; padding:16px;">
      <h3 style="margin-bottom:6px;">Deploy Hooks</h3>
      <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">
        A one-time setup. Paste the Vercel Deploy Hook URL for each portal so the
        Publish buttons can rebuild it. Leave a field blank to keep the existing hook.
      </p>

      <label for={`${uid}-f8`} style={labelStyle}>
        Public portal hook {#if data.deployHooks.publicConfigured}<span style="color:var(--success);">(configured)</span>{/if}
      </label>
      <input id={`${uid}-f8`} style={inputStyle} bind:value={publicHook} placeholder="https://api.vercel.com/v1/integrations/deploy/..." />

      <label for={`${uid}-f9`} style={labelStyle}>
        Management portal hook {#if data.deployHooks.mgmtConfigured}<span style="color:var(--success);">(configured)</span>{/if}
      </label>
      <input id={`${uid}-f9`} style={inputStyle} bind:value={mgmtHook} placeholder="https://api.vercel.com/v1/integrations/deploy/..." />
    </div>

    <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
      <button style={btn('var(--primary-saffron, #F97316)')} onclick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
      <button style={btn('#2563eb')} onclick={() => publish('public')} disabled={!!publishing || !data.deployHooks.publicConfigured}>
        {publishing === 'public' ? 'Publishing...' : 'Publish Public Portal'}
      </button>
      <button style={btn('#2563eb')} onclick={() => publish('mgmt')} disabled={!!publishing || !data.deployHooks.mgmtConfigured}>
        {publishing === 'mgmt' ? 'Publishing...' : 'Publish Management Portal'}
      </button>
    </div>
    <p style="font-size:0.8rem; color:var(--text-muted); margin-top:10px;">
      Save stores your changes instantly. Publish rebuilds a portal (about 1-2 minutes)
      so the new link preview and search tags take effect.
    </p>
  </div>
{/if}
