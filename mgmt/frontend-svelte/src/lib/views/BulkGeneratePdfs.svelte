<script lang="ts">
  // Ported from React views/BulkGeneratePdfs.jsx — bulk-generate PDFs for all
  // receipt/certificate/material/consent records of a year: fill each docx
  // (concurrency pool), convert in batches with retry/backoff, track per-type
  // progress + engine stats + a scrolling log.
  import { api, reportClientError } from '$lib/api';
  import { fillDocxTemplateFromRow, getLastRenderReport } from '$lib/docxFill';
  import { generateQrDataUrl, publicRecordUrl } from '$lib/qrCode';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  const RETRY_ATTEMPTS = 3;
  const BASE_BACKOFF_MS = 1500;
  const THROTTLE_MS = 350;
  const CONCURRENCY = 3;
  const BATCH_SIZE = 10;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function runPool<T>(items: T[], limit: number, worker: (item: T, i: number) => Promise<void>) {
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

  function isRetryable(err: unknown): boolean {
    const m = (err && (err as Error).message ? (err as Error).message : '').toLowerCase();
    return m.includes('429') || m.includes('rate') || m.includes('quota')
      || m.includes('timeout') || m.includes('failed to fetch')
      || m.includes('500') || m.includes('502') || m.includes('503') || m.includes('internal error');
  }

  async function withRetry<T>(fn: () => Promise<T>, onRetry?: (attempt: number, wait: number, err: unknown) => void): Promise<T> {
    let lastErr: unknown;
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

  const ENGINE_LABELS: Record<string, string> = {
    render: 'Render (offload service)',
    worker: 'Cloudflare Worker (fallback)',
    none: 'none — nothing to convert',
    mixed: 'Mixed (Render + Worker fallback)',
    unknown: 'unknown'
  };
  const ENGINE_REASONS: Record<string, string> = {
    'render-not-configured': 'Render is not configured, so the Worker did the conversion itself.',
    'render-unreachable': 'Render could not be reached, so the Worker fell back to converting in-process.',
    'all-already-generated': 'Every record already had a PDF, so nothing needed converting.'
  };
  const shortJobId = (id: string) => (id ? `${String(id).slice(0, 10)}…` : '');

  type DocTypeEntry = [string, string];
  const DOC_TYPES: DocTypeEntry[] = [
    ['receipt', 'Receipts'],
    ['receipt_work', 'Work Receipts'],
    ['certificate', 'Certificates'],
    ['samaan', 'Material Items'],
    ['consent_loaner', 'Consent — Loaner'],
    ['consent_guarantor', 'Consent — Guarantor']
  ];

  let years = $state<string[]>([]);
  let year = $state('');
  let running = $state(false);
  let progress = $state<Record<string, any>>({});
  let error = $state('');
  let log = $state<string[]>([]);
  let showDetails = $state(false);
  let eng = $state<any>(null);

  // Load years once.
  let yearsLoaded = false;
  $effect(() => {
    if (yearsLoaded) return;
    yearsLoaded = true;
    api.getYears()
      .then((ys: string[]) => { years = ys; if (ys && ys.length) year = String(ys[0]); })
      .catch((err: Error) => (error = err.message));
  });

  function appendLog(line: string) { log = [...log, line]; }
  function appendDetail(line: string) { if (showDetails) appendLog(line); }

  function noteEngine(meta: any) {
    const cur = eng || { render: 0, worker: 0, none: 0, jobIds: [], reasons: [], batchesDone: 0, batchesTotal: 0 };
    const engine = (meta && meta.engine) || 'unknown';
    const next: any = { ...cur, batchesDone: cur.batchesDone + 1 };
    const converted = Math.max(0, (meta && meta.dispatchedCount) || 0);
    if (engine === 'render') next.render = cur.render + converted;
    else if (engine === 'worker') next.worker = cur.worker + converted;
    next.none = cur.none + Math.max(0, ((meta && meta.skippedCount) || 0));
    if (meta && meta.jobId && !cur.jobIds.includes(meta.jobId)) next.jobIds = [...cur.jobIds, meta.jobId];
    if (meta && meta.engineReason && !cur.reasons.includes(meta.engineReason)) next.reasons = [...cur.reasons, meta.engineReason];
    eng = next;
  }

  async function runOne(docType: string, label: string) {
    const blank = { done: 0, total: 0, skipped: 0, failed: 0, notIndexed: 0 };
    progress = { ...progress, [docType]: { ...blank } };

    let templateRow: any;
    try {
      templateRow = await api.getDocxTemplateForDoc(docType, year);
    } catch (err) {
      appendLog(`❌ ${label}: template load FAILED — ${(err as Error).message}`);
      reportClientError('BulkGeneratePdfs', `Template load failed for ${docType} ${year}`, err as Error, { docType, year });
      return;
    }
    if (!templateRow || (!templateRow.base64 && !templateRow.downloadUrl)) {
      appendLog(`⚠️ ${label}: No .docx template found for Year ${year} — skipped.`);
      return;
    }

    const records: any[] = await api.getRecordsForDocType(docType, year);
    progress = { ...progress, [docType]: { ...blank, total: records.length } };
    if (records.length === 0) {
      appendLog(`${label}: No records found for this year.`);
      return;
    }

    const batchCount = Math.ceil(records.length / BATCH_SIZE);
    {
      const cur = eng || { render: 0, worker: 0, none: 0, jobIds: [], reasons: [], batchesDone: 0, batchesTotal: 0 };
      eng = { ...cur, batchesTotal: cur.batchesTotal + batchCount };
    }
    appendLog(`${label}: ${records.length} records → ${batchCount} batch${batchCount === 1 ? '' : 'es'} of up to ${BATCH_SIZE}`);

    const fillRecord = async (rec: any) => {
      try {
        let qrCode = '';
        try {
          qrCode = await generateQrDataUrl(publicRecordUrl(rec.recordId));
        } catch (qrErr) {
          appendDetail(`⚠️ ${label} — ${rec.recordId}: QR generation failed; the QR in the PDF will be blank.`);
          reportClientError('BulkGeneratePdfs', `QR generation failed for ${rec.recordId}`, qrErr as Error, { docType, year, recordId: rec.recordId });
        }
        const filledBase64 = await fillDocxTemplateFromRow(templateRow, {
          ...rec.placeholders,
          GENERATED_AT: new Date().toLocaleString('en-IN'),
          QR_CODE: qrCode
        });
        const rep = getLastRenderReport();
        if (rep.missingTags.length) {
          appendDetail(`⚠️ ${label} — ${rec.recordId}: blank placeholders — ${[...new Set(rep.missingTags)].join(', ')}`);
          reportClientError('BulkGeneratePdfs', `Unresolved placeholders for ${rec.recordId}`, undefined,
            { docType, year, recordId: rec.recordId, missingTags: [...new Set(rep.missingTags)] });
        }
        return { recordId: rec.recordId, base64: filledBase64, fileName: `${rec.fileNameHint}.docx` };
      } catch (err) {
        const cur = progress[docType];
        progress = { ...progress, [docType]: { ...cur, done: cur.done + 1, failed: cur.failed + 1 } };
        appendLog(`❌ ${label} — ${rec.recordId}: fill failed — ${(err as Error).message}`);
        reportClientError('BulkGeneratePdfs', `Fill failed: ${rec.recordId}`, err as Error, { docType, year, recordId: rec.recordId });
        return null;
      }
    };

    let batchNo = 0;
    for (const group of chunk(records, BATCH_SIZE)) {
      batchNo++;
      const items: any[] = [];
      await runPool(group, CONCURRENCY, async (rec) => {
        const it = await fillRecord(rec);
        if (it) items.push(it);
      });
      if (items.length === 0) { await sleep(THROTTLE_MS); continue; }

      try {
        const res: any = await withRetry(
          () => api.convertDocxToPdfBatch(docType, year, items),
          (attempt, wait) => appendLog(`↻ ${label}: batch retry ${attempt}/${RETRY_ATTEMPTS - 1} in ${Math.round(wait / 1000)}s`)
        );
        const results = res.results;
        noteEngine(res);
        const engine = res.engine || 'unknown';
        const via = engine === 'render'
          ? `Render${res.jobId ? ` · job ${shortJobId(res.jobId)}` : ''}`
          : engine === 'worker' ? 'in-Worker fallback'
            : engine === 'none' ? 'nothing to convert (all already generated)'
              : 'unknown engine';
        appendLog(`📦 ${label}: batch ${batchNo}/${batchCount} (${items.length} records) → ${via}`);
        const byId: Record<string, any> = {};
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
            reportClientError('BulkGeneratePdfs', `Record failed: ${it.recordId} — ${reason}`, undefined,
              { docType, year, recordId: it.recordId, error: reason, hadResult: !!r });
          } else {
            appendDetail(`${skipped ? '⏭️' : '✓'} ${label} — ${it.recordId}${skipped ? ' (already generated)' : ''}`);
          }
          const cur = progress[docType];
          progress = { ...progress, [docType]: {
            ...cur,
            done: cur.done + 1,
            skipped: cur.skipped + (skipped ? 1 : 0),
            failed: cur.failed + (ok ? 0 : 1)
          } };
        }
      } catch (err) {
        appendLog(`❌ ${label}: batch of ${items.length} failed — ${(err as Error).message}`);
        reportClientError('BulkGeneratePdfs', `Batch failed (${items.length} records)`, err as Error, { docType, year, count: items.length });
        const cur = progress[docType];
        progress = { ...progress, [docType]: { ...cur, done: cur.done + items.length, failed: cur.failed + items.length } };
      }
      await sleep(THROTTLE_MS);
    }
    appendLog(`✓ ${label} complete.`);
  }

  async function runAll() {
    if (!year) { alert('Please select a year'); return; }
    if (!confirm(`Generate PDFs for all Receipt/Certificate/Material/Consent records in Year ${year}? Already-generated PDFs will be skipped.`)) return;
    running = true;
    error = '';
    log = [];
    progress = {};
    eng = null;
    try {
      for (const [docType, label] of DOC_TYPES) {
        appendLog(`Starting ${label}...`);
        await runOne(docType, label);
      }
      appendLog('🎉 All done.');
    } catch (err) {
      error = (err as Error).message;
      reportClientError('BulkGeneratePdfs', 'Bulk run aborted', err as Error, { year });
    } finally {
      running = false;
    }
  }

  let engineKey = $derived(
    !eng ? null
      : (eng.render > 0 && eng.worker > 0) ? 'mixed'
        : eng.render > 0 ? 'render'
          : eng.worker > 0 ? 'worker'
            : 'none'
  );
  let isFallback = $derived(engineKey === 'worker' || engineKey === 'mixed');
</script>

<h2 style="margin-bottom:15px;">Generate PDFs (Bulk)</h2>
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}

<div class="glass-card" style="padding:20px;">
  <div class="form-group">
    <label for={`${uid}-f1`}>Year</label>
    <select id={`${uid}-f1`} bind:value={year} disabled={running}>
      {#each years as y (y)}<option value={y}>{y}</option>{/each}
    </select>
  </div>
  <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">
    Generates PDFs for all Receipt, Certificate, Material, and (Accepted) Consent records that have a .docx template uploaded for that doc-type. Records that have already been generated will be skipped automatically. A few are processed at a time (with automatic retry) — keep this tab open until it finishes.
  </p>
  <button class="btn-submit" onclick={runAll} disabled={running || !year}>
    {running ? 'Generating...' : '⚡ Generate PDFs for this Year'}
  </button>

  <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:0.82rem; cursor:pointer;">
    <input type="checkbox" bind:checked={showDetails} />
    Show per-record details in the log (failures are always shown)
  </label>

  {#if eng}
    <div style="margin-top:12px; padding:10px 12px; border-radius:8px; font-size:0.82rem; background:{isFallback ? '#fff7ed' : '#f0f9ff'}; border:1px solid {isFallback ? '#fed7aa' : '#bae6fd'};">
      <div style="font-weight:600; margin-bottom:4px;">
        {isFallback ? '⚠️' : '⚙️'} Engine: {ENGINE_LABELS[engineKey as string] || engineKey}
      </div>
      {#each eng.reasons as r (r)}
        <div style="color:var(--text-muted); margin-bottom:4px;">{ENGINE_REASONS[r] || r}</div>
      {/each}
      <div style="color:var(--text-muted);">
        Batch {eng.batchesDone}/{eng.batchesTotal} · size {BATCH_SIZE} · fill concurrency {CONCURRENCY} · throttle {THROTTLE_MS}ms · retries {RETRY_ATTEMPTS}
      </div>
      <div style="color:var(--text-muted);">
        Converted → Render: {eng.render} · Worker: {eng.worker} · already generated: {eng.none}
      </div>
      {#if eng.jobIds.length > 0}
        <div style="color:var(--text-muted); margin-top:4px;">
          Render jobs: {eng.jobIds.slice(-6).map(shortJobId).join(', ')}{eng.jobIds.length > 6 ? ` (+${eng.jobIds.length - 6} more)` : ''}
        </div>
      {/if}
    </div>
  {/if}

  {#if Object.keys(progress).length > 0}
    <div style="margin-top:15px;">
      {#each DOC_TYPES as [docType, label] (docType)}
        {#if progress[docType]}
          {@const p = progress[docType]}
          <div style="font-size:0.85rem; margin-bottom:6px;">
            <strong>{label}:</strong> {p.done}/{p.total} done ({p.skipped} skipped, {p.failed} failed{p.notIndexed ? `, ${p.notIndexed} NOT indexed` : ''})
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if log.length > 0}
    <div style="margin-top:15px; background:#f9fafb; border-radius:8px; padding:10px; max-height:250px; overflow-y:auto; font-size:0.8rem;">
      {#each log as line, i (i)}<div>{line}</div>{/each}
    </div>
  {/if}
</div>
