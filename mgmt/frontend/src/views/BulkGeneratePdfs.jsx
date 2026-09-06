import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';
import { fillDocxTemplateFromRow, getLastRenderReport } from '../docxFill.js';
import { generateQrDataUrl, publicRecordUrl } from '../qrCode.js';

// Bulk generation hammers the Google Drive conversion pipeline (~8-11 Drive
// subrequests per PDF) with NO throttle, NO backoff and NO retry. A Drive 429
// therefore became a per-record "failed" line in an in-memory UI log that
// disappeared on refresh, with nothing in the Error Log.
const RETRY_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1500;
const THROTTLE_MS = 350; // small gap between records to stay under Drive's per-user limit

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isRetryable(err) {
  const m = (err && err.message ? err.message : '').toLowerCase();
  return m.includes('429') || m.includes('rate') || m.includes('quota')
    || m.includes('timeout') || m.includes('failed to fetch')
    || m.includes('500') || m.includes('502') || m.includes('503') || m.includes('internal error');
}

async function withRetry(fn, onRetry) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === RETRY_ATTEMPTS || !isRetryable(err)) throw err;
      const wait = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
      if (onRetry) onRetry(attempt, wait, err);
      await sleep(wait);
    }
  }
  throw lastErr;
}

const DOC_TYPES = [
  ['receipt', 'Receipts'],
  ['receipt_work', 'Work Receipts'],
  ['certificate', 'Certificates'],
  ['samaan', 'Material Items'],
  ['consent_loaner', 'Consent — Loaner'],
  ['consent_guarantor', 'Consent — Guarantor'],
];

export default function BulkGeneratePdfs() {
  const [years, setYears] = useState([]);
  const [year, setYear] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({}); // docType -> { done, total, skipped, failed, notIndexed }
  const [error, setError] = useState('');
  const [log, setLog] = useState([]);

  useEffect(() => {
    api.getYears().then(ys => { setYears(ys); if (ys && ys.length) setYear(String(ys[0])); }).catch(err => setError(err.message));
  }, []);

  const appendLog = (line) => setLog(l => [...l, line]);

  const runOne = async (docType, label) => {
    const blank = { done: 0, total: 0, skipped: 0, failed: 0, notIndexed: 0 };
    setProgress(p => ({ ...p, [docType]: { ...blank } }));

    let templateRow;
    try {
      templateRow = await api.getDocxTemplateForDoc(docType, year);
    } catch (err) {
      // Was `.catch(() => null)` -> a permissions/Drive/base64 failure was
      // reported to the user as "no template found", which is a completely
      // different (and self-inflicted-looking) problem.
      appendLog(`❌ ${label}: template load FAILED — ${err.message}`);
      reportClientError('BulkGeneratePdfs', `Template load failed for ${docType} ${year}`, err, { docType, year });
      return;
    }
    if (!templateRow || (!templateRow.base64 && !templateRow.downloadUrl)) {
      appendLog(`⚠️ ${label}: No .docx template found for Year ${year} — skipped.`);
      return;
    }

    const records = await api.getRecordsForDocType(docType, year);
    setProgress(p => ({ ...p, [docType]: { ...blank, total: records.length } }));
    if (records.length === 0) {
      appendLog(`${label}: No records found for this year.`);
      return;
    }

    for (const rec of records) {
      try {
        let qrCode = '';
        try {
          qrCode = await generateQrDataUrl(publicRecordUrl(rec.recordId));
        } catch (qrErr) {
          // Was `.catch(() => '')`. An empty QR value produced a permanently
          // archived PDF with a broken QR, silently killing the public
          // "Verified Record" scan for that document.
          appendLog(`⚠️ ${label} — ${rec.recordId}: QR generation failed; the QR in the PDF will be blank.`);
          reportClientError('BulkGeneratePdfs', `QR generation failed for ${rec.recordId}`, qrErr, { docType, year, recordId: rec.recordId });
        }

        const filledBase64 = await fillDocxTemplateFromRow(templateRow, {
          ...rec.placeholders,
          GENERATED_AT: new Date().toLocaleString('en-IN'),
          QR_CODE: qrCode,
        });

        // Unresolved placeholders used to blank out silently (nullGetter), which is
        // exactly how the missing consent festival/count fields went unnoticed.
        const rep = getLastRenderReport();
        if (rep.missingTags.length) {
          appendLog(`⚠️ ${label} — ${rec.recordId}: blank placeholders — ${[...new Set(rep.missingTags)].join(', ')}`);
          reportClientError('BulkGeneratePdfs', `Unresolved placeholders for ${rec.recordId}`, null,
            { docType, year, recordId: rec.recordId, missingTags: [...new Set(rep.missingTags)] });
        }

        const fileName = `${rec.fileNameHint}.docx`;
        const res = await withRetry(
          () => api.convertDocxToPdfBulk(docType, year, rec.recordId, filledBase64, fileName),
          (attempt, wait) => appendLog(`↻ ${label} — ${rec.recordId}: retry ${attempt}/${RETRY_ATTEMPTS - 1} in ${Math.round(wait / 1000)}s`)
        );

        // The backend returns indexFailed but this screen used to ignore it and
        // count the record as a SUCCESS, so a PDF that will never appear on the
        // public portal looked completely fine here.
        const notIndexed = !!(res && res.indexFailed);
        if (notIndexed) {
          appendLog(`⚠️ ${label} — ${rec.recordId}: PDF was generated but NOT indexed in the public portal.`);
          reportClientError('BulkGeneratePdfs', `PDF generated but NOT indexed: ${rec.recordId}`, null,
            { docType, year, recordId: rec.recordId, publicLink: res && res.publicLink });
        }

        setProgress(p => {
          const cur = p[docType];
          return { ...p, [docType]: {
            ...cur,
            done: cur.done + 1,
            skipped: cur.skipped + (res.skipped ? 1 : 0),
            notIndexed: cur.notIndexed + (notIndexed ? 1 : 0),
          } };
        });
      } catch (err) {
        setProgress(p => {
          const cur = p[docType];
          return { ...p, [docType]: { ...cur, done: cur.done + 1, failed: cur.failed + 1 } };
        });
        appendLog(`❌ ${label} — ${rec.recordId}: ${err.message}`);
        // The UI log is in-memory and vanishes on refresh — persist the failure so
        // a bulk run of hundreds can actually be diagnosed afterwards.
        reportClientError('BulkGeneratePdfs', `Record failed: ${rec.recordId}`, err, { docType, year, recordId: rec.recordId });
      }
      // Gap between records so Drive's per-user rate limit isn't tripped.
      await sleep(THROTTLE_MS);
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
      reportClientError('BulkGeneratePdfs', 'Bulk run aborted', err, { year });
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
                  <strong>{label}:</strong> {p.done}/{p.total} done ({p.skipped} skipped, {p.failed} failed
                  {p.notIndexed ? `, ${p.notIndexed} NOT indexed` : ''})
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
