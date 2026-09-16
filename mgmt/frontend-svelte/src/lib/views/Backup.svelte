<script lang="ts">
  // Ported from React views/Backup.jsx — download a full DB backup as a zip
  // (built client-side with PizZip) and restore from a zip/json, one DB at a time.
  import { api, reportClientError } from '$lib/api';

  function tsStamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function buildZip(backupObj: any): Promise<Blob> {
    const { default: PizZip } = await import('pizzip');
    const zip = new PizZip();
    zip.file('backup.json', JSON.stringify(backupObj, null, 2));
    const manifest = {
      formatVersion: backupObj.formatVersion,
      createdAt: backupObj.createdAt,
      createdBy: backupObj.createdBy,
      totalRows: backupObj.totalRows,
      counts: backupObj.counts
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    const dataFolder = zip.folder('databases');
    for (const [binding, tables] of Object.entries(backupObj.data || {})) {
      dataFolder.file(`${binding}.json`, JSON.stringify(tables, null, 2));
    }
    return zip.generate({ type: 'blob', compression: 'DEFLATE' }) as Blob;
  }

  async function readBackupFile(file: File): Promise<any> {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.json')) {
      const text = await file.text();
      const obj = JSON.parse(text);
      return obj.data ? obj : (obj.backup && obj.backup.data ? obj.backup : obj);
    }
    const { default: PizZip } = await import('pizzip');
    const buf = await file.arrayBuffer();
    const zip = new PizZip(buf);
    const entry = zip.file('backup.json');
    if (!entry) throw new Error('backup.json was not found in the zip — this does not appear to be a backup of this portal.');
    return JSON.parse(entry.asText());
  }

  let busy = $state(false);
  let status = $state('');
  let error = $state('');

  let pendingBackup = $state<any>(null);
  let pendingName = $state('');
  let confirmText = $state('');
  let restoreReport = $state<any>(null);
  let ackCurrentBackup = $state(false);

  async function doDownload() {
    error = ''; status = ''; busy = true;
    try {
      status = 'Collecting data...';
      const res: any = await api.exportBackup();
      const backupObj = res && res.backup ? res.backup : res;
      if (!backupObj || !backupObj.data) throw new Error('No backup data was returned from the backend.');
      status = 'Building the zip...';
      const blob = await buildZip(backupObj);
      downloadBlob(blob, `chhath-backup-${tsStamp()}.zip`);
      status = `Backup downloaded — ${backupObj.totalRows} rows, ${Object.keys(backupObj.counts || {}).length} tables.`;
    } catch (err) {
      error = 'Backup failed: ' + (err as Error).message;
      reportClientError('Backup', 'exportBackup/zip failed', err as Error);
    } finally {
      busy = false;
    }
  }

  async function onFilePicked(e: Event) {
    error = ''; status = ''; restoreReport = null; confirmText = '';
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    busy = true;
    try {
      const obj = await readBackupFile(file);
      if (!obj || !obj.data) throw new Error('The file does not contain valid backup data.');
      pendingBackup = obj;
      pendingName = file.name;
    } catch (err) {
      error = 'The backup file could not be read: ' + (err as Error).message;
      reportClientError('Backup', 'readBackupFile failed', err as Error);
    } finally {
      busy = false;
    }
  }

  function mergeReport(agg: any, r: any) {
    if (!r) return agg;
    for (const k of ['restoredTables', 'partialTables', 'emptyTables', 'skippedTables']) {
      Object.assign(agg[k], r[k] || {});
    }
    agg.errors.push(...(r.errors || []));
    return agg;
  }

  async function doRestore() {
    if (!pendingBackup) return;
    if (!ackCurrentBackup) {
      error = 'Tick "I have already downloaded a current backup" first. The restore no longer takes an automatic snapshot (it could run out of memory on a large database), so you must have your own rollback copy.';
      return;
    }
    error = ''; status = ''; busy = true;
    try {
      status = 'Preparing restore...';
      const plan: any = await api.restoreBackup(pendingBackup, confirmText, { snapshotAcknowledged: true });
      const bindings = (plan && plan.bindings) || [];
      if (!bindings.length) throw new Error('The backup contains no known databases to restore.');

      const agg: any = { restoredTables: {}, partialTables: {}, emptyTables: {}, skippedTables: {}, errors: [] };
      for (let i = 0; i < bindings.length; i++) {
        const b = bindings[i];
        status = `Restoring database ${i + 1} of ${bindings.length}: ${b} ...`;
        const res: any = await api.restoreBackup(pendingBackup, confirmText, { snapshotAcknowledged: true, onlyBinding: b });
        mergeReport(agg, res.report);
      }
      restoreReport = agg;
      const restored = Object.keys(agg.restoredTables).length;
      const failed = agg.errors.length;
      status = failed === 0
        ? `Restore complete — ${restored} table(s) restored across ${bindings.length} database(s).`
        : `Restore finished with problems — ${restored} table(s) restored, ${failed} FAILED. See the report.`;
      pendingBackup = null;
      pendingName = '';
      confirmText = '';
      ackCurrentBackup = false;
    } catch (err) {
      error = 'Restore failed: ' + (err as Error).message;
      reportClientError('Backup', 'restoreBackup failed', err as Error);
    } finally {
      busy = false;
    }
  }

  function cancelPending() {
    pendingBackup = null; pendingName = ''; confirmText = ''; ackCurrentBackup = false;
  }

  let counts = $derived(pendingBackup && pendingBackup.counts ? pendingBackup.counts : null);
</script>

<div style="max-width:760px; margin:0 auto;">
  <h2 style="display:flex; align-items:center; gap:8px;">
    <span class="material-icons-round">backup</span> Backup &amp; Restore
  </h2>

  {#if status}<div class="glass-card" style="padding:12px; margin-bottom:12px; color:var(--success, #16a34a);">{status}</div>{/if}
  {#if error}<div role="alert" class="error-banner" style="margin:12px 0;">{error}</div>{/if}

  <div class="glass-card" style="padding:18px; margin-bottom:18px;">
    <h3 style="margin-top:0;">1. Full Backup Download</h3>
    <p style="color:var(--text-muted); font-size:0.9rem;">
      Download a backup of the portal database as a single zip file.
      Uploaded images/PDFs are not included in the backup (they stay safely on R2/Drive) — the backup
      only contains links to them.
    </p>
    <div style="background:#f0f9ff; border:1px solid #7dd3fc; border-radius:8px; padding:12px; margin-bottom:14px; font-size:0.85rem; color:#075985;">
      <strong>What this covers:</strong> all 9 databases and every table in them, including
      sessions and login attempts. The queued-document bytes
      (<code>collection_jobs.filled_base64</code>) are left out on purpose — they are temporary and
      re-generated on demand; the job rows themselves are included.
      <br />
      <strong>Files are separate:</strong> uploaded images and PDFs live on R2 / Google Drive and are
      not inside this file (it stores their links), so keep the bucket and the Drive folder backed up
      too.
    </div>
    <button class="btn-submit" onclick={doDownload} disabled={busy}>
      <span class="material-icons-round" style="vertical-align:middle; margin-right:6px;">download</span>
      {busy ? 'Please wait...' : 'Download Full Backup (.zip)'}
    </button>
  </div>

  <div class="glass-card" style="padding:18px; border:1px solid #f0c000;">
    <h3 style="margin-top:0; color:#b45309;">2. Restore from Backup</h3>
    <div style="background:#fff7ed; border:1px solid #fdba74; border-radius:8px; padding:12px; margin-bottom:14px; font-size:0.88rem; color:#7c2d12;">
      <strong>⚠️ Please note:</strong> Restore REPLACES all data with the data from the backup —
      this cannot be undone. Download a fresh backup of the CURRENT data first (button above) and
      keep it as your rollback copy. The restore runs one database at a time.
    </div>

    {#if !pendingBackup}
      <label class="btn-secondary" style="cursor:{busy ? 'not-allowed' : 'pointer'}; display:inline-block;">
        <span class="material-icons-round" style="vertical-align:middle; margin-right:6px;">upload_file</span>
        Choose a backup file (.zip or .json)
        <input type="file" accept=".zip,.json,application/zip,application/json" style="display:none;" onchange={onFilePicked} disabled={busy} />
      </label>
    {:else}
      <div>
        <p style="font-size:0.9rem;">
          <strong>File:</strong> {pendingName}<br />
          <strong>Created:</strong> {pendingBackup.createdAt || 'unknown'} by {pendingBackup.createdBy || 'unknown'}<br />
          <strong>Total rows:</strong> {pendingBackup.totalRows != null ? pendingBackup.totalRows : 'n/a'}
        </p>
        {#if counts}
          <details style="margin-bottom:12px;">
            <summary style="cursor:pointer; font-size:0.85rem;">View tables &amp; row counts</summary>
            <ul style="font-size:0.8rem; max-height:200px; overflow:auto; columns:2;">
              {#each Object.entries(counts) as [k, v] (k)}<li>{k}: {v}</li>{/each}
            </ul>
          </details>
        {/if}
        <label style="display:flex; align-items:flex-start; gap:8px; font-size:0.85rem; margin:4px 0 12px; color:#7c2d12;">
          <input type="checkbox" bind:checked={ackCurrentBackup} disabled={busy} style="margin-top:3px;" />
          <span>I have already downloaded a current backup and understand this restore replaces the live data and cannot be undone.</span>
        </label>
        <p style="font-size:0.9rem; margin-bottom:6px;">To confirm, type <code>RESTORE</code> (uppercase) in the box below:</p>
        <input type="text" bind:value={confirmText} placeholder="RESTORE" style="padding:8px 12px; border-radius:8px; border:1px solid #d1d5db; width:200px; margin-right:10px;" disabled={busy} />
        <button class="btn-submit" style="background:#dc2626;" onclick={doRestore} disabled={busy || !ackCurrentBackup || confirmText.trim().toUpperCase() !== 'RESTORE'}>
          {busy ? 'Restoring...' : 'Restore Now (destructive)'}
        </button>
        <button class="btn-secondary" style="margin-left:10px;" onclick={cancelPending} disabled={busy}>Cancel</button>
      </div>
    {/if}

    {#if restoreReport}
      <div style="margin-top:16px; font-size:0.85rem;">
        <strong>Restore report:</strong>
        <div>Restored tables: {Object.keys(restoreReport.restoredTables || {}).length}</div>
        {#if restoreReport.partialTables && Object.keys(restoreReport.partialTables).length > 0}
          <div style="color:#b45309; margin-top:6px;">
            Some rows were skipped (the rest restored) — this usually happens because of duplicate rows within the backup itself:
            <ul>{#each Object.entries(restoreReport.partialTables) as [t, msg] (t)}<li><code>{t}</code>: {msg}</li>{/each}</ul>
          </div>
        {/if}
        {#if restoreReport.emptyTables && Object.keys(restoreReport.emptyTables).length > 0}
          <div style="color:#6b7280; margin-top:6px;">
            Left unchanged (the backup contained no rows for these tables, so the current data was kept — nothing was deleted):
            <ul>{#each Object.entries(restoreReport.emptyTables) as [t, msg] (t)}<li><code>{t}</code>: {msg}</li>{/each}</ul>
          </div>
        {/if}
        {#if restoreReport.errors && restoreReport.errors.length > 0}
          <div style="color:var(--danger, #dc2626); margin-top:6px;">
            Errors (these tables could not be restored):
            <ul>{#each restoreReport.errors as e, i (i)}<li>{e}</li>{/each}</ul>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
