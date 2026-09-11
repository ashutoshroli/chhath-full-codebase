import { useEffect, useRef, useState } from 'react';
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

// audit P-3 — bounded concurrency. The loop used to be strictly serial (one record,
// then a 350ms gap), which is subrequest-safe but slow for a big year. We now run a
// small POOL of workers so a few conversions are in flight at once, cutting a
// several-hundred-record run's wall-clock time roughly CONCURRENCY-fold — WITHOUT
// changing the "each conversion is its own request" property that keeps us clear of
// the 50-subrequest-per-invocation free-plan cap (moving this server-side is exactly
// what would breach it). Kept deliberately LOW: Drive's per-user quota is the limit,
// and each worker still throttles + retries with backoff, so N=3 in flight with a
// per-worker gap stays comfortably under the rate that produced 429s before.
const CONCURRENCY = 3;

// BATCHING: instead of one Worker call per record, we fill BATCH_SIZE docs in the
// browser and send them in ONE convertDocxToPdfBatch call — far fewer Worker
// requests + D1 writes for a big year. 10 is the default; 20 is the server's hard
// cap (payload/memory). The docx FILL still happens per record in the browser.
const BATCH_SIZE = 10;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Split an array into chunks of `size`.
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Run `worker(item, index)` over `items` with at most `limit` in flight at once.
// Workers pull from a shared cursor, so a slow record never blocks the others and
// the pool naturally drains. Never rejects — each worker call is expected to handle
// its own errors (as processRecord does); this just bounds parallelism.
async function runPool(items, limit, worker) {
  let cursor = 0;
  const next = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  };
  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, () => next()));
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

// Which service actually converts the .docx -> PDF. The backend reports this per
// batch (see api.convertDocxToPdfBatch); we surface it so a slow/fallback run is
// obvious instead of a mystery.
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
// A short, readable job reference for support (full id stays in the Error Log).
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
  const [progress, setProgress] = useState({}); // docType -> { done, total, skipped, failed, notIndexed }
  const [error, setError] = useState('');
  const [log, setLog] = useState([]);
  // Per-record lines are OFF by default: a big year would otherwise bury the batch
  // summaries and the failures under hundreds of lines. Failures are ALWAYS logged.
  const [showDetails, setShowDetails] = useState(false);
  // Live engine/batch telemetry for the run.
  const [eng, setEng] = useState(null);

  // Read through a ref so toggling "details" mid-run takes effect immediately
  // (runOne's closures would otherwise keep the value from when the run started).
  const detailsRef = useRef(showDetails);
  useEffect(() => { detailsRef.current = showDetails; }, [showDetails]);

  useEffect(() => {
    api.getYears().then(ys => { setYears(ys); if (ys && ys.length) setYear(String(ys[0])); }).catch(err => setError(err.message));
  }, []);

  const appendLog = (line) => setLog(l => [...l, line]);
  // A per-record detail line — only shown when "details" is on.
  const appendDetail = (line) => { if (detailsRef.current) appendLog(line); };

  // Fold one batch's engine report into the run-wide totals.
  const noteEngine = (meta, batchRecords) => setEng(prev => {
    const cur = prev || { render: 0, worker: 0, none: 0, jobIds: [], reasons: [], batchesDone: 0, batchesTotal: 0 };
    const engine = (meta && meta.engine) || 'unknown';
    const next = { ...cur, batchesDone: cur.batchesDone + 1 };
    // Count RECORDS by the engine that converted them (skipped ones converted nowhere).
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

    // How many Worker calls this doc-type will take (one per batch).
    const batchCount = Math.ceil(records.length / BATCH_SIZE);
    setEng(prev => {
      const cur = prev || { render: 0, worker: 0, none: 0, jobIds: [], reasons: [], batchesDone: 0, batchesTotal: 0 };
      return { ...cur, batchesTotal: cur.batchesTotal + batchCount };
    });
    appendLog(`${label}: ${records.length} records → ${batchCount} batch${batchCount === 1 ? '' : 'es'} of up to ${BATCH_SIZE}`);

    // Fill ONE record's .docx in the browser (QR + placeholders). Returns the item
    // { recordId, base64, fileName } for the batch, or null on a fill failure
    // (counted as failed). The docx fill stays client-side exactly as before.
    const fillRecord = async (rec) => {
      try {
        let qrCode = '';
        try {
          qrCode = await generateQrDataUrl(publicRecordUrl(rec.recordId));
        } catch (qrErr) {
          appendDetail(`⚠️ ${label} — ${rec.recordId}: QR generation failed; the QR in the PDF will be blank.`);
          reportClientError('BulkGeneratePdfs', `QR generation failed for ${rec.recordId}`, qrErr, { docType, year, recordId: rec.recordId });
        }
        const filledBase64 = await fillDocxTemplateFromRow(templateRow, {
          ...rec.placeholders,
          GENERATED_AT: new Date().toLocaleString('en-IN'),
          QR_CODE: qrCode,
        });
        const rep = getLastRenderReport();
        if (rep.missingTags.length) {
          appendDetail(`⚠️ ${label} — ${rec.recordId}: blank placeholders — ${[...new Set(rep.missingTags)].join(', ')}`);
          reportClientError('BulkGeneratePdfs', `Unresolved placeholders for ${rec.recordId}`, null,
            { docType, year, recordId: rec.recordId, missingTags: [...new Set(rep.missingTags)] });
        }
        return { recordId: rec.recordId, base64: filledBase64, fileName: `${rec.fileNameHint}.docx` };
      } catch (err) {
        setProgress(p => { const cur = p[docType]; return { ...p, [docType]: { ...cur, done: cur.done + 1, failed: cur.failed + 1 } }; });
        appendLog(`❌ ${label} — ${rec.recordId}: fill failed — ${err.message}`);
        reportClientError('BulkGeneratePdfs', `Fill failed: ${rec.recordId}`, err, { docType, year, recordId: rec.recordId });
        return null;
      }
    };

    // Process the records in BATCHES: fill each batch in the browser (up to
    // CONCURRENCY fills in flight), then send the whole batch in ONE Worker call.
    let batchNo = 0;
    for (const group of chunk(records, BATCH_SIZE)) {
      batchNo++;
      // Fill this batch's docs (bounded concurrency for the CPU-heavy fill).
      const items = [];
      await runPool(group, CONCURRENCY, async (rec) => {
        const it = await fillRecord(rec);
        if (it) items.push(it);
      });
      if (items.length === 0) { await sleep(THROTTLE_MS); continue; }

      try {
        const res = await withRetry(
          () => api.convertDocxToPdfBatch(docType, year, items),
          (attempt, wait) => appendLog(`↻ ${label}: batch retry ${attempt}/${RETRY_ATTEMPTS - 1} in ${Math.round(wait / 1000)}s`)
        );
        const { results } = res;
        // Record + report WHICH service handled this batch.
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
          // The Worker returns the TRANSLATED shape ({ success, error }). As a
          // belt-and-suspenders guard we also honour the RAW Render shape ({ ok })
          // in case it ever leaks through — a raw ok:true record is a real success.
          // A record flagged `skipped` was ALREADY generated: that is a success, so
          // it must never be counted or logged as a failure even if `success` is
          // absent from the entry.
          const skipped = !!(r && r.skipped);
          const ok = !!(r && (r.success || r.ok || r.skipped));
          if (!ok) {
            // Distinguish a genuine per-record failure (r.error is set by the
            // Worker/Render) from a record that never came back in the results at
            // all (r is undefined) — the latter means the batch job completed but
            // dropped this record, which is otherwise invisible. Always surface a
            // concrete, non-empty reason so the Error Log is actionable.
            const reason = r
              ? (r.error || 'conversion failed (server returned no error detail — check Render logs)')
              : 'no result returned from server for this record';
            appendLog(`❌ ${label} — ${it.recordId}: ${reason}`);
            reportClientError('BulkGeneratePdfs', `Record failed: ${it.recordId} — ${reason}`, null,
              { docType, year, recordId: it.recordId, error: reason, hadResult: !!r });
          } else {
            appendDetail(`${skipped ? '⏭️' : '✓'} ${label} — ${it.recordId}${skipped ? ' (already generated)' : ''}`);
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
        // The whole batch call failed (network/timeout after retries) — count every
        // item in it as failed.
        appendLog(`❌ ${label}: batch of ${items.length} failed — ${err.message}`);
        reportClientError('BulkGeneratePdfs', `Batch failed (${items.length} records)`, err, { docType, year, count: items.length });
        setProgress(p => { const cur = p[docType]; return { ...p, [docType]: { ...cur, done: cur.done + items.length, failed: cur.failed + items.length } }; });
      }
      // Small gap between batches to pace Drive's per-user rate limit.
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

  // One run can span several batches, and Render could go away mid-run — so derive
  // the engine from what actually converted records, not from the last batch alone.
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
              Batch {eng.batchesDone}/{eng.batchesTotal} · size {BATCH_SIZE} · fill concurrency {CONCURRENCY} · throttle {THROTTLE_MS}ms · retries {RETRY_ATTEMPTS}
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
