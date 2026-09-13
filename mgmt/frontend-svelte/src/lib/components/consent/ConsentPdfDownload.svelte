<script lang="ts">
  // Ported from the ConsentPdfDownload sub-component of React views/ConsentPage.jsx
  // — after a decision, if a public .docx consent template exists, fills it
  // (lazy docxFill) with a QR and downloads the converted PDF.
  import { api, reportClientError } from '$lib/api';
  import { safeImport } from '$lib/chunkGuard';
  import { generateQrDataUrl, publicRecordUrl } from '$lib/qrCode';
  import ReportErrorButton from '$lib/components/ReportErrorButton.svelte';

  interface Props {
    role: string;
    fundYear: string;
    placeholders: Record<string, unknown>;
    consentId: string;
    docTypeFromServer: string;
    token: string;
  }
  let { role, fundYear, placeholders, consentId, docTypeFromServer, token }: Props = $props();

  let docType = $derived(docTypeFromServer || (role === 'loaner' ? 'consent_loaner' : 'consent_guarantor'));
  let consentRefId = $derived(consentId || (placeholders.CONSENT_ID as string));

  let templateRow = $state<any>(null);
  let checked = $state(false);
  let downloading = $state(false);
  let qrCode = $state('');
  let error = $state('');

  // React: useEffect on [docType, fundYear, token] — load the public template.
  let lastTplKey = '';
  $effect(() => {
    const key = `${docType}|${fundYear}|${token}`;
    if (key === lastTplKey) return;
    lastTplKey = key;
    let alive = true;
    api.getDocxTemplatePublic(docType, fundYear, token)
      .then((row: any) => { if (alive) templateRow = row; })
      .catch((err: Error) => { if (alive) reportClientError('ConsentPage', `Consent template load failed (${docType}/${fundYear})`, err, { docType, fundYear }); })
      .finally(() => { if (alive) checked = true; });
    return () => { alive = false; };
  });

  // React: useEffect on [docType, fundYear, consentRefId] — build the QR.
  let lastQrKey = '';
  $effect(() => {
    if (!consentRefId) return;
    const key = `${docType}|${fundYear}|${consentRefId}`;
    if (key === lastQrKey) return;
    lastQrKey = key;
    const recordId = `${docType}-${fundYear}-${consentRefId}`;
    generateQrDataUrl(publicRecordUrl(recordId))
      .then((q) => (qrCode = q))
      .catch((err) => reportClientError('ConsentPage', `QR generation failed for ${recordId}`, err as Error, { docType, fundYear, recordId }));
  });

  async function download() {
    downloading = true;
    error = '';
    try {
      const { fillDocxTemplateFromRow, getLastRenderReport } = await safeImport(() => import('$lib/docxFill'), 'docxFill');
      const filledBase64 = await fillDocxTemplateFromRow(templateRow, { ...placeholders, GENERATED_AT: new Date().toLocaleString('en-IN'), QR_CODE: qrCode });

      const rep = getLastRenderReport();
      if (rep.missingTags.length) {
        reportClientError('ConsentPage', 'Consent template had unresolved placeholders', undefined,
          { docType, fundYear, consentId: consentRefId, missingTags: [...new Set(rep.missingTags)] });
      }

      const res: any = await api.convertDocxToPdfPublic(filledBase64, token);

      if (res && res.indexFailed) {
        reportClientError('ConsentPage', `Consent PDF generated but NOT indexed (${consentRefId})`, undefined,
          { docType, fundYear, consentId: consentRefId, publicLink: res.publicLink });
      }

      const a = document.createElement('a');
      a.href = res.publicLink;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      error = 'There was a problem while generating the PDF: ' + (err as Error).message;
      reportClientError('ConsentPage', `Consent PDF generation failed (${consentRefId})`, err as Error, { docType, fundYear, consentId: consentRefId });
    } finally {
      downloading = false;
    }
  }
</script>

{#if checked && templateRow && (templateRow.base64 || templateRow.downloadUrl)}
  <button class="btn-submit" style="margin-top:12px; width:auto;" onclick={download} disabled={downloading}>
    {downloading ? 'Generating PDF...' : '⬇ Download PDF'}
  </button>
  {#if error}
    <div style="color:var(--danger); font-size:0.85rem; margin-top:8px;">{error}</div>
    <ReportErrorButton page="Consent PDF" message={error} />
  {/if}
{/if}
