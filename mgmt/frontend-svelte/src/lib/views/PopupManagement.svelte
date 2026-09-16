<script lang="ts">
  // Ported from React views/PopupManagement.jsx — create/edit popups (title,
  // roles, active window, ordered image/text/link slides with upload) + a live
  // preview and a "preview as public" check. List view with status warnings.
  import { api, reportClientError } from '$lib/api';
  import { isTruthyFlag } from '$lib/flags';
  import { prepareImageForUpload } from '$lib/imagePrep';
  import Modal from '$lib/components/Modal.svelte';
  import PopupSlideshow from '$lib/components/PopupSlideshow.svelte';
  import { driveImageUrl, driveImgOnError } from '$lib/driveUrl';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  const ROLES = ['Superadmin', 'Admin', 'Subadmin', 'Public'];
  const DEFAULT_DURATION_MS = 5000;
  const MIN_DURATION_MS = 1000;
  const MAX_DURATION_MS = 60000;
  const BLANK_SLIDE = { imageUrl: '', text: '', linkUrl: '', linkText: '', durationMs: DEFAULT_DURATION_MS };

  function clampDurationMs(ms: unknown): number {
    const n = parseInt(ms as string, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MS;
    if (n < MIN_DURATION_MS) return MIN_DURATION_MS;
    if (n > MAX_DURATION_MS) return MAX_DURATION_MS;
    return n;
  }
  let __slideKeySeq = 0;
  const newSlide = (data?: any) => ({ ...BLANK_SLIDE, ...(data || {}), _key: `sl_${Date.now()}_${__slideKeySeq++}` });

  function fromLocalInputValue(local: string): string {
    if (!local) return '';
    const d = new Date(local);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }

  function normalizeStamp(raw: string): Date | null {
    const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
    let d = new Date(raw.replace(' ', 'T') + (hasZone ? '' : 'Z'));
    if (!isNaN(d.getTime())) return d;
    d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  function toLocalInputValue(iso: unknown): string {
    if (!iso) return '';
    const d = normalizeStamp(iso.toString().trim());
    if (!d) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtStamp(v: unknown): string | null {
    if (!v) return null;
    const d = normalizeStamp(v.toString().trim());
    return d ? d.toLocaleString('en-IN') : null;
  }

  const str = (v: unknown) => (v === undefined || v === null ? '' : v.toString());

  const linkBtnStyle = 'background:none; border:none; padding:0; font:inherit; color:var(--primary-saffron); text-decoration:underline; cursor:pointer;';

  let popups = $state<any[] | null>(null);
  let error = $state('');
  let editingId = $state<string | null>(null);
  let form = $state<any>({ title: '', roles: [...ROLES], active: true, startAt: '', endAt: '' });
  let slides = $state<any[]>([newSlide()]);
  let saving = $state(false);
  let uploadingSlide = $state<number | null>(null);
  let preview = $state<any>(null);
  let previewLoading = $state(false);
  let showLivePreview = $state(false);

  function refresh() {
    api.getPopups().then((p: any) => (popups = p)).catch((err: Error) => (error = err.message));
  }
  let loaded = false;
  $effect(() => {
    if (loaded) return;
    loaded = true;
    refresh();
  });

  function startNew() {
    editingId = 'new';
    form = { title: '', roles: [...ROLES], active: true, startAt: '', endAt: '' };
    slides = [newSlide()];
  }

  async function startEdit(popupId: string) {
    error = '';
    try {
      const { popup, slides: existingSlides }: any = await api.getPopupWithSlides(popupId);
      editingId = popupId;
      form = {
        title: str(popup.title),
        roles: (popup.roles || '').split(',').map((r: string) => r.trim()).filter(Boolean),
        active: isTruthyFlag(popup.active),
        startAt: toLocalInputValue(popup.start_at),
        endAt: toLocalInputValue(popup.end_at)
      };
      slides = existingSlides.length
        ? existingSlides.map((s: any) => newSlide({ imageUrl: str(s.image_url), text: str(s.text), linkUrl: str(s.link_url), linkText: str(s.link_text), durationMs: clampDurationMs(s.duration_ms) }))
        : [newSlide()];
    } catch (err) {
      error = (err as Error).message;
    }
  }

  function cancelEdit() { editingId = null; }

  function toggleRole(role: string) {
    form = { ...form, roles: form.roles.includes(role) ? form.roles.filter((r: string) => r !== role) : [...form.roles, role] };
  }

  function addSlide() { slides = [...slides, newSlide()]; }
  function removeSlide(i: number) { slides = slides.filter((_, idx) => idx !== i); }
  function moveSlide(i: number, dir: number) {
    const j = i + dir;
    if (j < 0 || j >= slides.length) return;
    const copy = [...slides];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    slides = copy;
  }
  function updateSlide(i: number, patch: any) {
    slides = slides.map((sl, idx) => (idx === i ? { ...sl, ...patch } : sl));
  }

  async function uploadSlideImage(i: number, file: File) {
    uploadingSlide = i;
    error = '';
    updateSlide(i, { imageError: '', imageBroken: false });
    try {
      const prepped = await prepareImageForUpload(file);
      const res: any = await api.uploadPopupImage(prepped.base64, prepped.fileName, prepped.mimeType);
      const imageUrl = res.imageUrl || res.directUrl || res.url;
      if (!imageUrl) throw new Error('The server did not return an image URL.');
      updateSlide(i, { imageUrl, imageError: '', imageBroken: false });
    } catch (err) {
      updateSlide(i, { imageError: (err as Error).message || 'Upload failed.' });
      error = `Slide ${i + 1} image upload failed: ${(err as Error).message}`;
      reportClientError('PopupManagement', 'Popup image upload failed', err as Error, {
        slide: i, fileName: file && file.name, fileType: file && file.type, fileSize: file && file.size
      });
    } finally {
      uploadingSlide = null;
    }
  }

  async function save() {
    saving = true;
    error = '';
    try {
      const title = str(form.title).trim();
      if (!title) throw new Error('Please enter a title');

      const usable = slides
        .filter((s) => str(s.imageUrl) || str(s.text).trim())
        .map((s) => ({
          imageUrl: str(s.imageUrl),
          text: str(s.text),
          linkUrl: str(s.linkUrl),
          linkText: str(s.linkText),
          durationMs: clampDurationMs(s.durationMs)
        }));
      if (!usable.length) throw new Error('At least one slide must have an image or text');
      if (!form.roles.length) throw new Error('Select at least one role, otherwise the popup will not be shown to anyone.');

      const popupId = editingId === 'new' ? undefined : (editingId ?? undefined);
      const res: any = await api.savePopup(
        popupId, title, form.roles, form.active,
        fromLocalInputValue(form.startAt), fromLocalInputValue(form.endAt)
      );
      const finalId = popupId || res.popup_id;
      await api.savePopupSlides(finalId, usable);
      editingId = null;
      refresh();
    } catch (err) {
      error = (err as Error).message;
      reportClientError('PopupManagement', 'Popup save failed', err as Error, { editingId });
    } finally {
      saving = false;
    }
  }

  async function runPreview() {
    previewLoading = true;
    error = '';
    try {
      preview = await api.previewPublicPopups();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      previewLoading = false;
    }
  }

  async function remove(popupId: string) {
    if (!confirm('Delete this popup? All its slides will be deleted as well.')) return;
    try {
      await api.deletePopup(popupId);
      refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const localTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  let livePreviewSlides = $derived(slides.filter((s) => s.imageUrl || (s.text || '').trim()));
</script>

{#if editingId}
  <h2 style="margin-bottom:15px;">{editingId === 'new' ? 'New Popup' : 'Edit Popup'}</h2>
  {#if error}<div role="alert" class="error-banner">{error}</div>{/if}

  <div class="glass-card" style="padding:15px; margin-bottom:15px;">
    <div class="form-group">
      <label for={`${uid}-f1`}>Title (for Superadmin reference only, not shown to viewers)</label>
      <input id={`${uid}-f1`} value={form.title} oninput={(e) => (form = { ...form, title: (e.currentTarget as HTMLInputElement).value })} />
    </div>

    <div class="form-group">
      <span id={`${uid}-roles-label`} class="form-label">Visible to which roles</span>
      <div role="group" aria-labelledby={`${uid}-roles-label`} style="display:flex; gap:12px; flex-wrap:wrap;">
        {#each ROLES as role (role)}
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="checkbox" checked={form.roles.includes(role)} onchange={() => toggleRole(role)} />
            {role}
          </label>
        {/each}
      </div>
      <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">
        "Public" shows this popup on the public transparency portal (chhathmanagment) on every page load — separate from the Superadmin/Admin/Subadmin roles, which only apply inside this mgmt portal.
      </div>
    </div>

    <label style="display:flex; align-items:center; gap:8px; margin:10px 0; cursor:pointer;">
      <input type="checkbox" checked={form.active} onchange={(e) => (form = { ...form, active: (e.currentTarget as HTMLInputElement).checked })} />
      Active
    </label>

    <div class="form-group">
      <label for={`${uid}-f2`}>Start Date &amp; Time</label>
      <input id={`${uid}-f2`} type="datetime-local" value={form.startAt} oninput={(e) => (form = { ...form, startAt: (e.currentTarget as HTMLInputElement).value })} />
    </div>
    <div class="form-group">
      <label for={`${uid}-f3`}>End Date &amp; Time</label>
      <input id={`${uid}-f3`} type="datetime-local" value={form.endAt} oninput={(e) => (form = { ...form, endAt: (e.currentTarget as HTMLInputElement).value })} />
      <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">
        You can leave both empty — the popup will then run with no time limit.
        The time is in your phone's local time ({localTz}).
      </div>
    </div>
  </div>

  <div class="glass-card" style="padding:15px; margin-bottom:15px;">
    <strong>Slides</strong>
    {#each slides as slide, i (slide._key ?? i)}
      <div style="background:#f9fafb; border-radius:8px; padding:12px; margin-top:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="font-size:0.85rem;">Slide {i + 1}</strong>
          <div style="display:flex; align-items:center; gap:10px;">
            {#if slides.length > 1}
              <!-- `disabled` replaces the cursor/opacity hint: a control that cannot act must
                   say so to the keyboard and to assistive tech, not only to the mouse. -->
              <button type="button" class="btn-bare material-icons-round" title="Upar le jaayein"
                aria-label="Move slide {i + 1} up" disabled={i === 0}
                style="opacity:{i === 0 ? 0.3 : 1}; font-size:1.1rem;"
                onclick={() => i > 0 && moveSlide(i, -1)}>arrow_upward</button>
              <button type="button" class="btn-bare material-icons-round" title="Neeche le jaayein"
                aria-label="Move slide {i + 1} down" disabled={i === slides.length - 1}
                style="opacity:{i === slides.length - 1 ? 0.3 : 1}; font-size:1.1rem;"
                onclick={() => i < slides.length - 1 && moveSlide(i, 1)}>arrow_downward</button>
              <button type="button" class="btn-bare material-icons-round" title="Delete"
                aria-label="Delete slide {i + 1}" style="color:var(--danger); font-size:1.1rem;"
                onclick={() => removeSlide(i)}>delete</button>
            {/if}
          </div>
        </div>

        <div class="form-group">
          <label for={`${uid}-slide-img-${i}`} style="font-size:0.8rem;">Image (optional)</label>
          <input id={`${uid}-slide-img-${i}`} type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif" onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) uploadSlideImage(i, f); }} />
          {#if uploadingSlide === i}<div class="inline-spinner">Uploading...</div>{/if}

          {#if slide.imageError}
            <div style="margin-top:8px; padding:8px 10px; border-radius:8px; background:#fdecea; color:var(--danger); font-size:0.8rem;">
              {slide.imageError}
            </div>
          {/if}

          {#if slide.imageUrl && !slide.imageBroken}
            <img
              src={driveImageUrl(slide.imageUrl)}
              alt=""
              style="max-width:100%; max-height:150px; margin-top:8px; border-radius:8px;"
              onerror={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                if (img.dataset.driveFallbackTried !== '1') {
                  driveImgOnError(slide.imageUrl)(e);
                  if (img.dataset.driveFallbackTried === '1') return;
                }
                updateSlide(i, { imageBroken: true });
              }}
              onload={() => slide.imageBroken && updateSlide(i, { imageBroken: false })}
            />
          {/if}

          {#if slide.imageUrl && slide.imageBroken}
            <div style="margin-top:8px; padding:10px; border-radius:8px; border:1px dashed var(--danger); font-size:0.8rem;">
              <div style="font-weight:600; color:var(--danger); margin-bottom:4px;">
                The image failed to load — it will not show on the public portal either
              </div>
              <div style="color:var(--text-muted); word-break:break-all; margin-bottom:6px;">{slide.imageUrl}</div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <a href={slide.imageUrl} target="_blank" rel="noreferrer">Open link</a>
                <button type="button" style={linkBtnStyle} onclick={() => updateSlide(i, { imageBroken: false })}>Try again</button>
                <button type="button" style={linkBtnStyle} onclick={() => updateSlide(i, { imageUrl: '', imageBroken: false, imageError: '' })}>Remove image</button>
              </div>
            </div>
          {/if}
        </div>

        <div class="form-group">
          <label for={`${uid}-slide-text-${i}`} style="font-size:0.8rem;">Text (optional)</label>
          <textarea id={`${uid}-slide-text-${i}`} rows={3} value={slide.text} oninput={(e) => updateSlide(i, { text: (e.currentTarget as HTMLTextAreaElement).value })} style="width:100%; padding:8px; border-radius:8px; border:1px solid #ddd;"></textarea>
        </div>

        <div class="form-group">
          <label for={`${uid}-slide-url-${i}`} style="font-size:0.8rem;">Link URL (optional)</label>
          <input id={`${uid}-slide-url-${i}`} value={slide.linkUrl} oninput={(e) => updateSlide(i, { linkUrl: (e.currentTarget as HTMLInputElement).value })} placeholder="https://..." />
        </div>
        {#if slide.linkUrl}
          <div class="form-group">
            <label for={`${uid}-slide-linktext-${i}`} style="font-size:0.8rem;">Link Text</label>
            <input id={`${uid}-slide-linktext-${i}`} value={slide.linkText} oninput={(e) => updateSlide(i, { linkText: (e.currentTarget as HTMLInputElement).value })} placeholder="e.g. More Info" />
          </div>
        {/if}

        <div class="form-group">
          <label for={`${uid}-slide-dur-${i}`} style="font-size:0.8rem;">Auto-play duration (seconds)</label>
          <input
            id={`${uid}-slide-dur-${i}`}
            type="number"
            min={MIN_DURATION_MS / 1000}
            max={MAX_DURATION_MS / 1000}
            step={1}
            value={Math.round((slide.durationMs ?? DEFAULT_DURATION_MS) / 1000)}
            oninput={(e) => {
              const secs = parseInt((e.currentTarget as HTMLInputElement).value, 10);
              updateSlide(i, { durationMs: Number.isFinite(secs) ? secs * 1000 : '' });
            }}
            onblur={() => updateSlide(i, { durationMs: clampDurationMs(slide.durationMs) })}
            style="max-width:120px;"
          />
          <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">
            {slides.length > 1
              ? `Is slide ke baad agli slide par jaane se pehle itni der rukega (${MIN_DURATION_MS / 1000}-${MAX_DURATION_MS / 1000}s). Aakhri slide ke baad wapas pehli par loop hota hai.`
              : `Auto-play sirf tab chalta hai jab 2 ya zyada slides hon — abhi ek hi slide hai.`}
          </div>
        </div>
      </div>
    {/each}
    <button type="button" class="btn-submit" style="width:auto; margin-top:10px; background:#e5e7eb; color:#111;" onclick={addSlide}>
      + Add Slide
    </button>
  </div>

  <div style="display:flex; gap:8px; flex-wrap:wrap;">
    <button class="btn-submit" style="width:auto;" onclick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    <button type="button" class="btn-submit" style="width:auto; background:#111827; color:#fff;" onclick={() => (showLivePreview = true)}>👁 Live Preview</button>
    <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={cancelEdit}>Cancel</button>
  </div>

  {#if showLivePreview}
    <Modal open onClose={() => (showLivePreview = false)} labelledBy="dlg-popupmanagement-368-title">
      <h3 id="dlg-popupmanagement-368-title" style="margin-top:0; margin-bottom:6px;">Live Preview</h3>
      <p style="font-size:0.75rem; color:var(--text-muted); margin-top:0; margin-bottom:14px;">
        Bilkul waisa hi jaisa public portal par dikhega — auto-play + loop chal raha hai; mouse le jaane par ruk jaata hai.
      </p>
      <PopupSlideshow slides={livePreviewSlides} />
    </Modal>
  {/if}
{:else}
  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
    <h2 style="margin:0;">Popup Management</h2>
    <button type="button" class="btn-submit" style="width:auto; padding:6px 12px; font-size:0.8rem; background:#e5e7eb; color:#111;" onclick={runPreview} disabled={previewLoading}>
      {previewLoading ? 'Checking...' : '👁 Preview as Public'}
    </button>
  </div>
  <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:12px;">
    Popups are independent of the year — the year selector above does not apply to them.
  </p>
  {#if error}<div role="alert" class="error-banner">{error}</div>{/if}

  {#if preview}
    <div class="glass-card" style="padding:15px; margin-bottom:15px;">
      <strong style="font-size:0.9rem;">What will show on the public portal right now</strong>
      {#if preview.shown.length === 0}
        <p style="font-size:0.8rem; color:var(--text-muted); margin:8px 0 0;">
          Nothing. To appear on the public portal, a popup must have the <strong>Public</strong> role,
          be Active, fall within its date window, and have at least 1 slide.
        </p>
      {:else}
        <p style="font-size:0.8rem; margin:8px 0 0;">
          ✅ <strong>{preview.shown[0].title}</strong> ({preview.shown[0].slides.length} slide{preview.shown[0].slides.length === 1 ? '' : 's'})
        </p>
      {/if}
      {#if preview.alsoEligibleButNotShown.length > 0}
        <div style="background:#FEF3C7; color:#92400E; border-radius:6px; padding:6px 10px; font-size:0.75rem; margin-top:8px;">
          ⚠️ The public portal shows only the <strong>first</strong> popup at a time. These are eligible but
          will not show: {preview.alsoEligibleButNotShown.map((x: any) => x.title).join(', ')}. Set their start/end
          times to different windows.
        </div>
      {/if}
      {#if preview.droppedNoSlides.length > 0}
        <div style="background:#FEE2E2; color:#991B1B; border-radius:6px; padding:6px 10px; font-size:0.75rem; margin-top:8px;">
          ⚠️ Dropped because they have no slides: {preview.droppedNoSlides.map((x: any) => x.title).join(', ')}
        </div>
      {/if}
      <button type="button" class="btn-submit" style="width:auto; margin-top:10px; padding:4px 10px; font-size:0.75rem; background:#e5e7eb; color:#111;" onclick={() => (preview = null)}>Close</button>
    </div>
  {/if}

  {#if !popups}<div class="inline-spinner">Loading...</div>{/if}
  {#if popups && popups.length === 0}<div class="glass-card" style="text-align:center; padding:20px;">No popups have been created yet.</div>{/if}

  {#each popups || [] as p (p.popup_id)}
    {@const isActive = isTruthyFlag(p.active)}
    {@const noSlides = p.slide_count === 0}
    {@const start = fmtStamp(p.start_at)}
    {@const end = fmtStamp(p.end_at)}
    {@const now = Date.now()}
    {@const notYet = p.start_at && new Date(p.start_at).getTime() > now}
    {@const over = p.end_at && new Date(p.end_at).getTime() < now}
    {@const liveNow = isActive && !noSlides && !notYet && !over}
    <div class="glass-card" style="padding:15px; margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
        <div>
          <strong>{p.title}</strong>
          <div style="font-size:0.8rem; color:var(--text-muted);">{p.roles || 'All roles'}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">{start || 'No start'} — {end || 'No end'}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">{p.slide_count} slide{p.slide_count === 1 ? '' : 's'}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;">
          <span class="badge {isActive ? 'badge-ok' : 'badge-warn'}">{isActive ? 'Active' : 'Inactive'}</span>
          {#if liveNow}<span class="badge badge-ok" style="font-size:0.65rem;">Showing now</span>{/if}
        </div>
      </div>

      {#if isActive && noSlides}
        <div style="background:#FEE2E2; color:#991B1B; border-radius:6px; padding:6px 10px; font-size:0.75rem; margin-top:8px;">
          ⚠️ This popup has no slides — it will <strong>not</strong> be shown to anyone. Edit it to add a slide.
        </div>
      {/if}
      {#if isActive && notYet}
        <div style="background:#FEF3C7; color:#92400E; border-radius:6px; padding:6px 10px; font-size:0.75rem; margin-top:8px;">
          ⏳ The start time has not arrived yet ({start}) — it will not show until then.
        </div>
      {/if}
      {#if isActive && over}
        <div style="background:#FEF3C7; color:#92400E; border-radius:6px; padding:6px 10px; font-size:0.75rem; margin-top:8px;">
          ⌛ The end time has passed ({end}) — it will no longer show.
        </div>
      {/if}
      <div class="row-actions" style="margin-top:10px;">
        <button type="button" class="icon-btn" title="Edit" onclick={() => startEdit(p.popup_id)}>
          <span class="material-icons-round" style="font-size:16px;">edit</span>
        </button>
        <button type="button" class="icon-btn icon-danger" title="Delete" onclick={() => remove(p.popup_id)}>
          <span class="material-icons-round" style="font-size:16px;">delete</span>
        </button>
      </div>
    </div>
  {/each}

  <button class="fab" onclick={startNew}><span class="material-icons-round">add</span></button>
{/if}
