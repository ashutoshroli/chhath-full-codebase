import { useState } from 'react';
import { api, reportClientError } from '../api.js';

// ============ FULL BACKUP & RESTORE (Superadmin) ============
//
// Download: pulls every D1 table's rows from the backend (api.exportBackup),
// then builds a .zip CLIENT-SIDE with PizZip (already a dependency, lazy-loaded
// here) so the Worker never has to hold a big binary. The zip contains one
// pretty-printed JSON per database plus a manifest.json, and — most importantly —
// a single backup.json that is the exact object restore expects.
//
// Restore: reads a previously downloaded backup (.zip or .json), shows what it
// contains, and only proceeds after the operator types RESTORE. Restore is
// destructive; the backend takes an automatic safety snapshot first and returns
// it so we immediately offer it as a rollback download.
//
// NOTE: uploaded FILES (photos/PDFs) are NOT inside the backup — they stay on
// R2/Drive and the restored rows keep pointing at them. This is documented in
// the UI so nobody expects images inside the zip.

function tsStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Build a .zip from the backup object using PizZip (lazy import).
async function buildZip(backupObj) {
  const { default: PizZip } = await import('pizzip');
  const zip = new PizZip();
  // The canonical, restore-ready file.
  zip.file('backup.json', JSON.stringify(backupObj, null, 2));
  // Human-friendly: one file per database + a manifest.
  const manifest = {
    formatVersion: backupObj.formatVersion,
    createdAt: backupObj.createdAt,
    createdBy: backupObj.createdBy,
    totalRows: backupObj.totalRows,
    counts: backupObj.counts,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const dataFolder = zip.folder('databases');
  for (const [binding, tables] of Object.entries(backupObj.data || {})) {
    dataFolder.file(`${binding}.json`, JSON.stringify(tables, null, 2));
  }
  return zip.generate({ type: 'blob', compression: 'DEFLATE' });
}

// Extract the restore-ready backup object from an uploaded file (.zip or .json).
async function readBackupFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.json')) {
    const text = await file.text();
    const obj = JSON.parse(text);
    // Accept either the bare backup object or a {backup:{...}} wrapper.
    return obj.data ? obj : (obj.backup && obj.backup.data ? obj.backup : obj);
  }
  // .zip — pull backup.json out of it.
  const { default: PizZip } = await import('pizzip');
  const buf = await file.arrayBuffer();
  const zip = new PizZip(buf);
  const entry = zip.file('backup.json');
  if (!entry) throw new Error('Zip mein backup.json nahi mila — ye is portal ka backup nahi lagta.');
  return JSON.parse(entry.asText());
}

export default function Backup() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  // Restore state
  const [pendingBackup, setPendingBackup] = useState(null); // parsed object awaiting confirm
  const [pendingName, setPendingName] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [restoreReport, setRestoreReport] = useState(null);

  const doDownload = async () => {
    setError(''); setStatus(''); setBusy(true);
    try {
      setStatus('Data collect ho raha hai...');
      const res = await api.exportBackup();
      const backupObj = res && res.backup ? res.backup : res;
      if (!backupObj || !backupObj.data) throw new Error('Backend se backup data nahi mila.');
      setStatus('Zip bana rahe hain...');
      const blob = await buildZip(backupObj);
      downloadBlob(blob, `chhath-backup-${tsStamp()}.zip`);
      setStatus(`Backup download ho gaya — ${backupObj.totalRows} rows, ${Object.keys(backupObj.counts || {}).length} tables.`);
    } catch (err) {
      setError('Backup fail hua: ' + err.message);
      reportClientError('Backup', 'exportBackup/zip failed', err);
    } finally {
      setBusy(false);
    }
  };

  const onFilePicked = async (e) => {
    setError(''); setStatus(''); setRestoreReport(null); setConfirmText('');
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setBusy(true);
    try {
      const obj = await readBackupFile(file);
      if (!obj || !obj.data) throw new Error('File mein valid backup data nahi hai.');
      setPendingBackup(obj);
      setPendingName(file.name);
    } catch (err) {
      setError('Backup file padhi nahi ja saki: ' + err.message);
      reportClientError('Backup', 'readBackupFile failed', err);
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!pendingBackup) return;
    setError(''); setStatus(''); setBusy(true);
    try {
      setStatus('Restore ho raha hai (pehle current data ka safety snapshot ban raha hai)...');
      const res = await api.restoreBackup(pendingBackup, confirmText);
      setRestoreReport(res.report || null);
      // Immediately offer the pre-restore safety snapshot as a rollback download.
      if (res.safetySnapshot) {
        try {
          const blob = await buildZip(res.safetySnapshot);
          downloadBlob(blob, `chhath-PRE-RESTORE-safety-${tsStamp()}.zip`);
        } catch (e) { /* snapshot download is best-effort */ }
      }
      setStatus(res.message || 'Restore complete.');
      setPendingBackup(null);
      setPendingName('');
      setConfirmText('');
    } catch (err) {
      setError('Restore fail hua: ' + err.message);
      reportClientError('Backup', 'restoreBackup failed', err);
    } finally {
      setBusy(false);
    }
  };

  const counts = pendingBackup && pendingBackup.counts ? pendingBackup.counts : null;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="material-icons-round">backup</span> Backup &amp; Restore
      </h2>

      {status && <div className="glass-card" style={{ padding: 12, marginBottom: 12, color: 'var(--success, #16a34a)' }}>{status}</div>}
      {error && <div className="error-banner" style={{ margin: '12px 0' }}>{error}</div>}

      {/* ---- Download ---- */}
      <div className="glass-card" style={{ padding: 18, marginBottom: 18 }}>
        <h3 style={{ marginTop: 0 }}>1. Full Backup Download</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Poore database (saari 8 D1 databases, har table) ka backup ek zip file mein download karein.
          File ki tasveerein/PDF backup mein nahi hoti (woh R2/Drive par safe rehti hain) — backup mein
          unke links hote hain.
        </p>
        <button className="btn-submit" onClick={doDownload} disabled={busy}>
          <span className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 6 }}>download</span>
          {busy ? 'Please wait...' : 'Download Full Backup (.zip)'}
        </button>
      </div>

      {/* ---- Restore ---- */}
      <div className="glass-card" style={{ padding: 18, border: '1px solid #f0c000' }}>
        <h3 style={{ marginTop: 0, color: '#b45309' }}>2. Restore from Backup</h3>
        <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: '0.88rem', color: '#7c2d12' }}>
          <strong>⚠️ Dhyaan dein:</strong> Restore poore data ko backup wale data se REPLACE kar deta hai —
          ye undo nahi hota. Safety ke liye restore se pehle current data ka snapshot automatically download
          ho jayega (rollback ke liye rakh lein).
        </div>

        {!pendingBackup ? (
          <label className="btn-secondary" style={{ cursor: busy ? 'not-allowed' : 'pointer', display: 'inline-block' }}>
            <span className="material-icons-round" style={{ verticalAlign: 'middle', marginRight: 6 }}>upload_file</span>
            Backup file chunein (.zip ya .json)
            <input type="file" accept=".zip,.json,application/zip,application/json" style={{ display: 'none' }} onChange={onFilePicked} disabled={busy} />
          </label>
        ) : (
          <div>
            <p style={{ fontSize: '0.9rem' }}>
              <strong>File:</strong> {pendingName}<br />
              <strong>Banaya gaya:</strong> {pendingBackup.createdAt || 'unknown'} by {pendingBackup.createdBy || 'unknown'}<br />
              <strong>Total rows:</strong> {pendingBackup.totalRows != null ? pendingBackup.totalRows : 'n/a'}
            </p>
            {counts && (
              <details style={{ marginBottom: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>Tables &amp; row counts dekhein</summary>
                <ul style={{ fontSize: '0.8rem', maxHeight: 200, overflow: 'auto', columns: 2 }}>
                  {Object.entries(counts).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
                </ul>
              </details>
            )}
            <p style={{ fontSize: '0.9rem', marginBottom: 6 }}>Confirm karne ke liye niche box mein <code>RESTORE</code> (capital) likhein:</p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="RESTORE"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', width: 200, marginRight: 10 }}
              disabled={busy}
            />
            <button
              className="btn-submit"
              style={{ background: '#dc2626' }}
              onClick={doRestore}
              disabled={busy || confirmText.trim().toUpperCase() !== 'RESTORE'}
            >
              {busy ? 'Restoring...' : 'Restore Now (destructive)'}
            </button>
            <button className="btn-secondary" style={{ marginLeft: 10 }} onClick={() => { setPendingBackup(null); setPendingName(''); setConfirmText(''); }} disabled={busy}>
              Cancel
            </button>
          </div>
        )}

        {restoreReport && (
          <div style={{ marginTop: 16, fontSize: '0.85rem' }}>
            <strong>Restore report:</strong>
            <div>Restored tables: {Object.keys(restoreReport.restoredTables || {}).length}</div>
            {restoreReport.errors && restoreReport.errors.length > 0 && (
              <div style={{ color: 'var(--danger, #dc2626)' }}>
                Errors:
                <ul>{restoreReport.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
