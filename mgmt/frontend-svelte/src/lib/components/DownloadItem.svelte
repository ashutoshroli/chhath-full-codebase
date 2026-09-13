<script lang="ts">
  // Ported from the inner DownloadItem of React views/DownloadCenter.jsx — one
  // downloadable record: generate (fill docx -> convert to PDF) or link out.
  import { api, reportClientError } from '$lib/api';
  import { fillDocxTemplateFromRow, getLastRenderReport } from '$lib/docxFill';
  import { generateQrDataUrl, publicRecordUrl } from '$lib/qrCode';

  interface Props {
    item: any;
    onGenerated: (recordId: string, publicLink: string) => void;
    canGenerate: boolean;
  }
  let { item, onGenerated, canGenerate }: Props = $props();

  let busy = $state(false);
  let error = $state('');
  let warning = $state('');

  async function generate() {
    busy = true;
    error = '';
    warning = '';
    try {
      let templateRow: any;
      try {
        templateRow = await api.getDocxTemplateForDoc(item.docType, item.year);
      } catch (err) {
        reportClientError('DownloadCenter', `Template load failed for ${item.docType} ${item.year}`, err as Error,
          { docType: item.docType, year: item.year, recordId: item.recordId });
        error = `Template failed to load: ${(err as Error).message}`;
        return;
      }
      if (!templateRow || (!templateRow.base64 && !templateRow.downloadUrl)) {
        error = 'No .docx template exists for this year/type (upload one in the Document Templates tab).';
        return;
      }

      let qrCode = '';
      try {
        qrCode = await generateQrDataUrl(publicRecordUrl(item.recordId));
      } catch (qrErr) {
        warning = 'QR generation failed — the QR in the PDF will be blank.';
        reportClientError('DownloadCenter', `QR generation failed for ${item.recordId}`, qrErr as Error,
          { docType: item.docType, year: item.year, recordId: item.recordId });
      }

      const filledBase64 = await fillDocxTemplateFromRow(templateRow, { ...item.placeholders, GENERATED_AT: new Date().toLocaleString('en-IN'), QR_CODE: qrCode });

      const rep = getLastRenderReport();
      if (rep.missingTags.length) {
        warning = `Blank placeholders: ${[...new Set(rep.missingTags)].join(', ')}`;
        reportClientError('DownloadCenter', `Unresolved placeholders for ${item.recordId}`, undefined,
          { docType: item.docType, year: item.year, recordId: item.recordId, missingTags: [...new Set(rep.missingTags)] });
      }

      const fileName = `${item.fileNameHint}.docx`;
      const res: any = await api.convertDocxToPdfBulk(item.docType, item.year, item.recordId, filledBase64, fileName);

      if (res && res.indexFailed) {
        warning = res.error || 'The PDF was generated but not indexed in the public portal.';
        reportClientError('DownloadCenter', `PDF generated but NOT indexed: ${item.recordId}`, undefined,
          { docType: item.docType, year: item.year, recordId: item.recordId, publicLink: res.publicLink });
      }

      onGenerated(item.recordId, res.publicLink);
    } catch (err) {
      error = (err as Error).message;
      reportClientError('DownloadCenter', `Generate failed for ${item.recordId}`, err as Error,
        { docType: item.docType, year: item.year, recordId: item.recordId });
    } finally {
      busy = false;
    }
  }
</script>

<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 0; border-bottom:1px solid #f0f0f0; flex-wrap:wrap;">
  <div>
    <div style="font-size:0.9rem;">{item.label}</div>
    {#if error}<div style="font-size:0.75rem; color:var(--danger);">{error}</div>{/if}
    {#if warning}<div style="font-size:0.75rem; color:#92400E;">⚠️ {warning}</div>{/if}
  </div>
  {#if item.publicLink}
    <a href={item.publicLink} target="_blank" rel="noreferrer" class="btn-submit" style="width:auto; padding:6px 14px; font-size:0.85rem; text-decoration:none; text-align:center;">
      ⬇ Download
    </a>
  {:else if canGenerate}
    <button class="btn-submit" style="width:auto; padding:6px 14px; font-size:0.85rem; background:#e5e7eb; color:#111;" onclick={generate} disabled={busy}>
      {busy ? 'Generating...' : 'Generate Now'}
    </button>
  {:else}
    <span class="badge" style="background:#f3f4f6; color:var(--text-muted);">Not Available</span>
  {/if}
</div>
