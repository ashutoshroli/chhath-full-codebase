<script lang="ts">
  // Shared editor backing ReceiptTemplates / CertificateTemplates /
  // SamaanTemplates — those three React views are identical except for the
  // heading, sample placeholders, placeholder hints, delete-confirm label and
  // the api method group. Behaviour/markup is a 1:1 port; the differences are
  // passed in as props so the three views stay byte-for-byte equivalent.
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { renderReceiptTemplate, PAGE_SIZES_MM } from '$lib/receiptTemplate';
  import { generateQrDataUrl, publicRecordUrl } from '$lib/qrCode';

  interface ApiGroup {
    list: () => Promise<any[]>;
    get: (year: string) => Promise<any>;
    save: (year: string, text: string, pageSize: string) => Promise<any>;
    copy: (fromYear: string, toYear: string) => Promise<any>;
    remove: (year: string) => Promise<any>;
  }
  interface Props {
    heading: string;
    deleteLabel: string; // e.g. "receipt template", "certificate template", "Material template"
    samplePlaceholders: Record<string, unknown>;
    placeholderHints: string[];
    apiGroup: ApiGroup;
  }
  let { heading, deleteLabel, samplePlaceholders, placeholderHints, apiGroup }: Props = $props();

  let templates = $state<any[]>([]);
  let year = $state<number | null>(null);
  let text = $state('');
  let pageSize = $state('A5');
  let loading = $state(true);
  let saving = $state(false);
  let preview = $state(false);
  let error = $state('');
  let newYear = $state('');
  let copyTarget = $state('');
  let showCopy = $state(false);
  let sampleQr = $state('');

  // Sample QR once on mount.
  $effect(() => {
    generateQrDataUrl(publicRecordUrl('sample-preview')).then((q) => (sampleQr = q)).catch(() => {});
  });

  function refreshList() {
    apiGroup.list()
      .then((list: any[]) => {
        templates = list;
        if (list.length && year === null) year = list[0].Year;
      })
      .catch((err: Error) => (error = err.message));
  }

  // Initial list load (once).
  let listLoaded = false;
  $effect(() => {
    if (listLoaded) return;
    listLoaded = true;
    refreshList();
  });

  // Load the selected year's template (matches useEffect [year]).
  let lastYear: number | null | undefined = undefined;
  $effect(() => {
    const y = year;
    if (y === lastYear) return;
    lastYear = y;
    if (y === null) { loading = false; return; }
    loading = true;
    error = '';
    apiGroup.get(String(y))
      .then((row: any) => {
        text = row ? row['Template Text'] : '';
        pageSize = row ? row['Page Size'] : 'A5';
      })
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
  });

  async function save() {
    saving = true;
    error = '';
    try {
      await apiGroup.save(String(year), text, pageSize);
      refreshList();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function createNew() {
    if (!newYear) return;
    saving = true;
    error = '';
    try {
      await apiGroup.save(newYear, text || '', 'A5');
      year = parseInt(newYear);
      newYear = '';
      refreshList();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function doCopy() {
    if (!copyTarget) return;
    saving = true;
    error = '';
    try {
      await apiGroup.copy(String(year), copyTarget);
      year = parseInt(copyTarget);
      copyTarget = '';
      showCopy = false;
      refreshList();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!confirm(`Delete the ${deleteLabel} for Year ${year}?`)) return;
    try {
      await apiGroup.remove(String(year));
      year = null;
      refreshList();
    } catch (err) {
      error = (err as Error).message;
    }
  }

  let previewHtml = $derived(
    preview
      ? DOMPurify.sanitize(
          marked.parse(renderReceiptTemplate(text, { ...samplePlaceholders, QR_CODE: sampleQr })) as string
        )
      : ''
  );
  let size = $derived(PAGE_SIZES_MM[pageSize] || PAGE_SIZES_MM.A5);
</script>

<h2 style="margin-bottom:15px;">{heading}</h2>
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}

<div class="glass-card" style="padding:15px; margin-bottom:15px;">
  <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
    {#each templates as t (t.Year)}
      <button class="nav-btn {year === t.Year ? 'active' : ''}" onclick={() => (year = t.Year)}>{t.Year}</button>
    {/each}
    <button class="nav-btn" onclick={() => (showCopy = !showCopy)} disabled={!year}>Copy as New Year</button>
  </div>

  {#if showCopy}
    <div style="display:flex; gap:8px; margin-bottom:10px; align-items:center;">
      <input placeholder="New year (e.g. 2027)" type="number" bind:value={copyTarget} style="max-width:160px;" />
      <button class="btn-submit" style="width:auto;" onclick={doCopy} disabled={saving || !copyTarget}>Copy</button>
    </div>
  {/if}

  <div style="display:flex; gap:8px; align-items:center;">
    <input placeholder="Add new year" type="number" bind:value={newYear} style="max-width:160px;" />
    <button class="btn-submit" style="width:auto;" onclick={createNew} disabled={saving || !newYear}>+ Add</button>
  </div>
</div>

{#if year !== null}
  <div class="glass-card" style="padding:15px;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
      <strong>Year {year}</strong>
      <div class="form-group" style="margin:0;">
        <select bind:value={pageSize}>
          <option value="A5">A5</option>
          <option value="A4">A4</option>
        </select>
      </div>
    </div>

    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;">
      {#each placeholderHints as p (p)}
        <code style="background:#f3f4f6; padding:2px 6px; border-radius:4px; font-size:0.7rem;">[{p}]</code>
      {/each}
    </div>
    <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:10px;">
      Conditional section: <code>{'{{#IF FATHER_NAME}}...{{/IF}}'}</code> — if that field's data is empty, the entire block will be hidden.
    </p>
    <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:10px;">
      QR Code: add <code>{'<img src="[QR_CODE]" width="90" height="90" />'}</code> anywhere in the template to show a scannable QR that links to this record on the public portal.
      {#if sampleQr}
        Sample: <img src={sampleQr} alt="Sample QR" width={40} height={40} style="vertical-align:middle; margin-left:6px; border:1px solid #ddd;" />
      {/if}
    </p>

    {#if loading}
      <div class="inline-spinner">Loading...</div>
    {:else}
      <div style="display:flex; gap:8px; margin-bottom:10px;">
        <button class="btn-submit" style="width:auto;" onclick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={() => (preview = !preview)}>
          {preview ? 'Edit' : 'Preview'}
        </button>
        <button type="button" class="btn-submit" style="width:auto; background:var(--danger);" onclick={remove}>Delete</button>
      </div>

      {#if preview}
        <div
          class="consent-doc"
          style="width:{size.width}mm; min-height:{size.height}mm; margin:0 auto; background:#fff; padding:10mm; border:1px solid #eee; box-sizing:border-box;"
        >
          {@html previewHtml}
        </div>
      {:else}
        <textarea
          bind:value={text}
          rows={22}
          style="width:100%; font-family:monospace; font-size:0.8rem; padding:10px; border-radius:8px; border:1px solid #ddd;"
        ></textarea>
      {/if}
    {/if}
  </div>
{/if}
