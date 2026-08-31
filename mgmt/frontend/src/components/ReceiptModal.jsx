import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { api, reportClientError } from '../api.js';
import { renderReceiptTemplate, PAGE_SIZES_MM } from '../receiptTemplate.js';
import { fillDocxTemplateFromRow, getLastRenderReport } from '../docxFill.js';
import { generateQrDataUrl, publicRecordUrl } from '../qrCode.js';
import Modal from './Modal.jsx';
import ReportErrorButton from './ReportErrorButton.jsx';

// docType: 'receipt' | 'certificate' | 'samaan' — same preview engine, different
// backend data source. Preview always stays the Markdown view below; Download
// uses a Superadmin-uploaded .docx template if one exists for this (docType,
// year) — filled client-side (docxtemplater) then converted to PDF via Drive
// on the backend — otherwise it falls back to snapshotting the preview
// itself, so nothing ever breaks even for years with no docx template yet.
const DOC_CONFIG = {
  receipt: { label: 'Receipt', docNoKey: 'RECEIPT_NO', fetch: (rowIndex, year) => api.getReceiptData(rowIndex, year) },
  certificate: { label: 'Certificate', docNoKey: 'CERT_NO', fetch: (rowIndex, year) => api.getCertificateData(rowIndex, year) },
  samaan: { label: 'Material Receipt', docNoKey: 'SAMAAN_NO', fetch: (rowIndex, year) => api.getSamaanData(rowIndex, year) },
};

// The Drive link is cross-origin, so the `download` attribute is IGNORED by the
// browser (the file always arrives with Drive's own name) — that made the old
// `a.download = '...pdf'` dead code. The anchor was also never appended to the
// DOM and .click() ran several awaits after the user's gesture, so Safari and
// strict popup blockers swallowed it and the user just saw the spinner stop.
// Appending the node and falling back to window.location makes it reliable.
function openDownload(url) {
  if (!url) throw new Error('Download link server se nahi mila.');
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // If a popup blocker ate the click, navigate directly.
  setTimeout(() => {
    if (!document.hidden) {
      try { window.location.assign(url); } catch (e) { /* user can still copy the link */ }
    }
  }, 1200);
}

// Rasterised fallback used ONLY when no .docx template exists for the year.
//
// The old version put ONE html2canvas snapshot onto ONE page sized to the
// template's page size, so any receipt taller than a single A5/A4 page was
// silently CROPPED with no warning (the preview container is `minHeight`, so it
// can legitimately grow). This slices the canvas across as many pages as needed.
// It also waits for document.fonts, without which Devanagari text could be
// captured as tofu (□□□) INTO the archived PDF — there is no font embedding
// anywhere in this pipeline, the Hindi only survives because it's rasterised.
async function snapshotToPdf(node, pageSizeKey, fileName) {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* proceed with system fonts */ }
  }
  const canvas = await html2canvas(node, { scale: 3, useCORS: true, backgroundColor: '#ffffff' });
  const { width, height } = PAGE_SIZES_MM[pageSizeKey] || PAGE_SIZES_MM.A5;
  const doc = new jsPDF({ unit: 'mm', format: [width, height] });

  // Height of one page's worth of source pixels.
  const pxPerMm = canvas.width / width;
  const pageHeightPx = Math.floor(height * pxPerMm);
  const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

  for (let page = 0; page < totalPages; page++) {
    const sliceTop = page * pageHeightPx;
    const sliceHeight = Math.min(pageHeightPx, canvas.height - sliceTop);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = sliceHeight;
    const ctx = slice.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, sliceTop, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

    if (page > 0) doc.addPage([width, height]);
    doc.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, width, sliceHeight / pxPerMm);
  }
  doc.save(fileName);
  return { pages: totalPages };
}

export default function ReceiptModal({ row, year, open, onClose, docType = 'receipt' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generatedAt] = useState(() => new Date().toLocaleString('en-IN'));
  const [downloading, setDownloading] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [qrWarning, setQrWarning] = useState(false);
  const [warning, setWarning] = useState('');
  const previewRef = useRef(null);

  const { label, docNoKey, fetch: fetchData } = DOC_CONFIG[docType] || DOC_CONFIG.receipt;

  useEffect(() => {
    if (!open || !row) return;
    setLoading(true);
    setError('');
    setQrCode('');
    fetchData(row.__rowIndex, year).then(setData).catch(err => setError(err.message)).finally(() => setLoading(false));
    // QR points to the public portal, carrying the same recordId scheme already
    // used for Download Center / GENERATED_FILES matching.
    const recordId = `${docType}-${year}-${row.__rowIndex}`;
    generateQrDataUrl(publicRecordUrl(recordId))
      .then(setQrCode)
      // Was `.catch(() => {})`. A QR failure meant the archived PDF got a blank
      // QR and the public "Verified Record" scan for it broke — silently.
      .catch(err => {
        setQrWarning(true);
        reportClientError('ReceiptModal', `QR generation failed for ${recordId}`, err, { docType, year, recordId });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row, year, docType]);

  const download = async () => {
    setDownloading(true);
    setError('');
    setWarning('');
    const recordId = `${docType}-${year}-${row.__rowIndex}`;
    try {
      const placeholders = { ...data.placeholders, GENERATED_AT: generatedAt, QR_CODE: qrCode };

      let docxRow = null;
      try {
        docxRow = await api.getDocxTemplateForDoc(docType, year);
      } catch (err) {
        // Was `.catch(() => null)`, which turned a REAL failure (permissions, a
        // Drive error, the base64 stack overflow on templates with a logo) into
        // the misleading "no template exists" path — and then silently produced a
        // rasterised fallback PDF instead of the proper document.
        reportClientError('ReceiptModal', `Template fetch failed for ${docType} ${year}`, err, { docType, year, recordId });
        throw new Error(`${label} template load nahi hua: ${err.message}`);
      }

      if (docxRow && (docxRow.base64 || docxRow.downloadUrl)) {
        // Superadmin-uploaded .docx exists for this year — fill it and convert via Drive.
        const filledBase64 = await fillDocxTemplateFromRow(docxRow, placeholders);

        const rep = getLastRenderReport();
        if (rep.missingTags.length || rep.missingImages.length) {
          reportClientError('ReceiptModal',
            `Template rendered with unresolved placeholders for ${recordId}`,
            null,
            { docType, year, recordId, missingTags: rep.missingTags, missingImages: rep.missingImages });
        }

        const fileName = `${label}-${placeholders[docNoKey]}.docx`;
        // mode 'single' — one row's own document. This call used to omit the flag
        // entirely, which made the server demand Superadmin, so Admin/Subadmin
        // always got "Sirf Superadmin ye action kar sakta hai." even though the
        // download icon renders for every role.
        const res = await api.convertDocxToPdf(docType, year, recordId, filledBase64, fileName, 'single');

        // indexFailed was returned by the backend but checked by only 1 of the 6
        // callers — so the user got a working file while the public portal would
        // show "Not Available" forever, with nobody told.
        if (res && res.indexFailed) {
          setWarning(res.error || 'PDF ban gaya lekin public portal mein index nahi hua.');
          reportClientError('ReceiptModal', `PDF generated but NOT indexed: ${recordId}`, null,
            { docType, year, recordId, publicLink: res.publicLink });
        }

        openDownload(res.publicLink);
      } else {
        // No .docx template for this year yet — fall back to a snapshot of the preview.
        if (!previewRef.current) {
          // Was a bare `return` from inside the try: the spinner just stopped and
          // NOTHING was shown to the user or logged.
          throw new Error('Preview taiyaar nahi hai — modal band karke dobara kholein.');
        }
        await snapshotToPdf(previewRef.current, data.pageSize, `${label}-${placeholders[docNoKey]}.pdf`);
        setWarning(
          `Is saal (${year}) ke liye koi .docx template upload nahi hai, isliye preview ka image-based PDF diya gaya hai. ` +
          'Ye PDF public portal par available nahi hoga — Superadmin se Document Templates mein template upload karwayein.'
        );
      }
    } catch (err) {
      setError('An error occurred while generating the PDF: ' + err.message);
      // Client-side docx-fill / canvas / jsPDF failures never pass through
      // api.js's call(), so this was previously invisible in the Error Log.
      reportClientError('ReceiptModal', `PDF generation failed for ${recordId}`, err, { docType, year, recordId });
    } finally {
      setDownloading(false);
    }
  };

  const pageSize = data ? (PAGE_SIZES_MM[data.pageSize] || PAGE_SIZES_MM.A5) : PAGE_SIZES_MM.A5;
  const html = data && data.templateFound
    ? DOMPurify.sanitize(marked.parse(renderReceiptTemplate(data.templateText, { ...data.placeholders, GENERATED_AT: generatedAt, QR_CODE: qrCode })))
    : '';

  return (
    <Modal open={open} onClose={onClose}>
      <h3 style={{ marginBottom: 15 }}>{label}</h3>
      {loading && <div className="inline-spinner">Loading...</div>}
      {error && <div className="error-banner">{error}</div>}
      {warning && (
        <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem', marginBottom: 10 }}>
          ⚠️ {warning}
        </div>
      )}
      {qrWarning && (
        <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem', marginBottom: 10 }}>
          ⚠️ QR code generate nahi ho saka — is document ka QR blank rahega.
        </div>
      )}

      {!loading && data && !data.templateFound && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>{label} Not Found</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            No {label} template has been created for Year {year}. Please report this to the Superadmin.
          </p>
          <ReportErrorButton page={label} message={`${label} template missing for year ${year}`} />
        </div>
      )}

      {!loading && data && data.templateFound && (
        <>
          <div
            ref={previewRef}
            className="consent-doc"
            style={{
              width: `${pageSize.width}mm`, minHeight: `${pageSize.height}mm`, margin: '0 auto 15px',
              background: '#fff', padding: '10mm', border: '1px solid #eee', boxSizing: 'border-box',
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <button className="btn-submit" onClick={download} disabled={downloading}>
            {downloading ? 'Generating PDF...' : '⬇ Download PDF'}
          </button>
        </>
      )}
    </Modal>
  );
}
