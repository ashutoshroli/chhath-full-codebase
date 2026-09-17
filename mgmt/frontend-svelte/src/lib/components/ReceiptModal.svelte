<script lang="ts">
  // Ported from React ReceiptModal.jsx — previews a receipt/certificate/material
  // doc from its saved template, generates a filled DOCX->PDF (server), and falls
  // back to an html2canvas+jsPDF image PDF when no .docx template exists.
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import html2canvas from 'html2canvas';
  import jsPDF from 'jspdf';
  import { api, reportClientError } from '$lib/api';
  import { renderReceiptTemplate, PAGE_SIZES_MM } from '$lib/receiptTemplate';
  import { generateQrDataUrl, publicRecordUrl } from '$lib/qrCode';
  import Modal from './Modal.svelte';
  import ReportErrorButton from './ReportErrorButton.svelte';

  interface Props {
    row: any;
    year: string;
    open: boolean;
    onClose: () => void;
    docType?: string;
  }
  let { row, year, open, onClose, docType = 'receipt' }: Props = $props();

  const DOC_CONFIG: Record<string, { label: string; docNoKey: string; fetch: (rowIndex: number, year: string) => Promise<any> }> = {
    receipt: { label: 'Receipt', docNoKey: 'RECEIPT_NO', fetch: (rowIndex, year) => api.getReceiptData(rowIndex, year) },
    receipt_work: { label: 'Work Receipt', docNoKey: 'RECEIPT_NO', fetch: (rowIndex, year) => api.getReceiptData(rowIndex, year) },
    certificate: { label: 'Certificate', docNoKey: 'CERT_NO', fetch: (rowIndex, year) => api.getCertificateData(rowIndex, year) },
    samaan: { label: 'Material Receipt', docNoKey: 'SAMAAN_NO', fetch: (rowIndex, year) => api.getSamaanData(rowIndex, year) }
  };

  let data = $state<any>(null);
  let loading = $state(true);
  let error = $state('');
  const generatedAt = new Date().toLocaleString('en-IN');
  let downloading = $state(false);
  let qrCode = $state('');
  let qrWarning = $state(false);
  let warning = $state('');
  let previewRef: HTMLDivElement | undefined = $state();

  let cfg = $derived(DOC_CONFIG[docType] || DOC_CONFIG.receipt);

  function openDownload(url: string) {
    if (!url) throw new Error('The server did not return a download link.');
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      if (!document.hidden) {
        try { window.location.assign(url); } catch (e) { /* ignore */ }
      }
    }, 1200);
  }

  async function snapshotToPdf(node: HTMLElement, pageSizeKey: string, fileName: string) {
    if (document.fonts && (document.fonts as any).ready) {
      try { await (document.fonts as any).ready; } catch (e) { /* ignore */ }
    }
    const canvas = await html2canvas(node, { scale: 3, useCORS: true, backgroundColor: '#ffffff' });
    const { width, height } = PAGE_SIZES_MM[pageSizeKey] || PAGE_SIZES_MM.A5;
    const doc = new jsPDF({ unit: 'mm', format: [width, height] });

    const pxPerMm = canvas.width / width;
    const pageHeightPx = Math.floor(height * pxPerMm);
    const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

    for (let page = 0; page < totalPages; page++) {
      const sliceTop = page * pageHeightPx;
      const sliceHeight = Math.min(pageHeightPx, canvas.height - sliceTop);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceHeight;
      const ctx = slice.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, sliceTop, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      if (page > 0) doc.addPage([width, height]);
      doc.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, width, sliceHeight / pxPerMm);
    }
    doc.save(fileName);
    return { pages: totalPages };
  }

  // React: useEffect on [open, row, year, docType].
  let lastKey = '';
  $effect(() => {
    const key = `${open}|${row?.__rowIndex}|${year}|${docType}`;
    if (key === lastKey) return;
    lastKey = key;
    if (!open || !row) return;
    loading = true;
    error = '';
    qrCode = '';
    cfg.fetch(row.__rowIndex, year)
      .then((d: any) => (data = d))
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
    const recordId = `${docType}-${year}-${row.__rowIndex}`;
    generateQrDataUrl(publicRecordUrl(recordId))
      .then((q) => (qrCode = q))
      .catch((err) => {
        qrWarning = true;
        reportClientError('ReceiptModal', `QR generation failed for ${recordId}`, err as Error, { docType, year, recordId });
      });
  });

  async function download() {
    downloading = true;
    error = '';
    warning = '';
    const recordId = `${docType}-${year}-${row.__rowIndex}`;
    try {
      // The browser no longer fills the .docx. We send the record's fill DATA; the Worker
      // resolves the template and Render fills it (+ server-generated QR) then converts.
      // QR_CODE is generated on Render from the derived recordId (the HTML preview still
      // uses the browser QR for on-screen display).
      const placeholders = { ...data.placeholders, GENERATED_AT: generatedAt };
      const fileName = `${cfg.label}-${data.placeholders[cfg.docNoKey] || recordId}.docx`;

      let res: any;
      try {
        res = await api.convertDocxToPdfBulk(docType, year, recordId, placeholders, fileName);
      } catch (err) {
        // No server template (or Render unavailable): fall back to an image-based PDF of
        // the on-screen preview, which will not be indexed on the public portal.
        if (!previewRef) {
          throw new Error('The preview is not ready — please close the modal and open it again.');
        }
        await snapshotToPdf(previewRef, data.pageSize, `${cfg.label}-${data.placeholders[cfg.docNoKey] || recordId}.pdf`);
        warning =
          `No .docx template was available for this year (${year}), so an image-based PDF of the preview was generated. ` +
          'This PDF will not be available on the public portal — ask a Superadmin to upload a template under Document Templates.';
        return;
      }

      const missing = res && res.report && Array.isArray(res.report.missingTags) ? res.report.missingTags : [];
      const missingImg = res && res.report && Array.isArray(res.report.missingImages) ? res.report.missingImages : [];
      if (missing.length || missingImg.length) {
        reportClientError('ReceiptModal',
          `Template rendered with unresolved placeholders for ${recordId}`,
          undefined,
          { docType, year, recordId, missingTags: missing, missingImages: missingImg });
      }

      if (res && res.indexFailed) {
        warning = res.error || 'The PDF was generated but was not indexed on the public portal.';
        reportClientError('ReceiptModal', `PDF generated but NOT indexed: ${recordId}`, undefined,
          { docType, year, recordId, publicLink: res.publicLink });
      }

      openDownload(res.publicLink);
    } catch (err) {
      error = 'An error occurred while generating the PDF: ' + (err as Error).message;
      reportClientError('ReceiptModal', `PDF generation failed for ${recordId}`, err as Error, { docType, year, recordId });
    } finally {
      downloading = false;
    }
  }

  let pageSize = $derived(data ? (PAGE_SIZES_MM[data.pageSize] || PAGE_SIZES_MM.A5) : PAGE_SIZES_MM.A5);
  let html = $derived(
    data && data.templateFound
      ? DOMPurify.sanitize(
          marked.parse(renderReceiptTemplate(data.templateText, { ...data.placeholders, GENERATED_AT: generatedAt, QR_CODE: qrCode })) as string
        )
      : ''
  );
</script>

<Modal {open} {onClose} labelledBy="dlg-receiptmodal-178-title">
  <h3 id="dlg-receiptmodal-178-title" style="margin-bottom:15px;">{cfg.label}</h3>
  {#if loading}<div class="inline-spinner">Loading...</div>{/if}
  {#if error}<div role="alert" class="error-banner">{error}</div>{/if}
  {#if warning}
    <div style="background:#FEF3C7; color:#92400E; border-radius:8px; padding:8px 12px; font-size:0.8rem; margin-bottom:10px;">
      ⚠️ {warning}
    </div>
  {/if}
  {#if qrWarning}
    <div style="background:#FEF3C7; color:#92400E; border-radius:8px; padding:8px 12px; font-size:0.8rem; margin-bottom:10px;">
      ⚠️ The QR code could not be generated — this document's QR will be blank.
    </div>
  {/if}

  {#if !loading && data && !data.templateFound}
    <div style="text-align:center; padding:20px;">
      <p style="font-size:1rem; font-weight:600; margin-bottom:8px;">{cfg.label} Not Found</p>
      <p style="font-size:0.85rem; color:var(--text-muted);">
        No {cfg.label} template has been created for Year {year}. Please report this to the Superadmin.
      </p>
      <ReportErrorButton page={cfg.label} message={`${cfg.label} template missing for year ${year}`} />
    </div>
  {/if}

  {#if !loading && data && data.templateFound}
    <div
      bind:this={previewRef}
      class="consent-doc"
      style="width:{pageSize.width}mm; min-height:{pageSize.height}mm; margin:0 auto 15px; background:#fff; padding:10mm; border:1px solid #eee; box-sizing:border-box;"
    >
      {@html html}
    </div>
    <button class="btn-submit" onclick={download} disabled={downloading}>
      {downloading ? 'Generating PDF...' : '⬇ Download PDF'}
    </button>
  {/if}
</Modal>
