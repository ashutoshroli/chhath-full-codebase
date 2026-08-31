import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { api } from '../api.js';
import { renderReceiptTemplate, PAGE_SIZES_MM } from '../receiptTemplate.js';
import { fillDocxTemplateFromRow } from '../docxFill.js';
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

export default function ReceiptModal({ row, year, open, onClose, docType = 'receipt' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generatedAt] = useState(() => new Date().toLocaleString('en-IN'));
  const [downloading, setDownloading] = useState(false);
  const [qrCode, setQrCode] = useState('');
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
    generateQrDataUrl(publicRecordUrl(recordId)).then(setQrCode).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row, year, docType]);

  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      const placeholders = { ...data.placeholders, GENERATED_AT: generatedAt, QR_CODE: qrCode };
      const docxRow = await api.getDocxTemplateForDoc(docType, year).catch(() => null);

      if (docxRow && (docxRow.base64 || docxRow.downloadUrl)) {
        // Superadmin-uploaded .docx exists for this year — fill it and convert via Drive.
        const filledBase64 = await fillDocxTemplateFromRow(docxRow, placeholders);
        const recordId = `${docType}-${year}-${row.__rowIndex}`;
        const fileName = `${label}-${placeholders[docNoKey]}.docx`;
        const res = await api.convertDocxToPdf(docType, year, recordId, filledBase64, fileName);
        const a = document.createElement('a');
        a.href = res.publicLink;
        a.download = `${label}-${placeholders[docNoKey]}.pdf`;
        a.target = '_blank';
        a.click();
      } else {
        // No .docx template for this year yet — fall back to a snapshot of the preview.
        if (!previewRef.current) return;
        const canvas = await html2canvas(previewRef.current, { scale: 3, useCORS: true });
        const { width, height } = PAGE_SIZES_MM[data.pageSize] || PAGE_SIZES_MM.A5;
        const doc = new jsPDF({ unit: 'mm', format: [width, height] });
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, width, height);
        doc.save(`${label}-${placeholders[docNoKey]}.pdf`);
      }
    } catch (err) {
      setError('An error occurred while generating the PDF: ' + err.message);
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
