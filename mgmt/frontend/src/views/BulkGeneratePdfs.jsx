import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fillDocxTemplateFromRow } from '../docxFill.js';
import { generateQrDataUrl, publicRecordUrl } from '../qrCode.js';

const DOC_TYPES = [
  ['receipt', 'Receipts'],
  ['certificate', 'Certificates'],
  ['samaan', 'Material Items'],
  ['consent_loaner', 'Consent — Loaner'],
  ['consent_guarantor', 'Consent — Guarantor'],
];

export default function BulkGeneratePdfs() {
  const [years, setYears] = useState([]);
  const [year, setYear] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({}); // docType -> { done, total, skipped, failed }
  const [error, setError] = useState('');
  const [log, setLog] = useState([]);

  useEffect(() => {
    api.getYears().then(ys => { setYears(ys); if (ys && ys.length) setYear(String(ys[0])); }).catch(err => setError(err.message));
  }, []);

  const appendLog = (line) => setLog(l => [...l, line]);

  const runOne = async (docType, label) => {
    setProgress(p => ({ ...p, [docType]: { done: 0, total: 0, skipped: 0, failed: 0 } }));

    const templateRow = await api.getDocxTemplateForDoc(docType, year).catch(() => null);
    if (!templateRow || (!templateRow.base64 && !templateRow.downloadUrl)) {
      appendLog(`⚠️ ${label}: No .docx template found for Year ${year} — skipped.`);
      return;
    }

    const records = await api.getRecordsForDocType(docType, year);
    setProgress(p => ({ ...p, [docType]: { done: 0, total: records.length, skipped: 0, failed: 0 } }));
    if (records.length === 0) {
      appendLog(`${label}: No records found for this year.`);
      return;
    }

    for (const rec of records) {
      try {
        const qrCode = await generateQrDataUrl(publicRecordUrl(rec.recordId)).catch(() => '');
        const filledBase64 = await fillDocxTemplateFromRow(templateRow, { ...rec.placeholders, GENERATED_AT: new Date().toLocaleString('en-IN'), QR_CODE: qrCode });
        const fileName = `${rec.fileNameHint}.docx`;
        const res = await api.convertDocxToPdf(docType, year, rec.recordId, filledBase64, fileName);
        setProgress(p => {
          const cur = p[docType];
          return { ...p, [docType]: { ...cur, done: cur.done + 1, skipped: cur.skipped + (res.skipped ? 1 : 0) } };
        });
      } catch (err) {
        setProgress(p => {
          const cur = p[docType];
          return { ...p, [docType]: { ...cur, done: cur.done + 1, failed: cur.failed + 1 } };
        });
        appendLog(`❌ ${label} — ${rec.recordId}: ${err.message}`);
      }
    }
    appendLog(`✓ ${label} complete.`);
  };

  const runAll = async () => {
    if (!year) return alert('Please select a year');
    if (!confirm(`Generate PDFs for all Receipt/Certificate/Material/Consent records in Year ${year}? Already-generated PDFs will be skipped.`)) return;
    setRunning(true);
    setError('');
    setLog([]);
    setProgress({});
    try {
      for (const [docType, label] of DOC_TYPES) {
        appendLog(`Starting ${label}...`);
        await runOne(docType, label);
      }
      appendLog('🎉 All done.');
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Generate PDFs (Bulk)</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="glass-card" style={{ padding: 20 }}>
        <div className="form-group">
          <label>Year</label>
          <select value={year} onChange={e => setYear(e.target.value)} disabled={running}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          Generates PDFs for all Receipt, Certificate, Material, and (Accepted) Consent records that have a .docx template uploaded for that doc-type. Records that have already been generated will be skipped automatically.
        </p>
        <button className="btn-submit" onClick={runAll} disabled={running || !year}>
          {running ? 'Generating...' : '⚡ Generate PDFs for this Year'}
        </button>

        {Object.keys(progress).length > 0 && (
          <div style={{ marginTop: 15 }}>
            {DOC_TYPES.map(([docType, label]) => {
              const p = progress[docType];
              if (!p) return null;
              return (
                <div key={docType} style={{ fontSize: '0.85rem', marginBottom: 6 }}>
                  <strong>{label}:</strong> {p.done}/{p.total} done ({p.skipped} skipped, {p.failed} failed)
                </div>
              );
            })}
          </div>
        )}

        {log.length > 0 && (
          <div style={{ marginTop: 15, background: '#f9fafb', borderRadius: 8, padding: 10, maxHeight: 250, overflowY: 'auto', fontSize: '0.8rem' }}>
            {log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>
    </>
  );
}
