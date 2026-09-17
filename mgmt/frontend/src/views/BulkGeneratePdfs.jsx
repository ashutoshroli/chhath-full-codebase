import { useEffect, useRef, useState } from 'react';
import { api, reportClientError } from '../api.js';

const RETRY_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1500;
const THROTTLE_MS = 350;

const BATCH_SIZE = 10;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

const ENGINE_LABELS = {
  render: 'Render (offload service)',
  worker: 'Cloudflare Worker (fallback)',
  none: 'none — nothing to convert',
  mixed: 'Mixed (Render + Worker fallback)',
  unknown: 'unknown',
};
const ENGINE_REASONS = {
  'render-not-configured': 'Render is not configured, so the Worker did the conversion itself.',
  'render-unreachable': 'Render could not be reached, so the Worker fell back to converting in-process.',
  'all-already-generated': 'Every record already had a PDF, so nothing needed converting.',
};
const shortJobId = (id) => (id ? `${String(id).slice(0, 10)}…` : '');

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
  const [progress, setProgress] = useState({});
  const [error, setError] = useState('');
  const [log, setLog] = useState([]);
  const [showDetails, setShowDetails] = useState(false);
  const [eng, setEng] = useState(null);

  const detailsRef = useRef(showDetails);
  useEffect(() => { detailsRef.current = showDetails; }, [showDetails]);

  useEffect(() => {
    api.getYears().then(ys => { setYears(ys); if (ys && ys.length) setYear(String(ys[0])); }).catch(err => setError(err.message));
  }, []);

  const appendLog = (line) => setLog(l => [...l, line]);
  const appendDetail = (line) => { if (detailsRef.current) appendLog(line); };

  const noteEngine = (meta, batchRecords) => setEng(prev => {
    const cur = prev || { render: 0, worker: 0, none: 0, jobIds: [], reasons: [], batchesDone: 0, batchesTotal: 0 };
    const engine = (meta && meta.engine) || 'unknown';
    const next = { ...cur, batchesDone: cur.batchesDone + 1 };
    const converted = Math.max(0, (meta && meta.dispatchedCount) || 0);
    if (engine === 'render') next.render = cur.render + converted;
    else if (engine === 'worker') next.worker = cur.worker + converted;
    next.none = cur.none + Math.max(0, ((meta && meta.skippedCount) || 0));
    if (meta && meta.jobId && !cur.jobIds.includes(meta.jobId)) next.jobIds = [...cur.jobIds, meta.jobId];
    if (meta && meta.engineReason && !cur.reasons.includes(meta.engineReason)) next.reasons = [...cur.reasons, meta.engineReason];
    void batchRecords;
    return next;
  });

  const runOne = async (docType, label) => {
    const blank = { done: 0, total: 0, skipped: 0, failed: 0, notIndexed: 0 };
    setProgress(p => ({ ...p, [docType]: { ...blank } }));

    let templateRow;
    try {
      templateRow = await api.getDocxTemplateForDoc(docType, year);
    } catch (err) {
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

    const batchCount = Math.ceil(records.length / BATCH_SIZE);
    setEng(prev => {
      const cur = prev || { render: 0, worker: 0, none: 0, jobIds: [], reasons: [], batchesDone: 0, batchesTotal: 0 };
      return { ...cur, batchesTotal: cur.batchesTotal + batchCount };
    });
    appendLog(`${label}: ${records.length} records → ${batchCount} batch${batchCount === 1 ? '' : 'es'} of up to ${BATCH_SIZE}`);

    // The browser no longer fills the .docx or builds the QR. Each record is sent as its
    // fill DATA (the placeholder set); the Worker resolves the shared template and Render
    // fills each record (+ a server-generated QR) then converts. So a "record" is now just
    // { recordId, data, fileName } — no docxtemplater, no qrcode in this bundle.
    const buildItem = (rec) => ({
      recordId: rec.recordId,
      data: {
        ...rec.placeholders,
        GENERATED_AT: new Date().toLocaleString('en-IN'),
      },
      fileName: `${rec.fileNameHint}.docx`,
    });

    let batchNo = 0;
    for (const group of chunk(records, BATCH_SIZE)) {
      batchNo++;
      const items = group.map(buildItem);
      if (items.length === 0) { await sleep(THROTTLE_MS); continue; }

      try {
        const res = await withRetry(
          () => api.convertDocxToPdfBatch(docType, year, items),
          (attempt, wait) => appendLog(`↻ ${label}: batch retry ${attempt}/${RETRY_ATTEMPTS - 1} in ${Math.round(wait / 1000)}s`)
        );
        const { results } = res;
        noteEngine(res);
        const engine = res.engine || 'unknown';
        const via = engine === 'render'
          ? `Render${res.jobId ? ` · job ${shortJobId(res.jobId)}` : ''}`
          : engine === 'worker' ? 'in-Worker fallback'
            : engine === 'none' ? 'nothing to convert (all already generated)'
              : 'unknown engine';
        appendLog(`📦 ${label}: batch ${batchNo}/${batchCount} (${items.length} records) → ${via}`);
        const byId = {};
        for (const r of (results || [])) byId[r.recordId] = r;
        for (const it of items) {
          const r = byId[it.recordId];
          const skipped = !!(r && r.skipped);
          const ok = !!(r && (r.success || r.ok || r.skipped));
          if (!ok) {
            const reason = r
              ? (r.error || 'conversion failed (server returned no error detail — check Render logs)')
              : 'no result returned from server for this record';
            appendLog(`❌ ${label} — ${it.recordId}: ${reason}`);
            reportClientError('BulkGeneratePdfs', `Record failed: ${it.recordId} — ${reason}`, null,
              { docType, year, recordId: it.recordId, error: reason, hadResult: !!r });
          } else {
            appendDetail(`${skipped ? '⏭️' : '✓'} ${label} — ${it.recordId}${skipped ? ' (already generated)' : ''}`);
            // The per-record render report now comes BACK from the server (Render filled
            // the doc), replacing the old in-browser getLastRenderReport() warning.
            const missing = r && r.report && Array.isArray(r.report.missingTags) ? r.report.missingTags : [];
            if (missing.length) {
              appendDetail(`⚠️ ${label} — ${it.recordId}: blank placeholders — ${[...new Set(missing)].join(', ')}`);
              reportClientError('BulkGeneratePdfs', `Unresolved placeholders for ${it.recordId}`, null,
                { docType, year, recordId: it.recordId, missingTags: [...new Set(missing)] });
            }
          }
          setProgress(p => {
            const cur = p[docType];
            return { ...p, [docType]: {
              ...cur,
              done: cur.done + 1,
              skipped: cur.skipped + (skipped ? 1 : 0),
              failed: cur.failed + (ok ? 0 : 1),
            } };
          });
        }
      } catch (err) {
        appendLog(`❌ ${label}: batch of ${items.length} failed — ${err.message}`);
        reportClientError('BulkGeneratePdfs', `Batch failed (${items.length} records)`, err, { docType, year, count: items.length });
        setProgress(p => { const cur = p[docType]; return { ...p, [docType]: { ...cur, done: cur.done + items.length, failed: cur.failed + items.length } }; });
      }
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
    setEng(null);
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

  const engineKey = !eng ? null
    : (eng.render > 0 && eng.worker > 0) ? 'mixed'
      : eng.render > 0 ? 'render'
        : eng.worker > 0 ? 'worker'
          : 'none';
  const isFallback = engineKey === 'worker' || engineKey === 'mixed';

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
          Generates PDFs for all Receipt, Certificate, Material, and (Accepted) Consent records that have a .docx template uploaded for that doc-type. Records that have already been generated will be skipped automatically. A few are processed at a time (with automatic retry) — keep this tab open until it finishes.
        </p>
        <button className="btn-submit" onClick={runAll} disabled={running || !year}>
          {running ? 'Generating...' : '⚡ Generate PDFs for this Year'}
        </button>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: '0.82rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDetails} onChange={e => setShowDetails(e.target.checked)} />
          Show per-record details in the log (failures are always shown)
        </label>

        {eng && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8, fontSize: '0.82rem',
            background: isFallback ? '#fff7ed' : '#f0f9ff',
            border: `1px solid ${isFallback ? '#fed7aa' : '#bae6fd'}`,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {isFallback ? '⚠️' : '⚙️'} Engine: {ENGINE_LABELS[engineKey] || engineKey}
            </div>
            {eng.reasons.map(r => (
              <div key={r} style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{ENGINE_REASONS[r] || r}</div>
            ))}
            <div style={{ color: 'var(--text-muted)' }}>
              Batch {eng.batchesDone}/{eng.batchesTotal} · size {BATCH_SIZE} · throttle {THROTTLE_MS}ms · retries {RETRY_ATTEMPTS}
            </div>
            <div style={{ color: 'var(--text-muted)' }}>
              Converted → Render: {eng.render} · Worker: {eng.worker} · already generated: {eng.none}
            </div>
            {eng.jobIds.length > 0 && (
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                Render jobs: {eng.jobIds.slice(-6).map(shortJobId).join(', ')}
                {eng.jobIds.length > 6 ? ` (+${eng.jobIds.length - 6} more)` : ''}
              </div>
            )}
          </div>
        )}

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
