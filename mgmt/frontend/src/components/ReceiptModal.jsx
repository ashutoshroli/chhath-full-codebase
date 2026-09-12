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

const DOC_CONFIG = {
  receipt: { label: 'Receipt', docNoKey: 'RECEIPT_NO', fetch: (rowIndex, year) => api.getReceiptData(rowIndex, year) },
  receipt_work: { label: 'Work Receipt', docNoKey: 'RECEIPT_NO', fetch: (rowIndex, year) => api.getReceiptData(rowIndex, year) },
  certificate: { label: 'Certificate', docNoKey: 'CERT_NO', fetch: (rowIndex, year) => api.getCertificateData(rowIndex, year) },
  samaan: { label: 'Material Receipt', docNoKey: 'SAMAAN_NO', fetch: (rowIndex, year) => api.getSamaanData(rowIndex, year) },
};

function openDownload(url) {
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
      try { window.location.assign(url); } catch (e) {  }
    }
  }, 1200);
}

async function snapshotToPdf(node, pageSizeKey, fileName) {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) {  }
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
    const recordId = `${docType}-${year}-${row.__rowIndex}`;
    generateQrDataUrl(publicRecordUrl(recordId))
      .then(setQrCode)
      .catch(err => {
        setQrWarning(true);
        reportClientError('ReceiptModal', `QR generation failed for ${recordId}`, err, { docType, year, recordId });
      });
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
        reportClientError('ReceiptModal', `Template fetch failed for ${docType} ${year}`, err, { docType, year, recordId });
        throw new Error(`Failed to load the ${label} template: ${err.message}`);
      }

      if (docxRow && (docxRow.base64 || docxRow.downloadUrl)) {
        const filledBase64 = await fillDocxTemplateFromRow(docxRow, placeholders);

        const rep = getLastRenderReport();
        if (rep.missingTags.length || rep.missingImages.length) {
          reportClientError('ReceiptModal',
            `Template rendered with unresolved placeholders for ${recordId}`,
            null,
            { docType, year, recordId, missingTags: rep.missingTags, missingImages: rep.missingImages });
        }

        const fileName = `${label}-${placeholders[docNoKey]}.docx`;
        const res = await api.convertDocxToPdf(docType, year, recordId, filledBase64, fileName);

        if (res && res.indexFailed) {
          setWarning(res.error || 'The PDF was generated but was not indexed on the public portal.');
          reportClientError('ReceiptModal', `PDF generated but NOT indexed: ${recordId}`, null,
            { docType, year, recordId, publicLink: res.publicLink });
        }

        openDownload(res.publicLink);
      } else {
        if (!previewRef.current) {
          throw new Error('The preview is not ready — please close the modal and open it again.');
        }
        await snapshotToPdf(previewRef.current, data.pageSize, `${label}-${placeholders[docNoKey]}.pdf`);
        setWarning(
          `No .docx template has been uploaded for this year (${year}), so an image-based PDF of the preview was generated. ` +
          'This PDF will not be available on the public portal — ask a Superadmin to upload a template under Document Templates.'
        );
      }
    } catch (err) {
      setError('An error occurred while generating the PDF: ' + err.message);
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
          ⚠️ The QR code could not be generated — this document's QR will be blank.
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
